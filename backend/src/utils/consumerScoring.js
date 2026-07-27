/**
 * Deterministic consumer scoring v1 — the MEET × BUY engine
 * (docs/plans/consumer-profile-enrichment.md §7.1 + §7.1b).
 *
 * PURE: resolved facts + telemetry in → scores out. No I/O, no clock (the
 * caller passes `now`), no database. Everything the sweep needs to be
 * reproducible lives in the arguments, so a score can always be re-derived
 * and explained from the stored breakdown.
 *
 * TWO SUB-SCORES, ONE PASS (§7.1b). "Will they meet the consultant" and
 * "will they buy" are different questions with different drivers; the same
 * component math is grouped two ways:
 *
 *   MEET = engagement 15 + contactability 10 + market fit 15  (raw 40) ×2.5
 *   BUY  = life events 25 + family gap 20 + capacity 15 + age 10
 *          + coverage headroom −10..0                         (raw 70) /70
 *   consumerScore = clamp(0, Σ all components, 100)  ← stored default sort
 *                   (raw ceiling is 110 since v3 — the clamp absorbs it)
 *
 * WEIGHTS LIVE IN CONFIG, RULES LIVE IN CODE. `configJson` carries
 * per-component `maxPoints`, the `groups` map, `targetSegments`, and the
 * decay/confidence knobs (EnrichmentScoringConfig.js). Each rule here
 * returns a normalized FRACTION in 0..1 meaning "how much of this
 * component's max applies"; points = fraction × maxPoints. So recalibrating
 * is one config row, and regrouping Meet/Buy is a config row too — neither
 * is a deploy (§7.1b).
 *
 * PENALTIES CARRY THEIR SIGN IN `maxPoints`, NEVER IN THE FRACTION.
 * coverage_headroom has maxPoints −10, so a fraction of 1 ("fully covered")
 * yields −10. Signing the fraction as well would multiply two negatives into
 * a bonus for already-insured people — precisely inverting the component.
 *
 * ROUND ONCE (§7.1). Fractions and points stay floating all the way
 * through; clamping happens per sub-score and rounding happens exactly once,
 * at the very end. Rounding intermediates would make the parts stop summing
 * to the whole and make the breakdown a liar.
 *
 * SCOREABILITY (§7.1b) — a number must never be fabricated from ignorance:
 *   - BUY is NULL unless ≥1 FACT component is assessed. Unknown capacity
 *     must not read as "low capacity"; "—" is the honest answer.
 *   - MEET always computes: engagement + contactability are behavioral and
 *     always assessable. Market fit contributes only when the language or
 *     ethnicity fact exists — its absence shrinks Meet's evidence, and the
 *     breakdown says so rather than silently scoring zero.
 *
 * The unknown-vs-zero distinction is the whole point of `state` in the
 * breakdown: `unknown` means we never asked, `assessed` means we know and
 * this is the answer. A UI that renders them identically is a bug.
 */

import { MIN_LLM_CONFIDENCE } from './factTaxonomy.js';

/**
 * v2: engagement recency anchors to the person's NEWEST signup
 * (prospects.createdAt) instead of consumers.lastSeenAt. lastSeenAt refreshes
 * on spine touches that are RESPONSES (per-campaign engagement), and the
 * capability-vs-response contract (per-campaign-lead-scoring.md §3.2/§16 B1)
 * says responses must not move the person-grain score. Migration 094 appends
 * the config row that makes every stored score recompute under this version.
 *
 * v3: the age component (per-campaign-lead-scoring.md §13.2 / PR B). A CURVE
 * over age — not a band match — fed by identity.birth_year_band, weighted low
 * (10 vs family_gap's 20) because age is a prior: once income and children
 * are actually known they should dominate. Migration 095 appends the config
 * row (curve + weight + grouping) that makes every stored score recompute.
 */
export const SCORING_ALGORITHM_VERSION = 'score/v3';

/** SGT is UTC+8 year-round (no DST) — the one offset this file needs. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Config v1 — Shawn calibrates these against his own closing intuition
 * before agents ever see a number (§11 step 4, §18 A3). Shipped as the seed
 * row in migration 093; every later calibration is an append-only row with
 * a higher version, and old breakdowns stay interpretable because each
 * stamps the version that scored it.
 */
