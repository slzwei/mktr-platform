import {
  SCOREABLE_COMPONENTS, DEFAULT_LEAD_COMPONENTS, normalizeConfig,
} from './consumerScoring.js';
import { LANGUAGES, ETHNICITIES } from './factTaxonomy.js';

/**
 * SEMANTIC invariants for a scoring config
 * (docs/plans/per-campaign-lead-scoring.md §8.1, PR C).
 *
 * WHY THIS EXISTS. A closed FACT vocabulary does not validate a SCORING
 * config — `factTaxonomy` validates facts. Nothing until now checked the
 * config itself, and the read path is permissive by design:
 *
 *   - `normalizeConfig` merges unknown component keys straight through
 *     (consumerScoring.js), and the scorer keeps them as zero-point entries;
 *     until this file's twin fix they also inflated the group denominator,
 *     deflating everyone in the group.
 *   - a non-positive (or explicitly zeroed) half-life silently disables decay
 *     (`decayFactor`: `if (!(halfLifeDays > 0)) return 1`), so a config can
 *     turn off recency for the whole population and read as valid.
 *   - nothing bounded a weight, so one component could carry the entire score.
 *
 * A schema-valid config can therefore still be absurd. These are the checks
 * that make "the AI wrote it" survivable: every one of them is a rule a human
 * reviewer would apply, written down so it runs on every save.
 *
 * WHAT THIS IS NOT. It cannot tell you a config is WRONG for the business —
 * only that it is not self-defeating. Distribution simulation (§8.2) is the
 * control for "these weights are legal and still score everyone 90+".
 *
 * Returns { ok: true, config } with the NORMALIZED config, or
 * { ok: false, error } — the same shape as `normalizeBrief`
 * (utils/campaignBrief.js), so service callers translate it to a 422 the same
 * way.
 */

/** A row binds exactly one scope; migration 100 enforces the same in SQL. */
export const SCORING_CONFIG_STATUSES = Object.freeze(['draft', 'approved', 'superseded']);

/**
 * Bounds a single component's weight. Wide enough that recalibration never
 * fights the validator (the shipped defaults span −10..25), tight enough that
 * a runaway value — an AI emitting 10000, or a stray unit change — cannot
 * silently swamp every other component.
 */
export const MAX_COMPONENT_POINTS = 50;

/**
 * No single component may exceed this share of the POSITIVE total. The point
 * is not the exact number; it is that a score nobody can move by more than
 * one input is a single-signal score wearing a breakdown's clothes.
 */
export const MAX_COMPONENT_SHARE = 0.4;

/** Adjacent age-curve segments may not jump by more than this. */
export const MAX_AGE_CURVE_SLOPE = 0.5;

const MAX_AGE_CURVE_SEGMENTS = 24;

/**
 * Serialized-size ceiling, measured on the document as it would be STORED
 * (after §4.1 composition, before the semantic checks below). Generous — the
 * shipped default is ~1KB — but a bound: configJson is an unindexed jsonb
 * column that rides every resolution read, and "the editor sent 40MB of
 * segments" should be a 422, not a table problem.
 */
export const MAX_SCORING_CONFIG_BYTES = 64 * 1024;

/**
 * Sign map (campaign-scoring-editor §4.7). Penalties carry their sign in
 * maxPoints (consumerScoring.js header) — so the sign IS the semantics, and a
 * flipped one silently inverts the component: a positive coverage_headroom
 * would pay people for being already insured. Everything not named here is a
 * bonus and must not go negative.
 */
export const PENALTY_COMPONENTS = Object.freeze(new Set(['coverage_headroom']));

const MAX_TARGET_SEGMENTS = 8;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** @type {(error: string) => {ok: false, error: string}} */
const fail = (error) => ({ ok: false, error });
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Component maps are validated identically wherever they appear — `components`
 * (person grain) and `leadComponents` (lead grain, folded into the same scorer
 * by `normalizeLeadConfig`). Both are checked so a per-campaign row cannot
 * tune `response`/`screening` into absurdity while passing on `components`.
 */
