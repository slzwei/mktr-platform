/**
 * Fact taxonomy v1 — THE single source of truth for consumer-observation
 * keys, value shapes, and source ranks
 * (docs/plans/consumer-profile-enrichment.md §4).
 *
 * Everything that touches facts derives from this module: the observations
 * API rejects keys/values it doesn't validate, the mapper normalizes into
 * it, the extraction prompt (PR 2) is GENERATED from it so prompt and
 * validator can't drift, and the resolver ranks sources by SOURCE_RANK.
 *
 * Never free-form keys. Values are always small objects: `{ v: … }` plus
 * per-key extras (`complete` on collections, `when` on life events).
 * Booleans support negatives ({v:false} — someone can sell the car);
 * collections support explicit emptiness ({v:[], complete:true} = "none").
 * Ages are NEVER stored — birth-year bands only (ages go stale).
 *
 * identity.ethnicity: accepted from form/manual/explicit self-identification
 * ONLY — never inferred from call language (owner decision + Codex R1 #14:
 * language inference mints identity.preferred_language instead, which is
 * the directly-scored market-fit signal).
 */

export const TAXONOMY_VERSION = 'v2'; // v2: + family.children_count_band (PR 0)

// Explicitness rank for resolveCurrentFacts (§3.4) — higher wins.
export const SOURCE_RANK = {
  manual: 5,
  form: 4,
  quiz: 3,
  screening_transcript: 2,
  retell_analysis: 1, // reserved — unused in v1 (call_bot prospects are consumer-unlinked)
};

export const FRESH_WINDOW_DAYS = 180;
export const EVENT_SKEW_MS = 24 * 60 * 60 * 1000; // clamp future-dated sourceEventAt (R3 #8)
export const MAX_EVIDENCE_CHARS = 300;
export const MIN_LLM_CONFIDENCE = 0.5;

const GENDERS = ['male', 'female'];
const ETHNICITIES = ['chinese', 'malay', 'indian', 'eurasian', 'other'];
const LANGUAGES = ['en', 'zh', 'ms', 'ta'];
const MARITAL = ['single', 'married', 'divorced', 'widowed'];
const PROPERTY = ['hdb', 'condo', 'landed', 'none'];
const EMPLOYMENT = ['employed', 'self_employed', 'unemployed', 'retired', 'nsf', 'student'];
const INCOME_BANDS = ['<3k', '3-6k', '6-10k', '10-15k', '>15k']; // monthly SGD
const ANNUAL_INCOME_BANDS = ['<40k', '40-80k', '80-120k', '120-200k', '>200k']; // PR 0 question
const RETIREMENT_BANDS = ['<55', '55-59', '60-64', '65-69', '70+']; // PR 0 question
const COVERAGE = ['life', 'health', 'ci', 'pa', 'motor', 'home', 'travel', 'none'];
const LIFE_EVENTS = ['new_child', 'marriage', 'divorce', 'new_job', 'new_home', 'bereavement'];
const PETS = ['dog', 'cat', 'bird', 'fish', 'rabbit', 'hamster', 'reptile', 'other'];
const INTEREST_VOCAB = [
  'cars', 'travel', 'food', 'fitness', 'gaming', 'investing',
  'parenting', 'pets', 'property', 'fashion', 'tech', 'sports',
];

const BIRTH_YEAR_BAND_RE = /^(19[2-9]\d|20[0-2]\d)-(19[2-9]\d|20[0-2]\d)$/;
const WHEN_RE = /^20\d{2}-Q[1-4]$/;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function enumShape(allowed) {
  return (value) => {
    if (!isPlainObject(value)) return 'value must be an object';
    if (!allowed.includes(value.v)) return `v must be one of ${allowed.join('|')}`;
    if (Object.keys(value).length !== 1) return 'only {v} allowed';
    return true;
  };
}

function boolShape() {
  return (value) => {
    if (!isPlainObject(value)) return 'value must be an object';
    if (typeof value.v !== 'boolean') return 'v must be boolean';
    if (Object.keys(value).length !== 1) return 'only {v} allowed';
    return true;
  };
}

function stringShape(maxLen) {
  return (value) => {
    if (!isPlainObject(value)) return 'value must be an object';
    if (typeof value.v !== 'string' || !value.v.trim()) return 'v must be a non-empty string';
    if (value.v.length > maxLen) return `v exceeds ${maxLen} chars`;
    if (Object.keys(value).length !== 1) return 'only {v} allowed';
    return true;
  };
}

// String-array collection from a fixed vocabulary; {v:[], complete:true} = "none".
function vocabListShape(vocab, maxItems) {
  return (value) => {
    if (!isPlainObject(value)) return 'value must be an object';
    if (!Array.isArray(value.v)) return 'v must be an array';
    if (value.v.length > maxItems) return `v exceeds ${maxItems} items`;
    if (!value.v.every((s) => vocab.includes(s))) return `items must be from ${vocab.join('|')}`;
    if (new Set(value.v).size !== value.v.length) return 'duplicate items';
    for (const k of Object.keys(value)) {
      if (k !== 'v' && k !== 'complete') return `unknown prop ${k}`;
    }
    if ('complete' in value && typeof value.complete !== 'boolean') return 'complete must be boolean';
    return true;
  };
}