export const DEFAULT_SCORING_CONFIG = {
  algorithmVersion: SCORING_ALGORITHM_VERSION,
  // Grouping is data, not code (§7.1b) — regrouping is a config insert.
  groups: {
    meet: ['engagement', 'contactability', 'market_fit'],
    buy: ['life_events', 'family_gap', 'capacity', 'age', 'coverage_headroom'],
  },
  components: {
    engagement: { maxPoints: 15 },
    contactability: { maxPoints: 10 },
    market_fit: { maxPoints: 15 },
    life_events: { maxPoints: 25 },
    family_gap: { maxPoints: 20 },
    capacity: { maxPoints: 15 },
    // Deliberately LOW: age is a prior, not evidence. When income/children
    // are actually known those components (15/20) must dominate it.
    age: { maxPoints: 10 },
    // Negative max: a penalty component. Range −10..0.
    coverage_headroom: { maxPoints: -10 },
  },
  /**
   * The age curve (§13.2) — piecewise-constant over AGE IN YEARS, evaluated
   * against the current SGT year. Defined over age, NEVER over birth-year
   * band strings: a band-keyed table silently rots one band every five years
   * as the population ages through it. Each segment applies to ages up to
   * and including `upTo`; the final `upTo: null` segment is the open tail.
   * Values are fractions in 0..1 of the component's maxPoints. Shape (owner
   * tunes via a config row, not a deploy): under 25 low, rising through
   * 25-29, peaking 35-44, easing off after 50.
   */
  ageCurve: [
    { upTo: 24, value: 0.25 },
    { upTo: 29, value: 0.55 },
    { upTo: 34, value: 0.8 },
    { upTo: 44, value: 1 },
    { upTo: 49, value: 0.8 },
    { upTo: 59, value: 0.55 },
    { upTo: null, value: 0.3 },
  ],
  // Which market we're currently selling into. Retargeting = one new row.
  targetSegments: [{ language: 'zh', ethnicity: 'chinese', weight: 1 }],
  decay: {
    lifeEventHalfLifeDays: 365, // a trigger a year old is worth half
    engagementHalfLifeDays: 180,
  },
  minFactConfidence: MIN_LLM_CONFIDENCE,
};

/** Components whose evidence is FACTS (vs behavioral telemetry). */
export const FACT_COMPONENTS = new Set([
  'market_fit', 'life_events', 'family_gap', 'capacity', 'age', 'coverage_headroom',
]);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Kill negative zero. A zero-fraction penalty computes 0 × −10 = −0, which
 * is === 0 but survives into the stored breakdown JSON as `-0` and reads as
 * a bug to anyone auditing a score.
 */
const noNegZero = (n) => (n === 0 ? 0 : n);

/** Exponential half-life decay, floored at 0. */
function decayFactor(ageMs, halfLifeDays) {
  if (!(halfLifeDays > 0)) return 1;
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / (halfLifeDays * DAY_MS));
}

/**
 * End of a "YYYY-QN" quarter, in SGT, as an epoch ms.
 * A life event dated 2026-Q1 stops being "recent" from the END of Q1 —
 * decaying from the start would over-age an event that may have happened on
 * the quarter's last day.
 */
export function quarterEndMs(when) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(when || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  // First instant of the NEXT quarter, SGT, minus 1ms.
  const nextMonth = q * 3; // Q1→3 (Apr), Q2→6 (Jul), Q3→9 (Oct), Q4→12 (Jan+1)
  const utcMs = Date.UTC(year + (nextMonth === 12 ? 1 : 0), nextMonth === 12 ? 0 : nextMonth, 1);
  return utcMs - SGT_OFFSET_MS - 1;
}

/** Position on an ordered ladder → 0..1 fraction via an explicit table. */
function ladder(table, value) {
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null;
}

const INCOME_LADDER_ANNUAL = { '<40k': 0.10, '40-80k': 0.35, '80-120k': 0.60, '120-200k': 0.85, '>200k': 1.0 };
const INCOME_LADDER_MONTHLY = { '<3k': 0.10, '3-6k': 0.35, '6-10k': 0.60, '10-15k': 0.85, '>15k': 1.0 };
const PROPERTY_LADDER = { none: 0.10, hdb: 0.35, condo: 0.75, landed: 1.0 };
const EMPLOYMENT_LADDER = {
  unemployed: 0.10, student: 0.15, nsf: 0.20, retired: 0.40, employed: 0.80, self_employed: 0.90,
};
const CHILDREN_BAND_LADDER = { '0': 0.15, '1': 0.60, '2': 0.85, '3_plus': 1.0 };
const MARITAL_LADDER = { single: 0.20, widowed: 0.50, divorced: 0.60, married: 0.80 };
const LIFE_EVENT_WEIGHT = {
  new_child: 1.0, marriage: 0.90, new_home: 0.80, bereavement: 0.75, divorce: 0.70, new_job: 0.60,
};
/** Coverage that actually closes the protection gap we sell into. */
const CORE_COVERAGE = ['life', 'health', 'ci'];

/**
 * Blend several optional signals, renormalizing over the ones present.
 * A consumer who only ever told us their income still gets the full 0..1
 * range on capacity — missing signals must not drag a score toward zero,
 * because that would be scoring ignorance as a negative.
 */
function blend(parts) {
  const present = parts.filter((p) => p && p.fraction !== null && p.fraction !== undefined);
  if (!present.length) return null;
  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  if (!(totalWeight > 0)) return null;
  return present.reduce((s, p) => s + p.fraction * p.weight, 0) / totalWeight;
}

const unknown = (note) => ({ state: 'unknown', fraction: null, basis: [], note });
const assessed = (fraction, basis, note) => ({ state: 'assessed', fraction, basis, note });

