/**
 * The creation-time scoring block (campaign-scoring-editor §3.3, Phase 2).
 *
 * Sits under the brief fields on BOTH create surfaces. Always says which
 * sheet a new campaign with these picks would score under (pre-create there
 * is no campaign id, so the strict resolve starts at the PRODUCT tier);
 * "Tailor scoring →" opens the shared editor prefilled from the brief's own
 * picks — age bands become the dial's curve, a specific language becomes the
 * target segment (seed-once: later brief edits never overwrite the doc).
 *
 * The parent create flow calls `ref.submit(campaignId)` AFTER the campaign
 * row commits and AWAITS it before navigating (§3.3's ordering): untouched →
 * nothing is minted and it resolves null; tailored → a draft composed
 * server-side, approved in the same breath when "apply immediately" is
 * ticked. Errors THROW — the caller toasts and navigates anyway, because
 * scoring must never block creation.
 *
 * Flag-off backends 404 the resolve; the block degrades to one neutral line
 * and submit() becomes a no-op.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchScoringSheetForProduct, createScoringDraft, approveScoringDraft,
} from '@/api/adminV2';
import ScoringSheetEditor from '@/components/adminv2/ScoringSheetEditor';
import {
  TIER_LABEL, patchFromDoc, docFromSheet, buildAgeCurveFromBands,
} from '@/lib/adminV2/scoringLabels';

/** One bound per call — the client's fetch carries no signal of its own. */
const SUBMIT_TIMEOUT_MS = 30_000;

const CreateScoringBlock = forwardRef(function CreateScoringBlock({ product, ageBands, language }, ref) {
  const sheet = useQuery({
    queryKey: ['adminV2', 'scoringSheetSeed', product || 'global'],
    queryFn: () => fetchScoringSheetForProduct(product || null),
    staleTime: 30_000,
    retry: (count, err) => err?.status !== 404 && count < 2,
  });
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState(null);
  const [applyNow, setApplyNow] = useState(true);
  // The baseline CAPTURED WHEN TAILORING OPENED (review M3): submit must
  // carry the version the admin actually saw beside the document they
  // edited — reading the live query at submit time would let a background
  // refetch or a product-pick change advance the expected version under an
  // old-product document, and the §4.5 guard would wave through an approve
  // it exists to 409.
  const seededRef = useRef(null);

  const unavailable = sheet.isError && sheet.error?.status === 404;

  const seed = () => {
    const base = docFromSheet(sheet.data);
    // The brief already answered the audience questions — prefill, don't
    // re-ask. Deterministic and slope-legal by construction (§3.1).
    const curve = buildAgeCurveFromBands(ageBands || []);
    if (curve) {
      base.ageCurve = curve;
      base._ageBands = [...ageBands];
    }
    if (language === 'any') {
      // An EXPLICIT "any language" clears inherited targeting — keeping a
      // Chinese-targeted market_fit under an any-language brief contradicts
      // the pick (review B2). Unanswered stays "no prefill": inherit.
      base.targetSegments = [];
    } else if (language) {
      base.targetSegments = [{ language, weight: 1 }];
    }
    seededRef.current = {
      version: sheet.data?.version ?? 0,
      houseDefault: sheet.data?.houseDefault,
    };
    return base;
  };

  useImperativeHandle(ref, () => ({
    /** Mint (and optionally activate) the tailored sheet for the campaign
     *  that was JUST created. Untouched block → null, nothing written.
     *  THROWS on failure — with `draftVersion` attached when the draft
     *  landed but activation did not, so callers can say which half. */
    async submit(campaignId) {
      // SNAPSHOT EVERYTHING BEFORE THE FIRST AWAIT (round-2 M1): the page
      // stays interactive during the awaits — "Skip tailoring" nulls the
      // ref and a reopen replaces it — so every later read must come from
      // these captures, never from live state.
      const seeded = seededRef.current;
      const submittedDoc = doc;
      const apply = applyNow;
      if (!campaignId || unavailable || !open || !submittedDoc || !seeded) return null;
      // The apiClient declares a timeout it never attaches to fetch (review
      // M2) — without our own bound a stalled call would hold the create
      // flow's navigation hostage forever.
      const withTimeout = (promise, label) => Promise.race([
        promise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`${label} did not confirm within 30s — check the campaign page's scoring card.`)), SUBMIT_TIMEOUT_MS);
        }),
      ]);
      const draft = await withTimeout(
        createScoringDraft(campaignId, patchFromDoc(submittedDoc, seeded.houseDefault)),
        'Saving the scoring sheet'
      );
      if (apply) {
        try {
          await withTimeout(
            approveScoringDraft(draft.version, seeded.version),
            'Activating the scoring sheet'
          );
        } catch (err) {
          // Partial success is a DIFFERENT message (review B3): the draft
          // exists — a blind retry would mint a duplicate. NOTE the copy is
          // "didn't confirm", not "not applied" (round-2 B1): a timed-out
          // race leaves the request running, and a slow approve may still
          // land after this rejection.
          const e = err instanceof Error ? err : new Error('Activation failed');
          e.draftVersion = draft.version;
          throw e;
        }
      }
      return draft;
    },
  }), [open, doc, applyNow, unavailable]);

  if (unavailable) {
    // Neutral by contract (review B1): the flag gates AUTHORING, not
    // resolution — approved sheets keep scoring — and a 404 cannot even
    // distinguish the flag from an old deploy. Claim nothing.
    return (
      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>
        Lead scoring: controls are unavailable on this backend.
      </div>
    );
  }

  const s = sheet.data;
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="av2-microcaps">Lead scoring</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
          {sheet.isLoading
            ? 'checking which rules apply…'
            : s
              ? <>Leads will score with the <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{TIER_LABEL[s.scope] || s.scope}</span>{s.version > 0 ? ` (edition #${s.version})` : ''}.</>
              : 'scoring rules unavailable right now.'}
        </span>
        {s && !open && (
          <button
            type="button" className="av2-btn av2-btn--sm"
            onClick={() => { setDoc(seed()); setOpen(true); }}
          >
            Tailor scoring for this campaign →
          </button>
        )}
        {open && (
          <button
            type="button" className="av2-btn av2-btn--sm"
            title="Drop the tailored sheet — the campaign will inherit instead"
            onClick={() => { setOpen(false); setDoc(null); seededRef.current = null; }}
          >
            Skip tailoring
          </button>
        )}
      </div>

      {open && doc && (
        <div style={{ marginTop: 10 }}>
          <ScoringSheetEditor doc={doc} houseDefault={s?.houseDefault} onChange={setDoc} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={applyNow}
              onChange={(e) => setApplyNow(e.target.checked)}
            />
            Apply immediately on create (otherwise it waits as a draft on the campaign page)
          </label>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Saved as this campaign's own sheet when you create — other campaigns are untouched.
          </div>
        </div>
      )}
    </div>
  );
});

export default CreateScoringBlock;
