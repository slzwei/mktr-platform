/**
 * The screening signal contract (per-campaign-lead-scoring.md §13.1).
 *
 * WHY THIS EXISTS. v1 of the plan specced a scoring event on `agreedToMeet`.
 * There is no such field. The stored verdict detail is `reason`,
 * `interestLevel`, `summary`, `sentiment`, `recordingUrl`, `transcript`, plus
 * the provider's whole `custom_analysis_data` object under `checks`
 * (retellScreeningService.js:671-686). Scoring straight off `checks` would
 * bind the score to whatever an operator last typed into the Retell console:
 * rename a check, and every lead silently re-scores. So the scorer reads ONLY
 * the normalized shape below, and the normalization is versioned.
 *
 * WHAT IS ACTUALLY AVAILABLE, verified rather than assumed. The configured
 * agent's `post_call_analysis_data` is exactly three fields
 * (docs/plans/retell-screening-calls.md:524-527):
 *   - `qualified`            boolean, required  → already a real COLUMN,
 *                            prospects.screeningVerdict (Prospect.js:308-312),
 *                            so it is read from there, not from checks.
 *   - `qualification_reason` string             → free text, never scored.
 *   - `interest_level`       enum, OPTIONAL, choices hot | warm | cold.
 * Plus Retell's own `call_analysis.user_sentiment`, whose vocabulary is
 * Positive | Neutral | Negative (retellService.js:235-238).
 *
 * THERE IS NO MEET SIGNAL TODAY. `meet_consultant` (and `sg_pr`,
 * `age_in_range`) appear in this codebase in exactly one place — an
 * illustrative comment at retellScreeningService.js:682 — and in no agent
 * configuration. `agreedToMeet` is therefore a declared slot that normalizes
 * to null until a real check produces it, NOT a field invented to satisfy a
 * plan. When one is configured, add its key to MEET_CHECK_KEYS and bump the
 * schema version; nothing else changes.
 *
 * VERSIONED because the mapping is a judgement (warm → 0.6 is a choice, not a
 * fact). A stored breakdown records which mapping produced it, so an old score
 * stays explainable after the vocabulary moves — the same contract
 * scoredConfigVersion gives the weights.
 */

export const SCREENING_SIGNAL_VERSION = 'screening/v1';

/** Retell's interest_level enum → an ordered strength in 0..1. */
const INTEREST_LADDER = { hot: 1, warm: 0.6, cold: 0.15 };

/** Retell's user_sentiment enum → an ordered strength in 0..1. */
const SENTIMENT_LADDER = { positive: 1, neutral: 0.5, negative: 0 };

/**
 * Provider check keys that would mean "they agreed to meet a consultant".
 * EMPTY BY DESIGN — see the header. Adding one here is the whole change.
 */
export const MEET_CHECK_KEYS = Object.freeze([]);

/** Coerce Retell's loose booleans (true, 'true') without accepting garbage. */
function asBool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

/**
 * Normalize one lead's screening state into the scoreable shape.
 *
 * @param {object} prospect  needs `screeningVerdict` and `screeningMetadata`
 * @returns {{
 *   schemaVersion: string,
 *   verdict: 'qualified'|'not_qualified'|null,
 *   interest: number|null,   // 0..1, from interest_level
 *   sentiment: number|null,  // 0..1, from user_sentiment
 *   agreedToMeet: boolean|null,
 *   decidedAt: string|null,
 *   labels: {interest: string|null, sentiment: string|null},
 * }}
 */
export function normalizeScreeningSignal(prospect) {
  const detail = prospect?.screeningMetadata?.verdictDetail || null;

  // The verdict comes from the COLUMN, never from checks.qualified: the column
  // is what the state machine actually transitioned on (screeningGate.js
  // applyQualifiedVerdict / markScreeningFailed), and the raw check is only
  // the evidence that produced it.
  const raw = prospect?.screeningVerdict;
  const verdict = raw === 'qualified' || raw === 'not_qualified' ? raw : null;

  const interestLabel = typeof detail?.interestLevel === 'string'
    ? detail.interestLevel.trim().toLowerCase()
    : null;
  const sentimentLabel = typeof detail?.sentiment === 'string'
    ? detail.sentiment.trim().toLowerCase()
    : null;

  // An unrecognized label scores as UNKNOWN (null), never as its lowest rung —
  // a renamed enum must not read as "cold".
  const interest = interestLabel && Object.prototype.hasOwnProperty.call(INTEREST_LADDER, interestLabel)
    ? INTEREST_LADDER[interestLabel]
    : null;
  const sentiment = sentimentLabel && Object.prototype.hasOwnProperty.call(SENTIMENT_LADDER, sentimentLabel)
    ? SENTIMENT_LADDER[sentimentLabel]
    : null;

  let agreedToMeet = null;
  for (const key of MEET_CHECK_KEYS) {
    const v = asBool(detail?.checks?.[key]);
    if (v !== null) { agreedToMeet = v; break; }
  }

  return {
    schemaVersion: SCREENING_SIGNAL_VERSION,
    verdict,
    interest,
    sentiment,
    agreedToMeet,
    decidedAt: typeof detail?.decidedAt === 'string' ? detail.decidedAt : null,
    labels: {
      interest: interest === null ? null : interestLabel,
      sentiment: sentiment === null ? null : sentimentLabel,
    },
  };
}

/** True when there is anything at all to score. */
export function hasScreeningSignal(signal) {
  return Boolean(
    signal && (signal.verdict !== null || signal.interest !== null
      || signal.sentiment !== null || signal.agreedToMeet !== null)
  );
}