/**
 * A fact counts only if it clears the confidence floor (§7.1). LLM-extracted
 * facts arrive with a confidence; form/manual facts are 1.0 by construction.
 */
function factOf(facts, key, minConfidence) {
  const f = facts?.[key];
  if (!f) return null;
  if (typeof f.confidence === 'number' && f.confidence < minConfidence) return null;
  return f;
}

// ── MEET components ────────────────────────────────────────────────────────

function scoreEngagement(telemetry, cfg, now) {
  const signups = Number(telemetry?.signupCount) || 0;
  if (signups <= 0) {
    // A consumer row exists but carries no signup — nothing behavioral yet.
    return unknown('no signups recorded');
  }
  const depth = signups >= 4 ? 1.0 : { 1: 0.35, 2: 0.65, 3: 0.85 }[signups] ?? 1.0;

  // Recency anchors to the newest SIGNUP (capability-era anchor), never to
  // lastSeenAt: lastSeenAt refreshes on response touches, and a response on
  // one campaign must not refresh the person's standing everywhere (§16 B1).
  const newestSignup = telemetry?.newestSignupAt ? new Date(telemetry.newestSignupAt).getTime() : null;
  const recency = newestSignup ? decayFactor(now - newestSignup, cfg.decay?.engagementHalfLifeDays) : 1;

  // Verified signups are the ones that proved a live phone — they say more
  // about willingness to engage than a raw form submit does.
  const verified = Number(telemetry?.verifiedSignupCount) || 0;
  const verifiedBonus = signups > 0 ? 0.15 * clamp(verified / signups, 0, 1) : 0;

  const fraction = clamp(depth * recency + verifiedBonus, 0, 1);
  return assessed(fraction, [], `${signups} signup(s), ${verified} verified`);
}

function scoreContactability(telemetry) {
  // Every term is a channel we can actually reach them on today. This is
  // always assessable: absence of consent IS the answer, not ignorance.
  const marketing = telemetry?.marketingConsent ? 0.45 : 0;
  const verified = (Number(telemetry?.verifiedSignupCount) || 0) > 0 ? 0.30 : 0;
  const email = telemetry?.hasEmail ? 0.15 : 0;
  const wa = telemetry?.whatsappReachable ? 0.10 : 0;
  const fraction = clamp(marketing + verified + email + wa, 0, 1);
  const have = [
    telemetry?.marketingConsent && 'marketing consent',
    verified && 'verified phone',
    telemetry?.hasEmail && 'email',
    telemetry?.whatsappReachable && 'WhatsApp',
  ].filter(Boolean);
  return assessed(fraction, [], have.length ? `reachable via ${have.join(', ')}` : 'no reachable channel');
}

/**
 * Market fit — LANGUAGE-PRIMARY (§7.2). Language is what actually decides
 * whether a Mandarin-speaking consultant can serve them; ethnicity is a
 * weaker proxy and, per the taxonomy, is only ever self-declared.
 */
function scoreMarketFit(facts, cfg) {
  const segments = Array.isArray(cfg.targetSegments) ? cfg.targetSegments : [];
  if (!segments.length) return unknown('no target segment configured');

  const min = cfg.minFactConfidence;
  const lang = factOf(facts, 'identity.preferred_language', min);
  const eth = factOf(facts, 'identity.ethnicity', min);
  if (!lang && !eth) return unknown('no language or ethnicity fact');

  let best = 0;
  let matched = null;
  for (const seg of segments) {
    const weight = typeof seg.weight === 'number' ? clamp(seg.weight, 0, 1) : 1;
    if (seg.language && lang?.value?.v === seg.language) {
      if (weight > best) { best = weight; matched = `language ${seg.language}`; }
      continue;
    }
    // Ethnicity alone is a half-strength signal — it suggests the market but
    // doesn't establish the servicing language.
    if (seg.ethnicity && eth?.value?.v === seg.ethnicity) {
      const half = weight * 0.5;
      if (half > best) { best = half; matched = `ethnicity ${seg.ethnicity}`; }
    }
  }
  const basis = [lang?.observationId, eth?.observationId].filter(Boolean);
  return assessed(best, basis, matched ? `matches ${matched}` : 'outside target segment');
}

// ── BUY components ─────────────────────────────────────────────────────────

function scoreLifeEvents(facts, cfg, now) {
  const min = cfg.minFactConfidence;
  const ev = factOf(facts, 'life_event.recent', min);
  if (!ev) return unknown('no recent life event on record');

  const base = LIFE_EVENT_WEIGHT[ev.value?.v] ?? 0.5;
  // Prefer the stated quarter; fall back to when we observed it.
  const atMs = quarterEndMs(ev.value?.when) ?? new Date(ev.sourceEventAt).getTime();
  const aged = decayFactor(now - atMs, cfg.decay?.lifeEventHalfLifeDays);
  const fraction = clamp(base * aged, 0, 1);
  const whenLabel = ev.value?.when ? ` (${ev.value.when})` : '';
  return assessed(fraction, [ev.observationId].filter(Boolean), `${ev.value?.v}${whenLabel}`);
}

