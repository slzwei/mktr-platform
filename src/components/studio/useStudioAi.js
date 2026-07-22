import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestCopyDraft } from './studioAiApi';
import {
  rowDisabledReason,
  rowCurrentValue,
  rowValueAbsent,
  rowValuesEqual,
  buildLookDoc,
  lookBlockedReason,
  adoptedCopyRows,
} from './studioLooks';
import { buildDrawTermsHtml } from '@/components/campaigns/workspace/drawTermsTemplate';

/**
 * Studio AI assist state machine (PR 4) — the mock's semantics with the
 * Codex-folded corrections:
 *
 *  - phases: brief | loading | looksLoading | ready | looks | proposal |
 *    error | rate; Generate is disabled until the brief has a topic.
 *  - review rows: {path, label, section, value, old, state, kind} where state
 *    ∈ open | applied | kept and kind ∈ copy | pick | list (full-coverage
 *    amendment: the server merges string draft rows, marketplace enum PICKS
 *    and the inclusions LIST into one reviewable stream; equality checks are
 *    kind-aware via rowCurrentValue/rowValuesEqual). Accept re-gates the path
 *    against the CURRENT doc (action-time TOCTOU guard) and writes via
 *    setPath; Keep-mine restores `old` ONLY while the doc still holds the
 *    accepted AI value (operator edits always win); per-field ↻ regenerates
 *    scoped (regens[path]+1) and updates the doc only if the row was applied
 *    AND untouched, else the new value arrives as `open`. Pick rows have no ↻
 *    (an enum re-roll is noise; the server 422s pick scopes anyway).
 *  - recommendations: advisory {topic, label, advice, suggestedValue, state}
 *    cards — NEVER part of apply-all. applyRec is an explicit per-card action
 *    that writes the unsaved doc (publication toggles, host) or prefills the
 *    slug draft via onSlugPrefill; advice-only cards (null suggestedValue)
 *    offer only a rail deep-link via onJumpSection.
 *  - full mode (CO-1): ≤3 complete looks in ONE provider call. Picking a look
 *    swaps the WHOLE doc (replaceDoc) built from the PRE-proposal doc; keep
 *    toggles rebuild from `prev.doc`; Adopt turns the look's copy into an
 *    `applied` review list (old = pre-look values); Discard / ↩ Revert look
 *    restores `prev.doc`; a successful save commits (clears the proposal).
 *    Regenerating — looks or fields — mid-proposal keeps the ORIGINAL prev
 *    (F9). Dirty stays DERIVED from doc-vs-baseline throughout (F8).
 *  - campaign scoping: EVERYTHING resets on campaign change, in-flight
 *    requests abort (AbortController) and stale responses are fenced by a
 *    generation token (F10).
 *  - budget meter: client-side sliding-minute ESTIMATE (server window is
 *    authoritative; its 429 retryAfterSec drives the countdown).
 */

export const AI_TONES = ['Friendly', 'Formal', 'Urgent', 'Playful'];

const EMPTY_BRIEF = { topic: '', audience: '', objective: '', mustInclude: '', tone: 'Friendly' };
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Rail section a recommendation topic deep-links to. */
const REC_SECTIONS = {
  listMarketplace: 'dist',
  featureDrop: 'dist',
  customerHost: 'dist',
  slug: 'dist',
  formGates: 'form',
  formFields: 'form',
  verification: 'form',
};

