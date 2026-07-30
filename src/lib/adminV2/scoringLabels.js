/**
 * Scoring vocabulary shared by the admin surfaces
 * (campaign-scoring-editor §3.1, round-2 B4).
 *
 * COMPONENT_LABELS names the ten scoring components in the same words on the
 * Lead Profile card and in the sheet editor — extracted from
 * AdminV2LeadProfile so the two can never drift. SEGMENT_* mirror the backend
 * fact taxonomy's enums (backend/src/utils/factTaxonomy.js LANGUAGES /
 * ETHNICITIES) and are pinned by a backend parity test
 * (test/scoringVocabParity.test.js) — the taxonomy stays the one owner.
 *
 * VALUES are not here on purpose: house-default weights come from the server
 * (`houseDefault` on the strict resolve), so the ghosts the editor shows are
 * whatever the backend actually scores with, never a frontend copy.
 */

export const COMPONENT_LABELS = {
  engagement: 'engagement',
  contactability: 'contactability',
  market_fit: 'market fit',
  life_events: 'life events',
  family_gap: 'family gap',
  capacity: 'capacity',
  coverage_headroom: 'coverage headroom',
  age: 'age',
  // The two LEAD-grain components (per-campaign-lead-scoring §4). Named for
  // both grains: the person card renders a copy of the winning lead's
  // breakdown, so these surface there too.
  response: 'message response',
  screening: 'screening call',
};

/**
 * The editor's EXPOSED set — which knobs the sheet editor shows, in which
 * group, and each one's sign. `leadGrain` components live in the stored doc's
 * `leadComponents` map, the rest in `components`. Unexposed knobs (decay,
 * confidence floors, group membership) are deliberately absent: the server
 * composes edits onto the winning raw doc, so what isn't shown isn't touched.
 */
export const EXPOSED_COMPONENTS = [
  { name: 'engagement', group: 'meet', leadGrain: false, penalty: false },
  { name: 'contactability', group: 'meet', leadGrain: false, penalty: false },
  { name: 'market_fit', group: 'meet', leadGrain: false, penalty: false },
  { name: 'response', group: 'meet', leadGrain: true, penalty: false },
  { name: 'screening', group: 'meet', leadGrain: true, penalty: false },
  { name: 'life_events', group: 'buy', leadGrain: false, penalty: false },
  { name: 'family_gap', group: 'buy', leadGrain: false, penalty: false },
  { name: 'capacity', group: 'buy', leadGrain: false, penalty: false },
  { name: 'age', group: 'buy', leadGrain: false, penalty: false },
  { name: 'coverage_headroom', group: 'buy', leadGrain: false, penalty: true },
];

/** UI bounds — guidance only; scoringConfigValidation is the authority. */
export const MAX_WEIGHT = 30;

/** The effective weight for a component out of a config-shaped doc. */
export function weightOf(doc, comp) {
  const map = comp.leadGrain ? doc?.leadComponents : doc?.components;
  return map?.[comp.name]?.maxPoints;
}

/** Mirror of factTaxonomy LANGUAGES / ETHNICITIES — parity-tested. */
export const SEGMENT_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: 'Chinese (Mandarin)' },
  { id: 'ms', label: 'Malay' },
  { id: 'ta', label: 'Tamil' },
];
export const SEGMENT_ETHNICITIES = [
  { id: 'chinese', label: 'Chinese' },
  { id: 'malay', label: 'Malay' },
  { id: 'indian', label: 'Indian' },
  { id: 'eurasian', label: 'Eurasian' },
  { id: 'other', label: 'Other' },
];

/** The brief's age bands (campaignBrief BRIEF_AGE_BANDS), as curve zones.
 * `under-18` is a pseudo-zone so the ladder can ramp below the first band. */
export const AGE_BAND_ZONES = [
  { id: '18-29', upTo: 29 },
  { id: '30-44', upTo: 44 },
  { id: '45-59', upTo: 59 },
  { id: '60+', upTo: null },
];

/**
 * Deterministic brief-bands → age curve (campaign-scoring-editor §3.1,
 * round-3 M3). Each zone's value is a LADDER of its band-distance to the
 * nearest SELECTED band: 0 → 1.0, 1 → 0.8, 2 → 0.55, 3+ → 0.3. Adjacent
 * zones differ by at most one ladder step (≤0.25), so the result always
 * clears the validator's 0.5 slope cap — the naive "selected = 1.0, rest =
 * house shoulder" shape does not (0.25 → 1.0 at age 18 is a 0.75 cliff).
 * The under-18 zone sits one step below the first band. Consecutive equal
 * values merge into one segment; the last segment is always the open tail.
 *
 * Returns null when nothing is selected — the caller keeps its curve.
 */
export function buildAgeCurveFromBands(selectedIds) {
  const selected = AGE_BAND_ZONES
    .map((z, i) => (selectedIds?.includes(z.id) ? i : null))
    .filter((i) => i !== null);
  if (!selected.length) return null;

  const LADDER = [1, 0.8, 0.55, 0.3];
  const valueAt = (zoneIndex) => {
    const dist = Math.min(...selected.map((s) => Math.abs(s - zoneIndex)));
    return LADDER[Math.min(dist, LADDER.length - 1)];
  };

  // Zones in age order: under-18 (index -1, one step beyond band 0), then the
  // four brief bands.
  const zones = [
    { upTo: 17, value: LADDER[Math.min(Math.min(...selected.map((s) => s + 1)), LADDER.length - 1)] },
    ...AGE_BAND_ZONES.map((z, i) => ({ upTo: z.upTo, value: valueAt(i) })),
  ];

  // Merge runs of equal value; keep the open tail last.
  const merged = [];
  for (const z of zones) {
    const prev = merged[merged.length - 1];
    if (prev && prev.value === z.value) prev.upTo = z.upTo;
    else merged.push({ ...z });
  }
  merged[merged.length - 1].upTo = null;
  return merged;
}

/** Sheet-tier chip labels, shared by the campaign card and the create block. */
export const TIER_LABEL = {
  campaign: 'campaign sheet',
  product: 'product sheet',
  global: 'house sheet',
  default: 'house default',
};

/** The full exposed set as a patch — an editor doc always writes every
 *  exposed knob (campaign-scoring-editor §4.1: exposed knobs never float),
 *  UI-only keys stripped. */
export function patchFromDoc(doc, houseDefault) {
  const components = {};
  const leadComponents = {};
  for (const comp of EXPOSED_COMPONENTS) {
    const value = weightOf(doc, comp) ?? weightOf(houseDefault, comp) ?? 0;
    (comp.leadGrain ? leadComponents : components)[comp.name] = { maxPoints: value };
  }
  const patch = { components, leadComponents };
  if (Array.isArray(doc?.ageCurve) && doc.ageCurve.length) patch.ageCurve = doc.ageCurve;
  if (Array.isArray(doc?.targetSegments)) patch.targetSegments = doc.targetSegments;
  return patch;
}

/** Seed an editor doc from a strict-resolve payload: effective values only. */
export function docFromSheet(sheet) {
  const cfg = sheet?.config || {};
  return {
    components: { ...(cfg.components || {}) },
    leadComponents: { ...(cfg.leadComponents || {}) },
    ageCurve: Array.isArray(cfg.ageCurve) ? cfg.ageCurve.map((s) => ({ ...s })) : [],
    targetSegments: Array.isArray(cfg.targetSegments) ? cfg.targetSegments.map((s) => ({ ...s })) : [],
    _ageBands: [],
  };
}