/**
 * Family gap — who depends on this person's income. The detailed children
 * array outranks the count band when both exist (the band is a lower bound
 * for '3_plus'; the array carries actual composition) — taxonomy §4.
 */
function scoreFamilyGap(facts, cfg) {
  const min = cfg.minFactConfidence;
  const children = factOf(facts, 'family.children', min);
  const band = factOf(facts, 'family.children_count_band', min);
  const marital = factOf(facts, 'family.marital_status', min);
  const parents = factOf(facts, 'family.parents_alive', min);

  let childFraction = null;
  const basis = [];
  if (children && Array.isArray(children.value?.v) && (children.value.v.length || children.value?.complete)) {
    const n = children.value.v.length;
    childFraction = n >= 3 ? 1.0 : { 0: 0.15, 1: 0.60, 2: 0.85 }[n] ?? 1.0;
    basis.push(...(children.basis || [children.observationId]).filter(Boolean));
  } else if (band) {
    childFraction = ladder(CHILDREN_BAND_LADDER, band.value?.v);
    if (band.observationId) basis.push(band.observationId);
  }

  const maritalFraction = marital ? ladder(MARITAL_LADDER, marital.value?.v) : null;
  if (marital?.observationId && maritalFraction !== null) basis.push(marital.observationId);

  // Living parents are potential dependants in the SG sandwich-generation sense.
  const parentsFraction = parents ? (parents.value?.v === true ? 0.7 : 0.1) : null;
  if (parents?.observationId && parentsFraction !== null) basis.push(parents.observationId);

  const fraction = blend([
    { fraction: childFraction, weight: 0.60 },
    { fraction: maritalFraction, weight: 0.30 },
    { fraction: parentsFraction, weight: 0.10 },
  ]);
  if (fraction === null) return unknown('no family facts');

  const notes = [
    childFraction !== null && (children ? `${children.value.v.length} child(ren)` : `children ${band.value?.v}`),
    maritalFraction !== null && marital.value?.v,
    parentsFraction !== null && `parents ${parents.value?.v ? 'alive' : 'not living'}`,
  ].filter(Boolean);
  return assessed(clamp(fraction, 0, 1), basis, notes.join(', '));
}

/** Capacity — can they fund a policy. Annual income band is the PR 0 question. */
function scoreCapacity(facts, cfg) {
  const min = cfg.minFactConfidence;
  const annual = factOf(facts, 'finance.annual_income_band', min);
  const monthly = factOf(facts, 'finance.income_band', min);
  const property = factOf(facts, 'assets.property', min);
  const employment = factOf(facts, 'career.employment', min);

  const basis = [];
  let incomeFraction = null;
  if (annual) {
    incomeFraction = ladder(INCOME_LADDER_ANNUAL, annual.value?.v);
    if (annual.observationId) basis.push(annual.observationId);
  } else if (monthly) {
    incomeFraction = ladder(INCOME_LADDER_MONTHLY, monthly.value?.v);
    if (monthly.observationId) basis.push(monthly.observationId);
  }

  const propertyFraction = property ? ladder(PROPERTY_LADDER, property.value?.v) : null;
  if (property?.observationId && propertyFraction !== null) basis.push(property.observationId);

  const employmentFraction = employment ? ladder(EMPLOYMENT_LADDER, employment.value?.v) : null;
  if (employment?.observationId && employmentFraction !== null) basis.push(employment.observationId);

  const fraction = blend([
    { fraction: incomeFraction, weight: 0.60 },
    { fraction: propertyFraction, weight: 0.25 },
    { fraction: employmentFraction, weight: 0.15 },
  ]);
  if (fraction === null) return unknown('no income, property or employment fact');

  const notes = [
    incomeFraction !== null && `income ${(annual ?? monthly).value?.v}`,
    propertyFraction !== null && `property ${property.value?.v}`,
    employmentFraction !== null && employment.value?.v,
  ].filter(Boolean);
  return assessed(clamp(fraction, 0, 1), basis, notes.join(', '));
}

/** Calendar year at `now` in SGT — the year ages are evaluated against. */
function sgtYear(now) {
  return new Date(now + SGT_OFFSET_MS).getUTCFullYear();
}

/**
 * Piecewise-constant curve lookup. Segments are scanned in order; the first
 * with `age <= upTo` (or the `upTo: null` open tail) wins. Values are
 * clamped into 0..1 — the fraction contract belongs to the engine, and a
 * mis-authored config row must not leak a >1 fraction into points. Returns
 * null when no segment covers the age (a curve authored without a tail).
 */
function curveValueAt(curve, age) {
  for (const seg of curve) {
    if (seg == null) continue;
    const upTo = seg.upTo;
    if (upTo === null || upTo === undefined || age <= Number(upTo)) {
      const v = Number(seg.value);
      return Number.isFinite(v) ? clamp(v, 0, 1) : null;
    }
  }
  return null;
}