function checkComponentMap(raw, label) {
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) return `${label} must be an object.`;

  for (const [name, def] of Object.entries(raw)) {
    if (!SCOREABLE_COMPONENTS.includes(name)) {
      // REJECTED, not zeroed. A name this build cannot score is either a typo
      // or an invention; both are bugs, and both used to survive as a silent
      // denominator inflation.
      return `${label}.${name} is not a scoreable component. Known: ${SCOREABLE_COMPONENTS.join(', ')}.`;
    }
    if (!isPlainObject(def)) return `${label}.${name} must be an object with maxPoints.`;
    const extra = Object.keys(def).filter((k) => k !== 'maxPoints');
    if (extra.length) return `${label}.${name} has unknown keys: ${extra.join(', ')}.`;
    if (!isFiniteNumber(def.maxPoints)) return `${label}.${name}.maxPoints must be a finite number.`;
    if (Math.abs(def.maxPoints) > MAX_COMPONENT_POINTS) {
      return `${label}.${name}.maxPoints must be within ±${MAX_COMPONENT_POINTS} (got ${def.maxPoints}).`;
    }
    // The sign is the semantics (§4.7): a penalty's negative max is what makes
    // it subtract, so flipping it inverts the component rather than erroring.
    // Zero is legal either way — it just switches the component off.
    if (PENALTY_COMPONENTS.has(name) && def.maxPoints > 0) {
      return `${label}.${name} is a penalty — its maxPoints must be ≤ 0 (got ${def.maxPoints}). `
        + 'A positive value would REWARD what the component exists to subtract for.';
    }
    if (!PENALTY_COMPONENTS.has(name) && def.maxPoints < 0) {
      return `${label}.${name}.maxPoints must be ≥ 0 (got ${def.maxPoints}) — only penalties `
        + `(${[...PENALTY_COMPONENTS].join(', ')}) carry negative weight.`;
    }
  }
  return null;
}

/**
 * The share check, run over a set of components that score TOGETHER. Called
 * once per grain, because the two grains have different totals: the lead grain
 * adds `response`/`screening` to the same arithmetic, which changes every
 * other component's share.
 */
function checkDominance(components, grainLabel) {
  const positive = Object.entries(components)
    .map(([name, def]) => /** @type {[string, number]} */ ([name, Number(def?.maxPoints) || 0]))
    .filter(([, pts]) => pts > 0);

  const total = positive.reduce((s, [, pts]) => s + pts, 0);
  if (total <= 0) return `${grainLabel} has no component with positive weight — nothing could ever score.`;

  for (const [name, pts] of positive) {
    if (pts / total > MAX_COMPONENT_SHARE) {
      const pct = Math.round((pts / total) * 100);
      return `${grainLabel} component "${name}" is ${pct}% of the positive total — the cap is `
        + `${Math.round(MAX_COMPONENT_SHARE * 100)}%. Spread the weight or raise the others.`;
    }
  }
  return null;
}

function checkAgeCurve(curve) {
  if (!Array.isArray(curve) || curve.length === 0) return 'ageCurve must be a non-empty array.';
  if (curve.length > MAX_AGE_CURVE_SEGMENTS) {
    return `ageCurve has ${curve.length} segments; the cap is ${MAX_AGE_CURVE_SEGMENTS}.`;
  }

  let prevUpTo = -Infinity;
  let prevValue = null;

  for (let i = 0; i < curve.length; i += 1) {
    const seg = curve[i];
    if (!isPlainObject(seg)) return `ageCurve[${i}] must be an object.`;
    const extra = Object.keys(seg).filter((k) => k !== 'upTo' && k !== 'value');
    if (extra.length) return `ageCurve[${i}] has unknown keys: ${extra.join(', ')}.`;

    if (!isFiniteNumber(seg.value) || seg.value < 0 || seg.value > 1) {
      return `ageCurve[${i}].value must be a fraction in 0..1 (got ${seg.value}).`;
    }

    const isLast = i === curve.length - 1;
    // Only the final segment is the open tail; an interior null would make
    // every later segment unreachable rather than erroring.
    if (seg.upTo === null) {
      if (!isLast) return `ageCurve[${i}].upTo is null but is not the last segment.`;
    } else {
      if (isLast) return 'ageCurve must end with an open tail segment ({ upTo: null }).';
      if (!Number.isInteger(seg.upTo) || seg.upTo < 0 || seg.upTo > 120) {
        return `ageCurve[${i}].upTo must be a whole age in 0..120, or null (got ${seg.upTo}).`;
      }
      if (seg.upTo <= prevUpTo) return `ageCurve[${i}].upTo must increase (${seg.upTo} after ${prevUpTo}).`;
      prevUpTo = seg.upTo;
    }

    if (prevValue !== null && Math.abs(seg.value - prevValue) > MAX_AGE_CURVE_SLOPE) {
      return `ageCurve[${i}] jumps ${Math.abs(seg.value - prevValue).toFixed(2)} from the previous `
        + `segment — the cap is ${MAX_AGE_CURVE_SLOPE}. A cliff this steep makes one birthday `
        + 'decide the score.';
    }
    prevValue = seg.value;
  }
  return null;
}

