import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Campaign } from '@/api/entities';
import { upgradeDesignConfig, isV2 } from '@/lib/designConfigV2';

/**
 * useStudioDoc — the Campaign Studio document lifecycle (Studio PR 3).
 *
 * Load: the stored design_config (any version) is upgraded IN MEMORY to a
 * canonical v2 document (pure + idempotent — a v2 doc round-trips unchanged).
 * Nothing persists until the operator saves; the first save is what commits a
 * campaign to v2 (and the backend still 422s that save until
 * DESIGN_CONFIG_V2_WRITES_ENABLED is on — surfaced as a typed 'writes-gated'
 * error, expected while the rollout is dark).
 *
 * Save: PUTs the WHOLE document. The server clamp normalizes it
 * (designConfigV2Clamp — lengths/enums, admin policies, alias scrub), so on
 * success we adopt the RESPONSE document as the new baseline: the Studio always
 * shows what actually persisted, never a flattering local copy.
 *
 * Concurrency (Codex F6): edits made while a PUT is in flight are never
 * clobbered — if the doc still === the sent snapshot we adopt the server doc
 * wholesale (clean); if the operator kept typing we keep their doc, adopt the
 * server doc as baseline only, and stay dirty.
 *
 * Draw invariant (Codex F9, typed in PR 5): the common cases are blocked
 * CLIENT-side before the PUT (enabled draw needs non-empty terms AND a valid
 * closesAt — mirrors ensureDrawTermsVersion); server draw 422s carry typed
 * codes (DRAW_TERMS_REQUIRED / DRAW_CLOSES_AT_REQUIRED /
 * DRAW_CLOSES_AT_LOCKED).
 */

const clone = (v) => JSON.parse(JSON.stringify(v));

export function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar-true YYYY-MM-DD (Codex diff-review #7 — the server validates real
 * dates, so `2026-02-31` must fail HERE, not only at the PUT). */
export function isValidYmd(value) {
  if (typeof value !== 'string' || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Client mirror of the server draw invariant (campaignService.ensureDrawTermsVersion). */
export function drawInvariantProblem(doc) {
  if (!doc || doc.luckyDraw?.enabled !== true) return null;
  const closesAt = doc.luckyDraw?.closesAt;
  if (!isValidYmd(closesAt)) {
    return {
      field: 'closesAt',
      message: 'Save blocked: a lucky-draw campaign needs a valid draw close date (set by ops on the draw record).',
    };
  }
  const terms = typeof doc.form?.terms?.html === 'string' ? doc.form.terms.html.trim() : '';
  if (!terms) {
    return {
      field: 'terms',
      message: 'Save blocked: a lucky-draw campaign needs non-empty campaign T&Cs before it can be saved.',
    };
  }
  return null;
}

function classifySaveError(err) {
  const code = err?.data?.code;
  if (err?.status === 422 && code === 'DESIGN_CONFIG_VERSION_UNSUPPORTED') {
    return {
      kind: 'writes-gated',
      message:
        'The server has not enabled Campaign Studio saves yet (DESIGN_CONFIG_V2_WRITES_ENABLED is off). Your edits are kept here — nothing was stored.',
    };
  }
  if (err?.status === 409 && code === 'DESIGN_CONFIG_VERSION_CONFLICT') {
    return { kind: 'version-conflict', message: err.message };
  }
  // Typed draw codes (PR 5). DRAW_CLOSES_AT_LOCKED also lands here — the
  // date field is the thing to fix (revert it or void/recreate via ops).
  // The old message-regex fallback is gone (teardown PR): every deployed
  // backend emits the typed codes.
  if (
    err?.status === 422 &&
    (code === 'DRAW_TERMS_REQUIRED' || code === 'DRAW_CLOSES_AT_REQUIRED' || code === 'DRAW_CLOSES_AT_LOCKED')
  ) {
    return {
      kind: 'draw-invariant',
      section: 'form',
      field: code === 'DRAW_TERMS_REQUIRED' ? 'terms' : 'closesAt',
      message: err.message,
    };
  }
  return { kind: 'error', message: err?.message || 'Save failed. Please try again.' };
}

export default function useStudioDoc(campaign) {
  const [doc, setDoc] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const seededForRef = useRef(null);

  // Seed once per campaign id. Background refetches of the same campaign never
  // reseed (they would clobber unsaved edits); switching campaigns always does.
  useEffect(() => {
    if (!campaign?.id || seededForRef.current === campaign.id) return;
    seededForRef.current = campaign.id;
    const upgraded = upgradeDesignConfig(campaign.design_config || {});
    setDoc(upgraded);
    setBaseline(clone(upgraded));
    setSaving(false);
    setSaveError(null);
    setSavedAt(null);
  }, [campaign?.id, campaign?.design_config]);

  const dirty = useMemo(
    () => !!doc && !!baseline && JSON.stringify(doc) !== JSON.stringify(baseline),
    [doc, baseline]
  );

  /** Immutable structural edit — fn receives a deep draft clone to mutate. */
  const mut = useCallback((fn) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  /** Atomic whole-doc swap (Studio PR 4 — AI look proposals apply/revert whole
   * documents; dirty stays DERIVED from doc-vs-baseline, so restoring a
   * previous doc self-corrects it). */
  const replaceDoc = useCallback((next) => {
    if (!next || typeof next !== 'object') return;
    setDoc(clone(next));
  }, []);

  const setPath = useCallback(
    (path, value) => {
      mut((draft) => {
        const keys = path.split('.');
        let node = draft;
        for (let i = 0; i < keys.length - 1; i += 1) {
          const key = keys[i];
          if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
          node = node[key];
        }
        node[keys[keys.length - 1]] = value;
      });
    },
    [mut]
  );

  // `extra` merges into the PUT body — the guard modal's "Save & continue"
  // passes { slug } when a slug draft is pending so nothing is silently lost
  // (slug is a campaign column; same endpoint, own field).
  const save = useCallback(async (extra = {}) => {
    if (!doc || !campaign?.id || saving) return { ok: false, reason: 'busy' };
    const drawProblem = drawInvariantProblem(doc);
    if (drawProblem) {
      setSaveError({ kind: 'draw-invariant', section: 'form', ...drawProblem });
      return { ok: false, reason: 'draw-invariant', problem: drawProblem };
    }
    setSaving(true);
    setSaveError(null);
    const snapshot = doc;
    try {
      const updated = await Campaign.update(campaign.id, { design_config: snapshot, ...extra });
      const serverDoc = updated?.design_config;
      const adopted = serverDoc && typeof serverDoc === 'object' ? serverDoc : snapshot;
      setBaseline(clone(adopted));
      // Codex F6: only adopt the server doc as the WORKING doc when the operator
      // did not edit during the flight; otherwise keep their edits (still dirty
      // against the new baseline).
      setDoc((prev) => (prev === snapshot ? clone(adopted) : prev));
      setSavedAt(Date.now());
      return { ok: true, campaign: updated };
    } catch (err) {
      const classified = classifySaveError(err);
      setSaveError(classified);
      return { ok: false, reason: 'error', error: err, classified };
    } finally {
      setSaving(false);
    }
  }, [doc, campaign?.id, saving]);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    doc,
    baseline,
    dirty,
    saving,
    savedAt,
    saveError,
    clearSaveError,
    mut,
    setPath,
    replaceDoc,
    save,
    // True when the STORED campaign doc is still v1 — the first Studio save is
    // the migration moment (surfaced in the save cluster copy).
    isStoredV1: !!campaign && !isV2(campaign.design_config),
  };
}