/**
 * Age — a PRIOR on life stage, from identity.birth_year_band (the ledger
 * never stores exact ages — they go stale; bands don't). A curve, not a
 * range match: a range scores everyone inside it identically and puts a
 * cliff at the boundary.
 *
 * The band spans 5 birth years and the curve is segmented over AGE, so a
 * band can straddle a segment boundary. Overlap rule (§13.2): every birth
 * year in the band contributes equally (1/5th), so each curve segment is
 * weighted by the fraction of the band's years that fall inside it. Ages
 * are (SGT year − birth year) — band-granularity data doesn't support
 * birthday precision, and evaluating against `now` is what keeps the curve
 * from rotting as the population ages through fixed bands.
 */
function scoreAge(facts, cfg, now) {
  const min = cfg.minFactConfidence;
  const band = factOf(facts, 'identity.birth_year_band', min);
  if (!band) return unknown('no birth-year band on record');

  const m = /^(\d{4})-(\d{4})$/.exec(String(band.value?.v || ''));
  if (!m) return unknown('unparseable birth-year band');
  const start = Number(m[1]);
  const end = Number(m[2]);
  // Ledger bands are taxonomy-validated to exactly 5 years; tolerate any
  // sane span, but refuse to iterate a corrupt one.
  if (end < start || end - start > 100) return unknown('unparseable birth-year band');

  const curve = Array.isArray(cfg.ageCurve) ? cfg.ageCurve : [];
  const year = sgtYear(now);
  const values = [];
  for (let y = start; y <= end; y += 1) {
    // Future birth years (a not-yet-complete band edge) clamp to age 0 and
    // take the curve's youngest segment rather than inventing negative ages.
    const v = curveValueAt(curve, Math.max(0, year - y));
    if (v !== null) values.push(v);
  }
  if (!values.length) return unknown('no usable age curve configured');

  const fraction = clamp(values.reduce((s, v) => s + v, 0) / values.length, 0, 1);
  return assessed(
    fraction,
    [band.observationId].filter(Boolean),
    `born ${band.value.v} — age ${Math.max(0, year - end)}-${Math.max(0, year - start)} in ${year}`
  );
}

/**
 * Coverage headroom — a PENALTY (−10..0). Someone already carrying life +
 * health + CI has little room left; someone explicitly carrying nothing has
 * full headroom and takes no penalty.
 *
 * Only a COMPLETE coverage list can penalize: a partial list ("they
 * mentioned health") cannot establish what they DON'T have, and penalizing
 * on it would punish people for having said more.
 */
function scoreCoverageHeadroom(facts, cfg) {
  const min = cfg.minFactConfidence;
  const cov = factOf(facts, 'finance.existing_coverage', min);
  if (!cov || !Array.isArray(cov.value?.v)) return unknown('no coverage fact');
  if (cov.value?.complete !== true) return unknown('coverage list incomplete — cannot infer gaps');

  const held = new Set(cov.value.v);
  if (held.has('none') || cov.value.v.length === 0) {
    return assessed(0, (cov.basis || [cov.observationId]).filter(Boolean), 'no existing coverage — full headroom');
  }
  const coreHeld = CORE_COVERAGE.filter((c) => held.has(c)).length;
  // Positive fraction: 1 = all three core lines held. The minus lives in
  // this component's maxPoints (−10), so points come out negative.
  const fraction = clamp(coreHeld / CORE_COVERAGE.length, 0, 1);
  return assessed(
    fraction,
    (cov.basis || [cov.observationId]).filter(Boolean),
    coreHeld ? `holds ${CORE_COVERAGE.filter((c) => held.has(c)).join(', ')}` : 'no core coverage'
  );
}

// ── LEAD-GRAIN components (per-campaign-lead-scoring.md §3.2) ──────────────
//
// These read RESPONSE inputs: evidence attributed to (person, THIS campaign).
// They exist only in the lead scorer — a response on campaign A must never
// enter campaign B's response terms, and the way that is guaranteed is that
// the person-grain scorer has no rule for them at all.

/**
 * Response to THIS pitch — WhatsApp reads of messages this lead owns
 * (wa_message_sends ⋈ wa_message_statuses, §5).
 *
 * UNKNOWN vs ZERO is the whole subtlety. Never having messaged someone is not
 * evidence that they ignore us, so a lead that owns no message is `unknown`.
 * A lead we DID message and who never read is `assessed` at 0 — that is a
 * real, negative finding.
 *
 * Depth then recency, mirroring scoreEngagement: reading more than once says
 * more than reading once, and a read from last year says less than one from
 * yesterday. Decayed at WRITE time against the caller's `now` (§6).
 */
function scoreResponse(telemetry, cfg, now) {
  const sent = Number(telemetry?.ownedMessageCount) || 0;
  if (sent <= 0) return unknown('no message owned by this lead yet');

  const reads = Array.isArray(telemetry?.readAt) ? telemetry.readAt : [];
  if (!reads.length) {
    return assessed(0, [], `${sent} message(s) sent, none read`);
  }

  const depth = reads.length >= 3 ? 1 : { 1: 0.6, 2: 0.85 }[reads.length] ?? 1;
  const newest = Math.max(...reads.map((r) => new Date(r).getTime()).filter(Number.isFinite));
  const recency = Number.isFinite(newest)
    ? decayFactor(now - newest, cfg.decay?.engagementHalfLifeDays)
    : 1;

  const fraction = clamp(depth * recency, 0, 1);
  return assessed(fraction, [], `${reads.length} of ${sent} message(s) read`);
}

