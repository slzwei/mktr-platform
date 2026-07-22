/**
 * Cohort UI vocabulary (tracker "cohortui") — shared by the builder, list and
 * detail screens so reason language and definition summaries never fork.
 * Mirrors backend cohortService (docs/plans/cohort-builder-backend.md):
 * reasons are OVERLAPPING per person; minAge 18 is a consent-policy FLOOR
 * (§9.5-2), not a preference.
 */

export const REASON_META = {
  not_consented: { label: 'No consent', tone: 'bad', hint: 'No verified marketing grant in this scope — legacy signups have no brand-wide basis.' },
  not_verified: { label: 'Unverified', tone: 'warn', hint: 'Consent exists but the signup never carried a live OTP stamp.' },
  suppressed: { label: 'Unsubscribed', tone: 'bad', hint: 'A suppression covers this channel — unsubscribe, complaint or admin block.' },
  age_unknown: { label: 'Age unknown', tone: 'hold', hint: 'No valid date of birth on any signup — excluded by the 18+ safeguard.' },
  age_ineligible: { label: 'Outside age range', tone: 'hold', hint: 'Date of birth falls outside this cohort’s age window.' },
  age_conflict: { label: 'Conflicting ages', tone: 'hold', hint: 'One signup claims under-18 — disqualified outright, no matter what other signups say.' },
  missing_email: { label: 'No email', tone: '', hint: 'Consented but we hold no email address to send to.' },
  missing_phone: { label: 'No phone', tone: '', hint: 'Consented but we hold no phone number for this channel.' },
  erased: { label: 'Erased', tone: 'bad', hint: 'PDPA-erased — permanently out.' },
  not_found: { label: 'Not found', tone: 'bad', hint: 'Consumer no longer exists.' },
};

export const REASON_ORDER = [
  'not_consented', 'not_verified', 'suppressed',
  'age_unknown', 'age_conflict', 'age_ineligible',
  'missing_email', 'missing_phone',
];

export const CHANNEL_OPTIONS = [
  { value: 'all', label: 'Any channel (consent only)' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'voice', label: 'Voice' },
];

export function reasonLabel(reason) {
  return REASON_META[reason]?.label || reason;
}

/** Blank definition in the backend's canonical shape. */
export function emptyDefinition() {
  return {
    filters: {
      campaignIds: [],
      drawIds: [],
      anyDraw: false,
      campaignTags: [],
      campaignCategories: [],
      attributes: { postalPrefixes: [], incomes: [], educations: [], genders: [] },
    },
    ageGate: { minAge: 18, maxAge: null },
    marketingContext: { campaignId: null },
  };
}

/** Re-shape a stored definition defensively (old rows, partial JSON). */
export function normalizeDefinitionShape(def) {
  const base = emptyDefinition();
  if (!def || typeof def !== 'object') return base;
  const f = def.filters || {};
  const a = f.attributes || {};
  return {
    filters: {
      campaignIds: Array.isArray(f.campaignIds) ? f.campaignIds : [],
      drawIds: Array.isArray(f.drawIds) ? f.drawIds : [],
      anyDraw: f.anyDraw === true,
      campaignTags: Array.isArray(f.campaignTags) ? f.campaignTags : [],
      campaignCategories: Array.isArray(f.campaignCategories) ? f.campaignCategories : [],
      attributes: {
        postalPrefixes: Array.isArray(a.postalPrefixes) ? a.postalPrefixes : [],
        incomes: Array.isArray(a.incomes) ? a.incomes : [],
        educations: Array.isArray(a.educations) ? a.educations : [],
        genders: Array.isArray(a.genders) ? a.genders : [],
      },
    },
    ageGate: {
      minAge: Number.isInteger(def.ageGate?.minAge) ? def.ageGate.minAge : 18,
      maxAge: Number.isInteger(def.ageGate?.maxAge) ? def.ageGate.maxAge : null,
    },
    marketingContext: { campaignId: def.marketingContext?.campaignId || null },
  };
}

/** Human summary of a definition for list rows and detail headers. */
export function summarizeDefinition(def, facets = null) {
  const d = normalizeDefinitionShape(def);
  const parts = [];
  const nameOf = (id) => facets?.campaigns?.find((c) => c.id === id)?.name || null;
  if (d.filters.campaignIds.length) {
    const first = nameOf(d.filters.campaignIds[0]);
    parts.push(d.filters.campaignIds.length === 1 && first
      ? `campaign “${first}”`
      : `${d.filters.campaignIds.length} campaign${d.filters.campaignIds.length > 1 ? 's' : ''}`);
  }
  if (d.filters.drawIds.length) parts.push(`${d.filters.drawIds.length} draw${d.filters.drawIds.length > 1 ? 's' : ''}`);
  else if (d.filters.anyDraw) parts.push('any draw');
  if (d.filters.campaignCategories.length) {
    const labelOf = (id) => facets?.campaignCategories?.find((c) => c.id === id)?.label || id;
    parts.push(`category: ${d.filters.campaignCategories.map(labelOf).join(', ')}`);
  }
  if (d.filters.campaignTags.length) parts.push(`tags: ${d.filters.campaignTags.join(', ')}`);
  const attrs = d.filters.attributes;
  const attrBits = [];
  if (attrs.postalPrefixes.length) attrBits.push(`postal ${attrs.postalPrefixes.join('/')}`);
  if (attrs.incomes.length) attrBits.push(`${attrs.incomes.length} income band${attrs.incomes.length > 1 ? 's' : ''}`);
  if (attrs.educations.length) attrBits.push(`${attrs.educations.length} education`);
  if (attrs.genders.length) attrBits.push(attrs.genders.join('/'));
  if (attrBits.length) parts.push(attrBits.join(' · '));
  if (!parts.length) parts.push('everyone');
  const age = d.ageGate.maxAge ? `${d.ageGate.minAge}–${d.ageGate.maxAge}` : `${d.ageGate.minAge}+`;
  parts.push(`ages ${age}`);
  parts.push(d.marketingContext.campaignId
    ? `scope: ${nameOf(d.marketingContext.campaignId) || 'campaign'}`
    : 'brand-wide consent');
  return parts.join(' · ');
}