/**
 * key → { collection: false | 'strings' | 'children', validate(value) → true | errorString }
 */
export const FACT_KEYS = {
  'identity.gender': { collection: false, validate: enumShape(GENDERS) },
  'identity.birth_year_band': {
    collection: false,
    validate: (value) => {
      if (!isPlainObject(value)) return 'value must be an object';
      if (typeof value.v !== 'string' || !BIRTH_YEAR_BAND_RE.test(value.v)) {
        return 'v must be "YYYY-YYYY" (e.g. 1985-1989)';
      }
      const [a, b] = value.v.split('-').map(Number);
      if (b - a !== 4) return 'band must span exactly 5 years (e.g. 1985-1989)';
      if (a % 5 !== 0) return 'band must start on a multiple of 5';
      if (Object.keys(value).length !== 1) return 'only {v} allowed';
      return true;
    },
  },
  'identity.ethnicity': { collection: false, validate: enumShape(ETHNICITIES) },
  'identity.preferred_language': { collection: false, validate: enumShape(LANGUAGES) },
  'family.marital_status': { collection: false, validate: enumShape(MARITAL) },
  'family.children': {
    collection: 'children',
    validate: (value) => {
      if (!isPlainObject(value)) return 'value must be an object';
      if (!Array.isArray(value.v)) return 'v must be an array';
      if (value.v.length > 12) return 'v exceeds 12 children';
      for (const c of value.v) {
        if (!isPlainObject(c)) return 'children must be objects';
        for (const k of Object.keys(c)) {
          if (k !== 'birth_year_band' && k !== 'gender') return `unknown child prop ${k}`;
        }
        if ('birth_year_band' in c && (typeof c.birth_year_band !== 'string' || !BIRTH_YEAR_BAND_RE.test(c.birth_year_band))) {
          return 'child birth_year_band must be "YYYY-YYYY"';
        }
        if ('gender' in c && !GENDERS.includes(c.gender)) return 'child gender invalid';
      }
      for (const k of Object.keys(value)) {
        if (k !== 'v' && k !== 'complete') return `unknown prop ${k}`;
      }
      if ('complete' in value && typeof value.complete !== 'boolean') return 'complete must be boolean';
      return true;
    },
  },
  'family.parents_alive': { collection: false, validate: boolShape() },
  // Form answers can state a COUNT but never invent ages — the band lives
  // beside the detailed family.children array (transcript-fed). Resolution
  // precedence: a fresh complete children array outranks the band; the band
  // entails a LOWER BOUND when '3_plus' (never an exact count) — parent plan
  // §6.4 dependants rule. (studio-profile-questions §4, Codex R1 #8.)
  'family.children_count_band': { collection: false, validate: enumShape(['0', '1', '2', '3_plus']) },
  'household.pets': { collection: 'strings', validate: vocabListShape(PETS, 8) },
  'assets.car_owner': { collection: false, validate: boolShape() },
  'assets.property': { collection: false, validate: enumShape(PROPERTY) },
  'career.job_title': { collection: false, validate: stringShape(80) },
  'career.industry': { collection: false, validate: stringShape(40) },
  'career.employment': { collection: false, validate: enumShape(EMPLOYMENT) },
  'finance.income_band': { collection: false, validate: enumShape(INCOME_BANDS) },
  'finance.annual_income_band': { collection: false, validate: enumShape(ANNUAL_INCOME_BANDS) },
  'finance.retirement_age_band': { collection: false, validate: enumShape(RETIREMENT_BANDS) },
  'finance.existing_coverage': { collection: 'strings', validate: vocabListShape(COVERAGE, 8) },
  'life_event.recent': {
    collection: false,
    validate: (value) => {
      if (!isPlainObject(value)) return 'value must be an object';
      if (!LIFE_EVENTS.includes(value.v)) return `v must be one of ${LIFE_EVENTS.join('|')}`;
      for (const k of Object.keys(value)) {
        if (k !== 'v' && k !== 'when') return `unknown prop ${k}`;
      }
      if ('when' in value && (typeof value.when !== 'string' || !WHEN_RE.test(value.when))) {
        return 'when must be "YYYY-QN"';
      }
      return true;
    },
  },
  'interests.tags': { collection: 'strings', validate: vocabListShape(INTEREST_VOCAB, 10) },
  'residency.status': { collection: false, validate: enumShape(['citizen', 'pr', 'foreigner']) },
};

/** Validate a (key, value) pair against the taxonomy. → { ok, error? } */
export function validateFact(key, value) {
  const def = FACT_KEYS[key];
  if (!def) return { ok: false, error: `unknown key ${key}` };
  const res = def.validate(value);
  return res === true ? { ok: true } : { ok: false, error: res };
}

export function isCollectionKey(key) {
  return Boolean(FACT_KEYS[key]?.collection);
}

/** Birth year → canonical 5-year band ("1988" → "1985-1989"). */
export function birthYearToBand(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1920 || y > 2029) return null;
  const start = Math.floor(y / 5) * 5;
  return `${start}-${start + 4}`;
}

/** Clamp a source-event timestamp to now + EVENT_SKEW_MS (R3 #8). */
export function clampSourceEventAt(ts, now = Date.now()) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return new Date(now);
  return new Date(Math.min(t, now + EVENT_SKEW_MS));
}