/**
 * The AI screening call's outcome for THIS lead (§13.1).
 *
 * Reads ONLY the normalized signal (utils/screeningSignal.js) — never the raw
 * provider `checks` object, whose keys are whatever an operator last typed
 * into the Retell console.
 *
 * Blended so a missing sub-signal doesn't drag the component down: interest
 * is optional in the agent config and `agreedToMeet` has no configured check
 * at all today, so renormalizing over what is present is the difference
 * between "we didn't ask" and "they said no".
 */
function scoreScreening(telemetry) {
  const s = telemetry?.screening;
  if (!s || (s.verdict === null && s.interest === null && s.sentiment === null && s.agreedToMeet === null)) {
    return unknown('no screening call outcome');
  }

  // A not_qualified verdict is terminal — the lead never reaches an agent
  // (screeningGate.markScreeningFailed) — so it dominates rather than blends.
  if (s.verdict === 'not_qualified') {
    return assessed(0, [], 'screening verdict: not qualified');
  }

  const fraction = blend([
    { fraction: s.verdict === 'qualified' ? 1 : null, weight: 0.4 },
    { fraction: s.agreedToMeet === null ? null : (s.agreedToMeet ? 1 : 0), weight: 0.3 },
    { fraction: s.interest, weight: 0.2 },
    { fraction: s.sentiment, weight: 0.1 },
  ]);
  if (fraction === null) return unknown('no scoreable screening signal');

  const said = [
    s.verdict === 'qualified' && 'qualified',
    s.labels?.interest && `interest ${s.labels.interest}`,
    s.labels?.sentiment && `sentiment ${s.labels.sentiment}`,
    s.agreedToMeet === true && 'agreed to meet',
    s.agreedToMeet === false && 'declined to meet',
  ].filter(Boolean);
  return assessed(clamp(fraction, 0, 1), [], said.join(', ') || 'screened');
}

const RULES = {
  engagement: (facts, telemetry, cfg, now) => scoreEngagement(telemetry, cfg, now),
  contactability: (facts, telemetry) => scoreContactability(telemetry),
  market_fit: (facts, telemetry, cfg) => scoreMarketFit(facts, cfg),
  life_events: (facts, telemetry, cfg, now) => scoreLifeEvents(facts, cfg, now),
  family_gap: (facts, telemetry, cfg) => scoreFamilyGap(facts, cfg),
  capacity: (facts, telemetry, cfg) => scoreCapacity(facts, cfg),
  age: (facts, telemetry, cfg, now) => scoreAge(facts, cfg, now),
  coverage_headroom: (facts, telemetry, cfg) => scoreCoverageHeadroom(facts, cfg),
  // Lead-grain only. Present in this shared map because computeScore looks
  // rules up by name, but reachable only when the config carries the
  // component — which normalizeLeadConfig does and normalizeConfig does not.
  response: (facts, telemetry, cfg, now) => scoreResponse(telemetry, cfg, now),
  screening: (facts, telemetry) => scoreScreening(telemetry),
};

/** Merge a stored config over the defaults without losing unspecified knobs. */
export function normalizeConfig(configJson) {
  const c = configJson && typeof configJson === 'object' ? configJson : {};
  return {
    ...DEFAULT_SCORING_CONFIG,
    ...c,
    groups: { ...DEFAULT_SCORING_CONFIG.groups, ...(c.groups || {}) },
    components: { ...DEFAULT_SCORING_CONFIG.components, ...(c.components || {}) },
    decay: { ...DEFAULT_SCORING_CONFIG.decay, ...(c.decay || {}) },
    // Top-level like decay/targetSegments, NOT inside components.age: the
    // shallow components merge would let a later `{age:{maxPoints}}`
    // recalibration row silently drop a curve nested there.
    ageCurve: Array.isArray(c.ageCurve) && c.ageCurve.length
      ? c.ageCurve
      : DEFAULT_SCORING_CONFIG.ageCurve,
    targetSegments: Array.isArray(c.targetSegments) ? c.targetSegments : DEFAULT_SCORING_CONFIG.targetSegments,
    minFactConfidence: typeof c.minFactConfidence === 'number'
      ? c.minFactConfidence
      : DEFAULT_SCORING_CONFIG.minFactConfidence,
  };
}

/**
 * Score one consumer.
 *
 * @param {Object} input
 * @param {Object} input.facts      resolveCurrentFacts() output (key → {value, confidence, observationId, basis, …})
 * @param {Object} input.telemetry  {signupCount, verifiedSignupCount, newestSignupAt, marketingConsent, hasEmail, whatsappReachable}
 * @param {Object} input.config     configJson from enrichment_scoring_configs (merged over defaults)
 * @param {number} input.now        epoch ms — injected so scoring is reproducible in tests and backfills
 * @returns {{meetScore:number|null, buyScore:number|null, consumerScore:number|null,
 *            breakdown:Object, algorithmVersion:string}}
 */
