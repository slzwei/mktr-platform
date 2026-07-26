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
 *   BUY  = life events 25 + family gap 20 + capacity 15
 *          + coverage headroom −10..0                         (raw 60) /60
 *   consumerScore = clamp(0, Σ all components, 100)  ← stored default sort
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

export const SCORING_ALGORITHM_VERSION = 'score/v1';

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
    buy: ['life_events', 'family_gap', 'capacity', 'coverage_headroom'],
  },
  components: {
    engagement: { maxPoints: 15 },
    contactability: { maxPoints: 10 },
    market_fit: { maxPoints: 15 },
    life_events: { maxPoints: 25 },
    family_gap: { maxPoints: 20 },
    capacity: { maxPoints: 15 },
    // Negative max: a penalty component. Range −10..0.
    coverage_headroom: { maxPoints: -10 },
  },
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
  'market_fit', 'life_events', 'family_gap', 'capacity', 'coverage_headroom',
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

  const lastSeen = telemetry?.lastSeenAt ? new Date(telemetry.lastSeenAt).getTime() : null;
  const recency = lastSeen ? decayFactor(now - lastSeen, cfg.decay?.engagementHalfLifeDays) : 1;

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

const RULES = {
  engagement: (facts, telemetry, cfg, now) => scoreEngagement(telemetry, cfg, now),
  contactability: (facts, telemetry) => scoreContactability(telemetry),
  market_fit: (facts, telemetry, cfg) => scoreMarketFit(facts, cfg),
  life_events: (facts, telemetry, cfg, now) => scoreLifeEvents(facts, cfg, now),
  family_gap: (facts, telemetry, cfg) => scoreFamilyGap(facts, cfg),
  capacity: (facts, telemetry, cfg) => scoreCapacity(facts, cfg),
  coverage_headroom: (facts, telemetry, cfg) => scoreCoverageHeadroom(facts, cfg),
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
 * @param {Object} input.telemetry  {signupCount, verifiedSignupCount, lastSeenAt, marketingConsent, hasEmail, whatsappReachable}
 * @param {Object} input.config     configJson from enrichment_scoring_configs (merged over defaults)
 * @param {number} input.now        epoch ms — injected so scoring is reproducible in tests and backfills
 * @returns {{meetScore:number|null, buyScore:number|null, consumerScore:number|null,
 *            breakdown:Object, algorithmVersion:string}}
 */
export function scoreConsumer({ facts = {}, telemetry = {}, config, now = Date.now() } = {}) {
  const cfg = normalizeConfig(config);
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
    algorithmVersion: cfg.algorithmVersion || SCORING_ALGORITHM_VERSION,
    breakdown: {
      algorithmVersion: cfg.algorithmVersion || SCORING_ALGORITHM_VERSION,
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