function checkGroups(groups, components, leadComponents) {
  if (!isPlainObject(groups)) return 'groups must be an object.';
  const names = Object.keys(groups);
  const unknownGroups = names.filter((g) => g !== 'meet' && g !== 'buy');
  if (unknownGroups.length) return `groups has unknown keys: ${unknownGroups.join(', ')}.`;

  const seen = new Map();
  for (const g of ['meet', 'buy']) {
    const list = groups[g];
    if (!Array.isArray(list)) return `groups.${g} must be an array of component names.`;
    for (const n of list) {
      if (!SCOREABLE_COMPONENTS.includes(n)) return `groups.${g} names an unknown component: ${n}.`;
      if (!components[n] && !leadComponents[n]) {
        return `groups.${g} names "${n}", which has no weight in components.`;
      }
      // A component in BOTH groups lands in both denominators and is counted
      // once in the blended total — arithmetic nobody intends.
      if (seen.has(n)) return `component "${n}" is in both groups.meet and groups.buy.`;
      seen.set(n, g);
    }
  }

  // A weighted component in no group contributes to nothing: it is computed,
  // shown in the breakdown, and silently ignored by every score.
  for (const n of Object.keys(components)) {
    if (!seen.has(n)) return `component "${n}" has a weight but is in no group — it would score nothing.`;
  }
  return null;
}

/**
 * @param {Object} raw            the candidate configJson (as authored/stored)
 * @returns {{ok:true, config:Object}|{ok:false, error:string}}
 */