export function scoreConsumer({ facts = {}, telemetry = {}, config, now = Date.now() } = {}) {
  const cfg = normalizeConfig(config);
  return computeScore({ cfg, facts, telemetry, now, algorithmVersion: cfg.algorithmVersion });
}

/**
 * The shared engine behind scoreConsumer and scoreLead. `cfg.components` and
 * `cfg.groups` decide what is computed and how it is grouped, so the two
 * grains differ only in the config handed in — the math, the round-once rule
 * and the unknown-vs-zero contract are the same code for both.
 */
function computeScore({ cfg, facts, telemetry, now, algorithmVersion }) {
  const components = {};

  for (const [name, def] of Object.entries(cfg.components)) {
    const rule = RULES[name];
    const maxPoints = Number(def?.maxPoints) || 0;
    if (!rule) {
      // A config naming a component this build doesn't implement must not
      // silently vanish from the breakdown — an unexplained gap in the parts
      // is worse than an explicit "not implemented here".
      components[name] = {
        state: 'unknown', points: 0, maxPoints, basisObservationIds: [], note: 'no rule for this component',
      };
      continue;
    }
    const res = rule(facts, telemetry, cfg, now);
    components[name] = {
      state: res.state,
      points: res.state === 'assessed' ? noNegZero(res.fraction * maxPoints) : 0,
      maxPoints,
      basisObservationIds: res.basis || [],
      note: res.note,
    };
  }

  const sumGroup = (names) => names
    .filter((n) => components[n])
    .reduce((s, n) => s + components[n].points, 0);
  const rawMaxOf = (names) => names
    .filter((n) => components[n])
    .reduce((s, n) => s + Math.max(0, components[n].maxPoints), 0);

  const meetNames = cfg.groups.meet || [];
  const buyNames = cfg.groups.buy || [];

  // MEET: computes whenever ANY of its components is assessed (engagement +
  // contactability are behavioral, so in practice always).
  const meetAssessed = meetNames.some((n) => components[n]?.state === 'assessed');
  const meetRawMax = rawMaxOf(meetNames);
  const meetScore = meetAssessed && meetRawMax > 0
    ? Math.round(clamp(sumGroup(meetNames) / meetRawMax, 0, 1) * 100)
    : null;

  // BUY: needs ≥1 assessed FACT component — unknown capacity must not fake a
  // number (§7.1b). The headroom penalty alone counts as evidence: knowing
  // someone is already fully covered is a real, scoreable finding.
  const buyFactAssessed = buyNames.some(
    (n) => FACT_COMPONENTS.has(n) && components[n]?.state === 'assessed'
  );
  const buyRawMax = rawMaxOf(buyNames);
  const buyScore = buyFactAssessed && buyRawMax > 0
    ? Math.round(clamp(sumGroup(buyNames) / buyRawMax, 0, 1) * 100)
    : null;

  // Blended total — the stored default sort key. NULL only when neither
  // half could be scored at all.
  const allNames = [...new Set([...meetNames, ...buyNames])];
  const consumerScore = (meetScore === null && buyScore === null)
    ? null
    : Math.round(clamp(sumGroup(allNames), 0, 100));

  return {
    meetScore,
    buyScore,
    consumerScore,
    algorithmVersion: algorithmVersion || SCORING_ALGORITHM_VERSION,
    breakdown: {
      algorithmVersion: algorithmVersion || SCORING_ALGORITHM_VERSION,
      groups: {
        meet: { score: meetScore, rawMax: meetRawMax, components: meetNames.filter((n) => components[n]) },
        buy: { score: buyScore, rawMax: buyRawMax, components: buyNames.filter((n) => components[n]) },
      },
      // Points are rounded for DISPLAY only, to 2dp — the scores above were
      // computed from the unrounded values (round-once, §7.1).
      components: Object.fromEntries(
        Object.entries(components).map(([n, c]) => [n, { ...c, points: noNegZero(Math.round(c.points * 100) / 100) }])
      ),
      completeness: {
        assessed: Object.values(components).filter((c) => c.state === 'assessed').length,
        total: Object.keys(components).length,
      },
    },
  };
}

// ── THE LEAD GRAIN (per-campaign-lead-scoring.md §4) ───────────────────────

/**
 * lead/v1. Stamped on prospects.scoringAlgorithmVersion, and deliberately a
 * SEPARATE lineage from SCORING_ALGORITHM_VERSION: the two grains answer
 * different questions over different inputs, so a person-grain recalibration
 * should not silently claim to have rescored every lead, nor the reverse.
 */
export const LEAD_ALGORITHM_VERSION = 'lead/v1';

