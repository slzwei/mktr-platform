import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestCopyDraft, rowDisabledReason, currentValueAt } from './studioAiApi';

/**
 * Studio AI assist state machine (PR 4) — the mock's semantics with the
 * Codex-folded corrections:
 *
 *  - phases: brief | loading | looksLoading | ready | looks | proposal |
 *    error | rate; Generate is disabled until the brief has a topic.
 *  - copy review rows: {path, label, section, value, old, state} where state ∈
 *    open | applied | kept. Accept re-gates the path against the CURRENT doc
 *    (action-time TOCTOU guard) and writes via setPath; Keep-mine restores
 *    `old` ONLY while the doc still holds the accepted AI value (operator
 *    edits always win); per-field ↻ regenerates scoped (regens[path]+1) and
 *    updates the doc only if the row was applied AND untouched, else the new
 *    value arrives as `open`.
 *  - campaign scoping: EVERYTHING resets on campaign change, in-flight
 *    requests are ignored via a generation token (a 45s response for
 *    campaign A must never land in campaign B).
 *  - budget meter: client-side sliding-minute ESTIMATE (server window is
 *    authoritative; its 429 retryAfterSec drives the countdown).
 *
 * Full mode (CO-1 looks/proposals) plugs into this hook in the next
 * checkpoint; the mode toggle exists now, disabled.
 */

export const AI_TONES = ['Friendly', 'Formal', 'Urgent', 'Playful'];

const EMPTY_BRIEF = { topic: '', audience: '', objective: '', mustInclude: '', tone: 'Friendly' };

export default function useStudioAi({ campaign, doc, setPath }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('copy');
  const [phase, setPhase] = useState('brief');
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [sugs, setSugs] = useState([]);
  const [scope, setScope] = useState(null); // {path, label} | null
  const [error, setError] = useState('');
  const [retryIn, setRetryIn] = useState(0);
  const [budgetTick, setBudgetTick] = useState(0);

  const regensRef = useRef({});
  const callTimesRef = useRef([]);
  const generationRef = useRef(0);
  const abortRef = useRef(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  // Mirror of `sugs` for event handlers — doc writes (setPath) must happen in
  // the handler, never inside a setSugs updater (updaters run at render time).
  const sugsRef = useRef(sugs);
  sugsRef.current = sugs;

  const patchRow = useCallback((index, patch) => {
    setSugs((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
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
    setScope(null);
    setError('');
    setRetryIn(0);
    regensRef.current = {};
    return () => abortRef.current?.abort(); // unmount / next campaign
  }, [campaign?.id]);

  // 429 countdown → back to the brief when it expires.
  useEffect(() => {
    if (phase !== 'rate' || retryIn <= 0) return undefined;
    const t = setTimeout(() => {
      setRetryIn((s) => {
        if (s <= 1) {
          setPhase('brief');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
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

  const toRows = useCallback((draft) => {
    const current = docRef.current;
    return (draft || []).map((row) => ({
      ...row,
      old: currentValueAt(current, row.path),
      state: 'open',
      disabledReason: rowDisabledReason(current, row.path),
    }));
  }, []);

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
    const ac = new AbortController();
    abortRef.current = ac;
    return { generation: generationRef.current, signal: ac.signal };
  }, []);

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
      setSugs(toRows(data.draft));
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
      const usedBrief = brief.topic.trim() ? brief : { ...brief, topic: campaign?.name || '' };
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
        setSugs(toRows(data.draft));
        setPhase('ready');
      } catch (err) {
        if (generation !== generationRef.current) return;
        fail(err);
      }
    },
    [brief, campaign?.id, campaign?.name, templateId, startRequest, noteCall, toRows, fail]
  );

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
      setPath(row.path, row.value);
      patchRow(index, { disabledReason: null, state: 'applied' });
    },
    [setPath, patchRow]
  );

  /** Keep-mine — restores old ONLY if the doc still holds the AI value. */
  const keepRow = useCallback(
    (index) => {
      const row = sugsRef.current[index];
      if (!row || row.state === 'kept') return;
      if (row.state === 'applied' && currentValueAt(docRef.current, row.path) === row.value) {
        setPath(row.path, row.old);
      }
      patchRow(index, { state: 'kept' });
    },
    [setPath, patchRow]
  );

  /** Scoped per-row regenerate (regens[path]+1), replace in place. */
  const regenRow = useCallback(
    async (index) => {
      const row = sugs[index];
      if (!row || !campaign?.id) return;
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
            brief: brief.topic.trim() ? brief : { ...brief, topic: campaign?.name || '' },
          },
          { signal }
        );
        if (generation !== generationRef.current) return;
        regensRef.current[row.path] = n;
        const fresh = data.draft?.[0];
        if (!fresh) return;
        const cur = sugsRef.current[index];
        if (!cur || cur.path !== row.path) return;
        if (cur.state === 'applied' && currentValueAt(docRef.current, cur.path) === cur.value) {
          // untouched applied row: swap the doc value atomically, stay applied
          setPath(cur.path, fresh.value);
          patchRow(index, { value: fresh.value });
        } else {
          patchRow(index, {
            value: fresh.value,
            state: 'open',
            disabledReason: rowDisabledReason(docRef.current, cur.path),
          });
        }
      } catch (err) {
        if (generation !== generationRef.current) return;
        fail(err);
      }
    },
    [sugs, campaign?.id, campaign?.name, templateId, brief, startRequest, noteCall, fail, setPath, patchRow]
  );

  /** Apply every remaining OPEN row (each re-gated). Copy writes can't change
   * any gate (gates hang off toggles/enums, never copy paths), so re-gating
   * against the pre-batch doc is sound. */
  const applyAll = useCallback(() => {
    const patches = sugsRef.current.map((row) => {
      if (row.state !== 'open') return null;
      const reason = rowDisabledReason(docRef.current, row.path);
      if (reason) return { disabledReason: reason };
      setPath(row.path, row.value);
      return { disabledReason: null, state: 'applied' };
    });
    setSugs((prev) => prev.map((row, i) => (patches[i] ? { ...row, ...patches[i] } : row)));
  }, [setPath]);

  const discard = useCallback(() => {
    setSugs([]);
    setScope(null);
    setPhase('brief');
  }, []);

  const backToBrief = useCallback(() => {
    setScope(null);
    setPhase('brief');
  }, []);

  return {
    open,
    setOpen,
    mode,
    setMode,
    phase,
    brief,
    setBrief,
    sugs,
    scope,
    error,
    retryIn,
    budget,
    generate,
    suggestField,
    acceptRow,
    keepRow,
    regenRow,
    applyAll,
    discard,
    backToBrief,
  };
}