export default function useStudioAi({ campaign, doc, setPath, replaceDoc, onPickLook, onSlugPrefill, onJumpSection }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('copy');
  const [phase, setPhase] = useState('brief');
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [sugs, setSugs] = useState([]);
  const [recs, setRecs] = useState([]); // advisory cards — never in apply-all
  const [scope, setScope] = useState(null); // {path, label} | null
  const [looks, setLooks] = useState([]);
  // Full-mode common sections (create-everything amendment, extended by the
  // eligibility-gates amendment): the raw fields/terms/gates/verification/
  // drawTerms response parts, held until a look is ADOPTED — then assembled
  // into review rows against the pre-look doc, so they survive pick/keep/
  // revert cycles.
  const [commonSections, setCommonSections] = useState(null);
  const [proposal, setProposal] = useState(null); // {prev:{doc}, look, keep, adopted}
  const [mediaHint, setMediaHint] = useState(null); // {kind, note} | null
  const [regeningLook, setRegeningLook] = useState(null); // index | null
  const [error, setError] = useState('');
  const [retryIn, setRetryIn] = useState(0);
  const [budgetTick, setBudgetTick] = useState(0);

  const regensRef = useRef({});
  const callTimesRef = useRef([]);
  const generationRef = useRef(0);
  const abortRef = useRef(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  // Mirrors for event handlers — doc writes (setPath/replaceDoc) must happen
  // in the handler, never inside a state updater (updaters run at render time).
  const sugsRef = useRef(sugs);
  sugsRef.current = sugs;
  const recsRef = useRef(recs);
  recsRef.current = recs;
  const looksRef = useRef(looks);
  looksRef.current = looks;
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const onPickLookRef = useRef(onPickLook);
  onPickLookRef.current = onPickLook;
  const onSlugPrefillRef = useRef(onSlugPrefill);
  onSlugPrefillRef.current = onSlugPrefill;
  const onJumpSectionRef = useRef(onJumpSection);
  onJumpSectionRef.current = onJumpSection;

  const patchRow = useCallback((index, patch) => {
    setSugs((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const patchRec = useCallback((index, patch) => {
    setRecs((prev) => prev.map((rec, i) => (i === index ? { ...rec, ...patch } : rec)));
  }, []);

  // Campaign scoping (Codex F10): full reset + abort in-flight + stale fence.
  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setMode('copy');
    setPhase('brief');
    setBrief(EMPTY_BRIEF);
    setSugs([]);
    setRecs([]);
    setScope(null);
    setLooks([]);
    setCommonSections(null);
    setProposal(null);
    setMediaHint(null);
    setRegeningLook(null);
    setError('');
    setRetryIn(0);
    regensRef.current = {};
    return () => abortRef.current?.abort(); // unmount / next campaign
  }, [campaign?.id]);

  // 429 countdown → back to the brief when it expires. The phase transition
  // lives OUT here, not inside the setRetryIn updater — updaters must stay
  // pure (Strict Mode double-invokes them).
  useEffect(() => {
    if (phase !== 'rate') return undefined;
    if (retryIn <= 0) {
      setPhase('brief');
      return undefined;
    }
    const t = setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, retryIn]);

  const noteCall = useCallback(() => {
    const now = Date.now();
    callTimesRef.current = callTimesRef.current.filter((t) => now - t < 60_000).concat(now);
    setBudgetTick((t) => t + 1);
  }, []);

  const budget = useMemo(() => {
    const now = Date.now();
    const used = callTimesRef.current.filter((t) => now - t < 60_000).length;
    return { used, max: 10 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetTick]);

  const templateId = doc?.template?.id || 'editorial';

  /** Annotate assembled rows with old/absent/state against a base doc. */
  const annotateRows = useCallback((rows, base) => rows.map((row) => ({
    ...row,
    old: rowCurrentValue(base, row),
    oldAbsent: rowValueAbsent(base, row),
    state: 'open',
    disabledReason: rowDisabledReason(base, row.path),
  })), []);

  /** Common rows (create-everything amendment): the sign-up FIELDS row and
   * the TERMS row. Draw campaigns compose the terms document CLIENT-side
   * from the response's deterministic drawTerms FACTS (fresh from the stored
   * campaign) with the same template the create flow uses — never LLM legal
   * text. Old servers send neither key — both rows are optional. */
  const buildCommonRows = useCallback((data, base) => {
    const rows = [];
    if (Array.isArray(data?.fields) && data.fields.length) {
      rows.push({ path: 'form.fields', label: 'Sign-up fields', section: 'Form', kind: 'fields', value: data.fields });
    }
    let termsValue = null;
    let drawFacts = null;
    if (data?.terms && typeof data.terms.html === 'string' && data.terms.html) {
      termsValue = { template: data.terms.template || 'default', html: data.terms.html };
    } else if (data?.drawTerms && data.drawTerms.closesAt) {
      drawFacts = data.drawTerms;
      termsValue = {
        template: 'default',
        html: buildDrawTermsHtml({
          campaignName: drawFacts.campaignName,
          prizes: drawFacts.prizes || undefined,
          prize: drawFacts.prize || undefined,
          closesAt: drawFacts.closesAt,
          boostClosesAt: drawFacts.boostClosesAt || undefined,
          multiplier: drawFacts.multiplier,
          minAge: drawFacts.minAge,
          verification: drawFacts.verification,
        }),
      };
    }
    if (termsValue) {
      rows.push({
        path: 'form.terms',
        label: drawFacts ? 'Draw Terms & Conditions (platform template)' : 'Terms & Conditions (draft)',
        section: 'Form',
        kind: 'terms',
        value: termsValue,
        ...(drawFacts ? { deterministic: true } : {}),
      });
    }
    // Eligibility-gates amendment. Both rows are dropped when they match the
    // doc already: an Accept button that changes nothing reads as a pending
    // decision, and these two are exactly the rows an operator must be able to
    // trust at a glance.
    const proposed = [];
    if (data?.gates && typeof data.gates === 'object') {
      proposed.push({ path: 'form.gates', label: 'Eligibility gates', section: 'Form', kind: 'gates', value: data.gates });
    }
    if (data?.verification === 'sms' || data?.verification === 'whatsapp') {
      proposed.push({ path: 'form.verification', label: 'Verification channel', section: 'Form', kind: 'verification', value: data.verification });
    }
    for (const row of proposed) {
      if (!rowValuesEqual(rowCurrentValue(base, row), row.value)) rows.push(row);
    }
    return annotateRows(rows, base);
  }, [annotateRows]);

  /** Merge the response's typed sections into ONE review stream: string draft
   * rows, marketplace enum picks, the inclusions list, plus the common
   * fields/terms rows. Old servers send only `draft` — every section is
   * optional. */
  const toRows = useCallback((data) => {
    const current = docRef.current;
    const merged = [
      ...(data?.draft || []).map((row) => ({ ...row, kind: 'copy' })),
      ...(data?.picks || []).map((row) => ({ ...row, kind: 'pick' })),
      ...(data?.inclusions ? [{ ...data.inclusions, kind: 'list', value: data.inclusions.values }] : []),
    ];
    return [...annotateRows(merged, current), ...buildCommonRows(data, current)];
  }, [annotateRows, buildCommonRows]);

  const fail = useCallback((err) => {
    if (err?.kind === 'aborted') return;
    if (err?.kind === 'rate') {
      setRetryIn(err.retryAfterSec);
      setPhase('rate');
    } else {
      setError(err?.message || 'AI generation failed. Try again.');
      setPhase('error');
    }
  }, []);

  const startRequest = useCallback(() => {
    // Newest-request-wins (Codex diff #2): starting a request aborts any
    // in-flight one AND bumps the fence, so a slower older response can never
    // land after (or over) a newer one — the same token also fences campaign
    // switches (the reset effect bumps it too). Any abandoned 429 cooldown is
    // cleared with it (round 2 #4 — a frozen countdown must not linger).
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    generationRef.current += 1;
    setRetryIn(0);
    return { generation: generationRef.current, signal: ac.signal };
  }, []);

  const briefOrName = useCallback(
    () => (brief.topic.trim() ? brief : { ...brief, topic: campaign?.name || '' }),
    [brief, campaign?.name]
  );

  /** Generate (copy mode) — whole allowed set, or re-run after error. */
  const generate = useCallback(async () => {
    if (!brief.topic.trim() || !campaign?.id) return;
    const { generation, signal } = startRequest();
    setScope(null);
    setPhase('loading');
    setError('');
    noteCall();
    try {
      const data = await requestCopyDraft(
        {
          campaignId: campaign.id,
          templateId,
          mode: 'copy',
          scope: null,
          regen: 0,
          brief,
        },
        { signal }
      );
      if (generation !== generationRef.current) return; // stale campaign
      setSugs(toRows(data));
      setRecs((data.recommendations || []).map((rec) => ({ ...rec, state: 'open' })));
      setPhase('ready');
    } catch (err) {
      if (generation !== generationRef.current) return;
      fail(err);
    }
  }, [brief, campaign?.id, templateId, startRequest, noteCall, toRows, fail]);

  /** Per-field ✦ — opens the panel scoped to one path. */
  const suggestField = useCallback(
    async (path, label) => {
      if (!campaign?.id) return;
      const { generation, signal } = startRequest();
      const usedBrief = briefOrName();
      setBrief(usedBrief);
      setOpen(true);
      setMode('copy');
      setScope({ path, label });
      setPhase('loading');
      setError('');
      noteCall();
      try {
        const data = await requestCopyDraft(
          {
            campaignId: campaign.id,
            templateId,
            mode: 'copy',
            scope: path,
            regen: regensRef.current[path] || 0,
            brief: usedBrief,
          },
          { signal }
        );
        if (generation !== generationRef.current) return;
        setSugs(toRows(data));
        setRecs([]); // scoped view — a full generate rebuilds the advisory cards
        setPhase('ready');
      } catch (err) {
        if (generation !== generationRef.current) return;
        fail(err);
      }
    },
    [campaign?.id, templateId, briefOrName, startRequest, noteCall, toRows, fail]
  );

  /** The doc-write shape for a row's value: fields rows land as canonical
   * form.fields entries (row:null — pairing is layout state the AI never
   * proposes); terms rows land atomically as {template, html} (a labelled
   * terms object without html would be dropped by the save clamp). */
  const rowApplyValue = (row) => {
    if (row.kind === 'fields') {
      return row.value.map((f) => ({ id: f.id, visible: f.visible !== false, required: f.required === true, row: null }));
    }
    if (row.kind === 'terms') return { template: row.value.template || 'default', html: row.value.html || '' };
    // Gates MERGE into the live object — the AI proposes only sgPr and
    // advisorExclusion, so a whole-object write would silently clear the
    // operator-owned DNC gate.
    if (row.kind === 'gates') {
      const cur = docRef.current?.form?.gates;
      return { ...(cur && typeof cur === 'object' ? cur : {}), ...row.value };
    }
    return row.value;
  };

  /** Accept one row — action-time re-gate, then write. */
  const acceptRow = useCallback(
    (index) => {
      const row = sugsRef.current[index];
      if (!row || row.state !== 'open') return;
      const reason = rowDisabledReason(docRef.current, row.path);
      if (reason) {
        patchRow(index, { disabledReason: reason });
        return;
      }
      setPath(row.path, rowApplyValue(row));
      patchRow(index, { disabledReason: null, state: 'applied' });
    },
    [setPath, patchRow]
  );

  /** Keep-mine — restores old ONLY if the doc still holds the AI value.
   * An originally-ABSENT value restores as `undefined`, not the normalized
   * ''/[] (Codex #198-1): getters treat both as empty, but ''/[] would leave
   * the doc dirty against baseline forever — undefined JSON-serializes away,
   * so the dirty flag (JSON-compare) self-corrects. */
  const keepRow = useCallback(
    (index) => {
      const row = sugsRef.current[index];
      if (!row || row.state === 'kept') return;
      if (row.state === 'applied' && rowValuesEqual(rowCurrentValue(docRef.current, row), row.value)) {
        // Gates restore through the same MERGE as apply: `old` holds only the
        // two AI-proposed keys, so a whole-object write here would delete the
        // operator's DNC gate on the way back out.
        const restore = row.kind === 'gates' && !row.oldAbsent
          ? { ...(docRef.current?.form?.gates || {}), ...row.old }
          : row.oldAbsent ? undefined : row.old;
        setPath(row.path, restore);
      }
      patchRow(index, { state: 'kept' });
    },
    [setPath, patchRow]
  );

  /** Scoped per-row regenerate (regens[path]+1), replace in place. Pick rows
   * have no regen (enum re-rolls are noise; the server 422s pick scopes);
   * fields/terms rows have none either (their scopes aren't in the server
   * whitelist — a full generate re-derives them). */
  const regenRow = useCallback(
    async (index) => {
      const row = sugsRef.current[index];
      if (!row || row.kind === 'pick' || row.kind === 'fields' || row.kind === 'terms' || row.kind === 'gates' || row.kind === 'verification' || !campaign?.id) return;
      const { generation, signal } = startRequest();
      const n = (regensRef.current[row.path] || 0) + 1;
      noteCall();
      try {
        const data = await requestCopyDraft(
          {
            campaignId: campaign.id,
            templateId,
            mode: 'copy',
            scope: row.path,
            regen: n,
            brief: briefOrName(),
          },
          { signal }
        );
        if (generation !== generationRef.current) return;
        regensRef.current[row.path] = n;
        const fresh = row.kind === 'list'
          ? (data.inclusions ? { value: data.inclusions.values } : null)
          : data.draft?.[0];
        if (!fresh) return;
        const cur = sugsRef.current[index];
        if (!cur || cur.path !== row.path) return;
        // Action-time re-gate BEFORE the applied-branch write (Codex diff #1):
        // disabling a surface doesn't clear its stored value, so an applied
        // untouched row on a now-disabled path must fall back to open+reason —
        // never a silent write.
        const reason = rowDisabledReason(docRef.current, cur.path);
        if (!reason && cur.state === 'applied' && rowValuesEqual(rowCurrentValue(docRef.current, cur), cur.value)) {
          // untouched applied row on a live surface: swap the doc value, stay applied
          setPath(cur.path, fresh.value);
          patchRow(index, { value: fresh.value });
        } else {
          patchRow(index, { value: fresh.value, state: 'open', disabledReason: reason });
        }
      } catch (err) {
        if (generation !== generationRef.current) return;
        fail(err);
      }
    },
    [campaign?.id, templateId, briefOrName, startRequest, noteCall, fail, setPath, patchRow]
  );

  /** Apply every remaining OPEN row (each re-gated), optionally limited to one
   * section. Recommendations are NEVER part of this — advisory by contract.
   * No row kind in the batch can flip another row's availability
   * (rowDisabledReason keys on media/quiz/template/inheritance only — never on
   * form.gates or form.verification), so re-gating against the pre-batch doc
   * stays sound. */
  const applyOpenRows = useCallback((section) => {
    const patches = sugsRef.current.map((row) => {
      if (row.state !== 'open') return null;
      if (section && row.section !== section) return null;
      const reason = rowDisabledReason(docRef.current, row.path);
      if (reason) return { disabledReason: reason };
      setPath(row.path, rowApplyValue(row));
      return { disabledReason: null, state: 'applied' };
    });
    setSugs((prev) => prev.map((row, i) => (patches[i] ? { ...row, ...patches[i] } : row)));
  }, [setPath]);

  // applyAll stays zero-arg: it is wired straight into onClick, and a DOM
  // event leaking into the section filter would silently apply nothing.
  const applyAll = useCallback(() => applyOpenRows(null), [applyOpenRows]);
  const applySection = useCallback((section) => applyOpenRows(section), [applyOpenRows]);

  /** Explicit per-card apply for a recommendation with a suggestedValue —
   * writes the UNSAVED doc (or prefills the slug draft); nothing persists
   * until the operator saves, and the server publication gate still rules.
   * The slug callback may VETO by returning false (Codex #198-3: the card was
   * generated against an older campaign state — if a slug has been saved or
   * locked since, prefilling would feed a doomed value into a disabled
   * input); a vetoed card stays open. */
  const applyRec = useCallback(
    (index) => {
      const rec = recsRef.current[index];
      if (!rec || rec.state === 'applied' || !rec.suggestedValue) return;
      switch (rec.topic) {
        case 'listMarketplace':
          setPath('distribution.marketplace.listed', rec.suggestedValue === 'on');
          break;
        case 'featureDrop':
          setPath('distribution.featuredDrop.enabled', rec.suggestedValue === 'on');
          break;
        case 'customerHost':
          setPath('distribution.host', rec.suggestedValue);
          break;
        case 'slug': {
          if (onSlugPrefillRef.current?.(rec.suggestedValue) === false) return;
          break;
        }
        default:
          return; // advice-only topics have nothing to apply
      }
      patchRec(index, { state: 'applied' });
    },
    [setPath, patchRec]
  );

  /** Deep-link the rail to the control a recommendation talks about. */
  const jumpRec = useCallback((index) => {
    const rec = recsRef.current[index];
    if (!rec) return;
    onJumpSectionRef.current?.(REC_SECTIONS[rec.topic] || 'dist');
  }, []);

  const discard = useCallback(() => {
    setSugs([]);
    setRecs([]);
    setScope(null);
    setPhase('brief');
  }, []);

  const backToBrief = useCallback(() => {
    setScope(null);
    setPhase('brief');
  }, []);

  // ---- Full mode (CO-1 looks) ----

  /** The doc looks compose against — mid-proposal, always the PRE-proposal doc. */
  const lookBaseDoc = useCallback(
    () => (proposalRef.current ? proposalRef.current.prev.doc : docRef.current),
    []
  );

  /** Generate ≤3 complete looks — one budget call. Copy-mode recommendation
   * cards are invalidated here (Codex #198-4): looks never produce recs, and
   * stale cards must not resurface under an adopted look's review list. */
  const generateLooks = useCallback(async () => {
    if (!brief.topic.trim() || !campaign?.id) return;
    const { generation, signal } = startRequest();
    setPhase('looksLoading');
    setRecs([]);
    setError('');
    noteCall();
    try {
      const data = await requestCopyDraft(
        {
          campaignId: campaign.id,
          templateId,
          mode: 'full',
          scope: null,
          regen: 0,
          brief,
        },
        { signal }
      );
      if (generation !== generationRef.current) return;
      setLooks(Array.isArray(data.proposals) ? data.proposals : []);
      setCommonSections({
        fields: data.fields || null,
        terms: data.terms || null,
        gates: data.gates || null,
        verification: data.verification || null,
        drawTerms: data.drawTerms || null,
      });
      setPhase('looks');
    } catch (err) {
      if (generation !== generationRef.current) return;
      fail(err);
    }
  }, [brief, campaign?.id, templateId, startRequest, noteCall, fail]);

  /**
   * Atomic auto-start (create-everything amendment §2.7): open the panel in
   * full mode and generate from the ARGUMENT brief — never from possibly-
   * stale closure state (setBrief + generate would race the closure). Used
   * by the ?ai=full create-flow handoff; consumes one budget call like any
   * generation.
   */
  const beginFull = useCallback(async (prefill = {}) => {
    if (!campaign?.id) return;
    const usedBrief = { ...EMPTY_BRIEF, ...prefill };
    if (!usedBrief.topic.trim()) usedBrief.topic = campaign?.name || '';
    if (!usedBrief.topic.trim()) return;
    setBrief(usedBrief);
    setOpen(true);
    setMode('full');
    const { generation, signal } = startRequest();
    setPhase('looksLoading');
    setRecs([]);
    setError('');
    noteCall();
    try {
      const data = await requestCopyDraft(
        { campaignId: campaign.id, templateId, mode: 'full', scope: null, regen: 0, brief: usedBrief },
        { signal }
      );
      if (generation !== generationRef.current) return;
      setLooks(Array.isArray(data.proposals) ? data.proposals : []);
      setCommonSections({
        fields: data.fields || null,
        terms: data.terms || null,
        gates: data.gates || null,
        verification: data.verification || null,
        drawTerms: data.drawTerms || null,
      });
      setPhase('looks');
    } catch (err) {
      if (generation !== generationRef.current) return;
      fail(err);
    }
  }, [campaign?.id, campaign?.name, templateId, startRequest, noteCall, fail]);

  /** Per-card ↻ — regenerate ONE look in place (gallery only). Mid-proposal
   * the ORIGINAL prev is retained (the proposal object is untouched, F9). */
  const regenLook = useCallback(
    async (index) => {
      if (!campaign?.id) return;
      const { generation, signal } = startRequest();
      const key = `look:${index}`;
      const n = (regensRef.current[key] || 0) + 1;
      setRegeningLook(index);
      noteCall();
      try {
        const data = await requestCopyDraft(
          {
            campaignId: campaign.id,
            templateId,
            mode: 'full',
            scope: null,
            regen: n,
            brief: briefOrName(),
          },
          { signal }
        );
        if (generation !== generationRef.current) return;
        regensRef.current[key] = n;
        const fresh = data.proposals?.[0];
        if (fresh) setLooks((prev) => prev.map((look, i) => (i === index ? fresh : look)));
      } catch (err) {
        if (generation !== generationRef.current) return;
        fail(err);
      } finally {
        // Clear MY card's spinner even when superseded (a per-field ✦ can
        // abort this flight; a token-gated clear would leave the card stuck
        // disabled) — but never wipe a NEWER card's spinner.
        setRegeningLook((cur) => (cur === index ? null : cur));
      }
    },
    [campaign?.id, templateId, briefOrName, startRequest, noteCall, fail]
  );

  /** Use this look — whole-doc swap built from the pre-proposal doc. */
  const pickLook = useCallback(
    (index) => {
      const look = looksRef.current[index];
      if (!look || !replaceDoc) return;
      const baseDoc = proposalRef.current ? proposalRef.current.prev.doc : clone(docRef.current);
      if (lookBlockedReason(docRef.current, look)) return; // belt — the button is disabled with the reason
      const keep = { template: false, theme: false, copy: false };
      replaceDoc(buildLookDoc(baseDoc, look, keep));
      setProposal({ prev: { doc: baseDoc }, look, keep, adopted: false });
      setMediaHint(look.media?.note ? { kind: look.media.kind || 'none', note: look.media.note } : null);
      setSugs([]);
      setRecs([]); // belt for #198-4 — a picked look owns the ready view next
      setScope(null);
      setPhase('proposal');
      onPickLookRef.current?.(); // F12: subject → page, jump cleared, funnel remount
    },
    [replaceDoc]
  );

  /** Keep-my-template/theme/copy — rebuild the doc from prev with the toggle. */
  const toggleKeep = useCallback(
    (key) => {
      const p = proposalRef.current;
      if (!p || p.adopted) return;
      const keep = { ...p.keep, [key]: !p.keep[key] };
      replaceDoc(buildLookDoc(p.prev.doc, p.look, keep));
      setProposal({ ...p, keep });
    },
    [replaceDoc]
  );

  /** Discard / ↩ Revert look — restore the pre-proposal doc (works before AND
   * after adopt, until a save commits). */
  const revertLook = useCallback(() => {
    const p = proposalRef.current;
    if (!p || !replaceDoc) return;
    replaceDoc(p.prev.doc);
    setProposal(null);
    setMediaHint(null);
    setSugs([]);
    setScope(null);
    setPhase(looksRef.current.length ? 'looks' : 'brief');
  }, [replaceDoc]);

  /** Adopt — all-three-kept is a no-op discard (F9); otherwise the look's
   * landed copy becomes an `applied` review list (old = pre-look values),
   * FOLLOWED by the common fields/terms rows (create-everything amendment):
   * they are look-independent, arrive `open` (the look swap never wrote
   * them), and survive pick/revert cycles because they rebuild from the raw
   * response sections each adoption. */
  const adoptLook = useCallback(() => {
    const p = proposalRef.current;
    if (!p || p.adopted) return;
    if (p.keep.template && p.keep.theme && p.keep.copy) {
      revertLook();
      return;
    }
    setProposal({ ...p, adopted: true });
    const common = commonSections ? buildCommonRows(commonSections, docRef.current) : [];
    const copyRows = p.keep.copy ? [] : adoptedCopyRows(p.look, p.prev.doc, docRef.current);
    if (copyRows.length || common.length) {
      setSugs([...copyRows, ...common]);
      setScope(null);
      setPhase('ready');
    } else {
      setSugs([]);
      setPhase('brief');
    }
  }, [revertLook, commonSections, buildCommonRows]);

  /** Save success = the commit point — the proposal is no longer revertable.
   * The caller passes the proposal AS OF SAVE START (Codex diff #3): a look
   * picked while that PUT was in flight is NOT what the save committed, so it
   * must keep its banner, revert action and adoption gate. */
  const notifySaved = useCallback((committedProposal) => {
    setProposal((p) => (p === committedProposal ? null : p));
  }, []);

  const dismissMediaHint = useCallback(() => setMediaHint(null), []);

  return {
    open,
    setOpen,
    mode,
    setMode,
    phase,
    brief,
    setBrief,
    sugs,
    recs,
    scope,
    looks,
    proposal,
    mediaHint,
    regeningLook,
    error,
    retryIn,
    budget,
    generate,
    suggestField,
    acceptRow,
    keepRow,
    regenRow,
    applyAll,
    applySection,
    applyRec,
    jumpRec,
    discard,
    backToBrief,
    generateLooks,
    beginFull,
    regenLook,
    pickLook,
    toggleKeep,
    adoptLook,
    revertLook,
    notifySaved,
    dismissMediaHint,
    lookBaseDoc,
  };
}