/**
 * The response components, defaulted IN CODE rather than seeded by a config
 * migration. There is nothing to recompute: every lead starts unscored, so
 * the first sweep scores the whole population anyway, and a migration whose
 * only job is to trigger a recompute that is already happening buys a frozen
 * historical row for nothing. Recalibrating later is an ordinary append-only
 * config row carrying `leadComponents`, exactly like any other weight change.
 *
 * They sit in MEET, not Buy: reading a message and taking a screening call
 * are evidence about whether this person will engage a consultant, not about
 * what they can afford. Buy stays fact-driven, which is what keeps the
 * fresh-grad-vs-buyer split (§1) meaningful.
 */
export const DEFAULT_LEAD_COMPONENTS = {
  response: { maxPoints: 15 },
  screening: { maxPoints: 20 },
};

/**
 * Merge the lead-grain components into a config. Kept separate from
 * `components` in the stored JSON so the person-grain scorer never sees them:
 * grouping them into `groups.meet` for everyone would put their maxPoints
 * into the consumer's Meet denominator while the consumer can never assess
 * them, deflating every person score by construction.
 */
export function normalizeLeadConfig(configJson) {
  const base = normalizeConfig(configJson);
  const c = configJson && typeof configJson === 'object' ? configJson : {};
  const leadComponents = { ...DEFAULT_LEAD_COMPONENTS, ...(c.leadComponents || {}) };
  const meet = [...(base.groups.meet || [])];
  for (const name of Object.keys(leadComponents)) {
    if (!meet.includes(name)) meet.push(name);
  }
  return {
    ...base,
    components: { ...base.components, ...leadComponents },
    groups: { ...base.groups, meet },
  };
}

/**
 * Score one LEAD — (person × campaign).
 *
 * Same facts as the person (the spine exists so every lead can read them),
 * plus telemetry that is lead-scoped where §3.4 says it must be:
 *   - `newestSignupAt` is THIS lead's own createdAt, not the person's newest
 *   - `marketingConsent` is canMarketTo semantics at (consumer, campaign)
 *   - `ownedMessageCount` / `readAt` cover only messages this lead owns (§5)
 *   - `screening` is this lead's own normalized call outcome (§13.1)
 * Person-wide capability terms (signup counts, email, WhatsApp frontier) are
 * shared by every lead BY DESIGN — capability travels, responses do not.
 *
 * @returns {{meetScore:number|null, buyScore:number|null, score:number|null,
 *            breakdown:Object, algorithmVersion:string}}
 */
export function scoreLead({ facts = {}, telemetry = {}, config, now = Date.now() } = {}) {
  const cfg = normalizeLeadConfig(config);
  const r = computeScore({ cfg, facts, telemetry, now, algorithmVersion: LEAD_ALGORITHM_VERSION });
  // `score` rather than `consumerScore`: same number, named for the column it
  // lands in (prospects.score).
  return {
    meetScore: r.meetScore,
    buyScore: r.buyScore,
    score: r.consumerScore,
    algorithmVersion: r.algorithmVersion,
    breakdown: { ...r.breakdown, events: leadEvents(telemetry, cfg, now) },
  };
}

/**
 * The response events behind the score, with their timestamps and UNDECAYED
 * weights (§6). Undecayed on purpose: the stored number already has the decay
 * baked in as of scoreComputedAt, so repeating a decayed figure here would
 * just be the same number twice. What a reader needs is what happened, when,
 * and how much it was worth at full strength — from which the decay between
 * `at` and `scoreComputedAt` explains the difference.
 *
 * Newest first, and bounded: a lead with hundreds of reads must not turn the
 * breakdown into an unbounded jsonb column.
 */
const MAX_STORED_EVENTS = 50;

function leadEvents(telemetry, cfg, now) {
  const events = [];

  for (const at of (Array.isArray(telemetry?.readAt) ? telemetry.readAt : [])) {
    const ms = new Date(at).getTime();
    if (!Number.isFinite(ms)) continue;
    events.push({
      type: 'wa_read',
      at: new Date(ms).toISOString(),
      component: 'response',
      undecayedWeight: Number(cfg.components?.response?.maxPoints) || 0,
      ageDays: Math.max(0, Math.round((now - ms) / DAY_MS)),
    });
  }

  const s = telemetry?.screening;
  if (s && (s.verdict || s.interest !== null || s.sentiment !== null || s.agreedToMeet !== null)) {
    const ms = s.decidedAt ? new Date(s.decidedAt).getTime() : NaN;
    events.push({
      type: 'screening',
      at: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      component: 'screening',
      undecayedWeight: Number(cfg.components?.screening?.maxPoints) || 0,
      verdict: s.verdict,
      // Labels, not the raw provider keys — §13.1's whole point.
      interest: s.labels?.interest || null,
      sentiment: s.labels?.sentiment || null,
      agreedToMeet: s.agreedToMeet,
      schemaVersion: s.schemaVersion || null,
      ...(Number.isFinite(ms) ? { ageDays: Math.max(0, Math.round((now - ms) / DAY_MS)) } : {}),
    });
  }

  return events
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, MAX_STORED_EVENTS);
}