export function validateScoringConfig(raw) {
  if (!isPlainObject(raw)) return fail('A scoring config must be a JSON object.');

  // Size FIRST: everything after this walks the document, and the walk itself
  // should never be the DoS. Measured exactly as it would be stored.
  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (bytes > MAX_SCORING_CONFIG_BYTES) {
    return fail(`Scoring config is ${bytes} bytes; the cap is ${MAX_SCORING_CONFIG_BYTES}.`);
  }

  const KNOWN_TOP_LEVEL = [
    'algorithmVersion', 'groups', 'components', 'leadComponents',
    'ageCurve', 'targetSegments', 'decay', 'minFactConfidence',
  ];
  const unknownTop = Object.keys(raw).filter((k) => !KNOWN_TOP_LEVEL.includes(k));
  if (unknownTop.length) {
    return fail(`Unknown top-level scoring config keys: ${unknownTop.join(', ')}. `
      + `Known: ${KNOWN_TOP_LEVEL.join(', ')}.`);
  }

  if (raw.algorithmVersion !== undefined
    && (typeof raw.algorithmVersion !== 'string' || !raw.algorithmVersion.trim())) {
    return fail('algorithmVersion must be a non-empty string when present.');
  }

  const componentError = checkComponentMap(raw.components, 'components')
    || checkComponentMap(raw.leadComponents, 'leadComponents');
  if (componentError) return fail(componentError);

  if (raw.minFactConfidence !== undefined
    && (!isFiniteNumber(raw.minFactConfidence) || raw.minFactConfidence < 0 || raw.minFactConfidence > 1)) {
    return fail('minFactConfidence must be a number in 0..1.');
  }

  if (raw.targetSegments !== undefined) {
    if (!Array.isArray(raw.targetSegments)) return fail('targetSegments must be an array.');
    if (raw.targetSegments.length > MAX_TARGET_SEGMENTS) {
      return fail(`targetSegments has ${raw.targetSegments.length} rows; the cap is ${MAX_TARGET_SEGMENTS}.`);
    }
    const seenAxes = new Set();
    for (let i = 0; i < raw.targetSegments.length; i += 1) {
      const s = raw.targetSegments[i];
      if (!isPlainObject(s)) return fail(`targetSegments[${i}] must be an object.`);
      const extra = Object.keys(s).filter((k) => !['language', 'ethnicity', 'weight'].includes(k));
      if (extra.length) return fail(`targetSegments[${i}] has unknown keys: ${extra.join(', ')}.`);
      // A row with neither axis can never match anyone — it is dead weight the
      // scorer would silently skip forever.
      if (s.language === undefined && s.ethnicity === undefined) {
        return fail(`targetSegments[${i}] must name a language or an ethnicity.`);
      }
      if (s.language !== undefined && !LANGUAGES.includes(s.language)) {
        return fail(`targetSegments[${i}].language must be one of: ${LANGUAGES.join(', ')}.`);
      }
      if (s.ethnicity !== undefined && !ETHNICITIES.includes(s.ethnicity)) {
        return fail(`targetSegments[${i}].ethnicity must be one of: ${ETHNICITIES.join(', ')}.`);
      }
      if (s.weight !== undefined && (!isFiniteNumber(s.weight) || s.weight < 0 || s.weight > 1)) {
        return fail(`targetSegments[${i}].weight must be a number in 0..1.`);
      }
      // Two rows for the same (language, ethnicity) pair: only the heavier one
      // could ever win, so the duplicate is either a mistake or a contradiction.
      const axisKey = `${s.language ?? '*'}|${s.ethnicity ?? '*'}`;
      if (seenAxes.has(axisKey)) return fail(`targetSegments[${i}] duplicates an earlier row's axes.`);
      seenAxes.add(axisKey);
    }
  }

  // Exact keys on the RAW decay object — the normalized checks below cover the
  // two known knobs' VALUES, but an unknown sibling key would ride into
  // storage silently and read as meaningful forever.
  if (raw.decay !== undefined) {
    if (!isPlainObject(raw.decay)) return fail('decay must be an object.');
    const extra = Object.keys(raw.decay)
      .filter((k) => !['lifeEventHalfLifeDays', 'engagementHalfLifeDays'].includes(k));
    if (extra.length) return fail(`decay has unknown keys: ${extra.join(', ')}.`);
  }

  // Normalize AFTER the raw-shape checks so the semantic rules below run over
  // the merged document the scorer will actually see — a config that omits
  // `decay` inherits positive half-lives and must pass, while one that sets
  // `{ engagementHalfLifeDays: 0 }` must not.
  const config = normalizeConfig(raw);

  for (const knob of ['lifeEventHalfLifeDays', 'engagementHalfLifeDays']) {
    const v = config.decay?.[knob];
    if (!isFiniteNumber(v) || v <= 0) {
      return fail(`decay.${knob} must be a positive number of days (got ${v}). `
        + 'A non-positive half-life silently disables decay instead of erroring.');
    }
  }

  const curveError = checkAgeCurve(config.ageCurve);
  if (curveError) return fail(curveError);

  const leadComponents = { ...DEFAULT_LEAD_COMPONENTS, ...(raw.leadComponents || {}) };

  const groupError = checkGroups(config.groups, config.components, leadComponents);
  if (groupError) return fail(groupError);

  // Both grains, because both are scored from this one row.
  const dominanceError = checkDominance(config.components, 'The person grain')
    || checkDominance({ ...config.components, ...leadComponents }, 'The lead grain');
  if (dominanceError) return fail(dominanceError);

  return { ok: true, config };
}
