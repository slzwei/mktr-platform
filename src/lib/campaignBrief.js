/**
 * Campaign brief v1 — the structured "what is this campaign FOR?" record
 * captured at campaign creation (docs/plans/campaign-brief.md).
 *
 * TWIN FILE: backend/src/utils/campaignBrief.js ↔ src/lib/campaignBrief.js
 * must stay BYTE-IDENTICAL (parity test enforces). Dependency-free by design.
 *
 * Stored in campaigns.targetAudience (JSONB). `{}` = no brief: the campaigns
 * created before the brief existed stay blank forever (owner decision — no
 * backfill), and every consumer treats a missing brief as "no opinion",
 * never as a default. NEVER stored in design_config — the brief is business
 * metadata, and the anonymous campaign endpoints must never carry targeting
 * data (they allowlist columns; targetAudience is not in any allowlist).
 *
 * Structured picks only: free text cannot deterministically drive a scoring
 * segment, a question set, or an AI context. The one free-text field
 * (`notes`) is advisory and consumed by NOTHING — not even the AI prompt.
 *
 * Vocabulary rule: audience axes reuse the fact taxonomy's vocabulary
 * (identity.preferred_language languages, finance.annual_income_band bands)
 * so "who we wanted" and "who we got" stay directly comparable. There is
 * deliberately NO lifeStage axis: factTaxonomy has no such key (scoring plan
 * §16 M10) — life stage is derivable from children + marital + age facts.
 *
 * objective and product are ORTHOGONAL, both required: agent_leads for
 * insurance and agent_leads for recruitment want opposite people on the page.
 */

export const BRIEF_VERSION = 1;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ── the four questions' vocabularies ──

/** Q1 — objective: what does success look like? (required, single pick) */
export const BRIEF_OBJECTIVES = [
  { id: 'agent_leads', label: 'Agent leads', hint: 'Collect leads for agents to call', metric: 'qualified leads delivered' },
  { id: 'screened_leads', label: 'Screened leads', hint: 'Qualify before an agent’s time is spent', metric: 'screening pass rate' },
  { id: 'audience_build', label: 'Audience build', hint: 'Grow a retargetable audience', metric: 'verified contacts gained' },
  { id: 'partner_footfall', label: 'Partner footfall', hint: 'Drive redemption traffic to a partner', metric: 'redemptions' },
];
export const BRIEF_OBJECTIVE_IDS = BRIEF_OBJECTIVES.map((o) => o.id);

/** Q2 — product: what is actually being offered? (required, single pick).
 * Orthogonal to objective — the plan's v2 scope conflated them (amendment
 * 2026-07-27): you can run agent_leads for insurance OR for recruitment. */
export const BRIEF_PRODUCTS = [
  { id: 'insurance', label: 'Insurance / financial planning', hint: 'The reader is a potential policyholder' },
  { id: 'recruitment', label: 'Recruitment', hint: 'The reader is a potential hire, not a customer' },
  { id: 'partner_offer', label: 'Partner offer', hint: 'A partner’s product or venue is the draw' },
  // Vocabulary grows DELIBERATELY (2026-07-31): each value below is wired
  // end-to-end on arrival — a PRODUCT_PROMPT phrase, suggestProfileQuestions
  // rules, and eligibility as a scoring product tier — never added as a bare
  // label. That wiring is the whole argument against an "Other" free-text.
  { id: 'education', label: 'Tuition / enrichment classes', hint: 'The reader is a parent (or learner) choosing classes' },
  { id: 'property', label: 'Property / real estate', hint: 'The reader is a potential buyer, seller or tenant' },
];
export const BRIEF_PRODUCT_IDS = BRIEF_PRODUCTS.map((p) => p.id);

/** Q3 — audience (all optional). Language ids = factTaxonomy
 * identity.preferred_language + 'any'; income bands = factTaxonomy
 * finance.annual_income_band + 'any' (annual SGD). */
export const BRIEF_LANGUAGES = [
  { id: 'any', label: 'Any language' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: 'Chinese (Mandarin)' },
  { id: 'ms', label: 'Malay' },
  { id: 'ta', label: 'Tamil' },
];
export const BRIEF_LANGUAGE_IDS = BRIEF_LANGUAGES.map((l) => l.id);

export const BRIEF_AGE_BANDS = ['18-29', '30-44', '45-59', '60+'];

export const BRIEF_INCOME_BANDS = [
  { id: 'any', label: 'Any income' },
  { id: '<40k', label: 'Below $40k/yr' },
  { id: '40-80k', label: '$40k–$80k/yr' },
  { id: '80-120k', label: '$80k–$120k/yr' },
  { id: '120-200k', label: '$120k–$200k/yr' },
  { id: '>200k', label: 'Above $200k/yr' },
];
export const BRIEF_INCOME_BAND_IDS = BRIEF_INCOME_BANDS.map((b) => b.id);

/** Q4 — target: a number (required within target) and a date (optional). */
export const BRIEF_TARGET_MAX = 1000000;

export const BRIEF_NOTES_MAX = 500;

/** Derived, never asked (recomputed on every save — see deriveArchetype). */
export const BRIEF_ARCHETYPES = ['draw', 'quiz', 'screening', 'reward', 'plain_form'];

// ── validation ──

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDay(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** True when a stored targetAudience value carries a valid brief (both
 * required picks). `{}`/null/malformed all read as "no brief". */
export function hasBrief(targetAudience) {
  return isPlainObject(targetAudience)
    && BRIEF_OBJECTIVE_IDS.includes(targetAudience.objective)
    && BRIEF_PRODUCT_IDS.includes(targetAudience.product);
}

/**
 * The product key a campaign's scoring config scopes to
 * (per-campaign-lead-scoring.md §9 step 2), or null when there is none.
 *
 * DELIBERATELY KEYED ON `product` ALONE, not on hasBrief(). §9's prose says
 * "when a brief exists", but the objective has nothing to do with which
 * product model applies — and the SQL twin in leadScoringService's stale query
 * cannot call hasBrief(), so keying on the one field both sides can read
 * keeps the JS and SQL resolvers provably identical (pinned by the parity
 * test in test/scoringConfigResolution.test.js). Every brief written through
 * normalizeBrief carries both fields anyway, so the two readings differ only
 * for hand-written targetAudience JSON.
 */
export function briefProductKey(targetAudience) {
  if (!isPlainObject(targetAudience)) return null;
  return BRIEF_PRODUCT_IDS.includes(targetAudience.product) ? targetAudience.product : null;
}

/**
 * Validate + canonicalize a raw brief payload. → { ok:true, brief } or
 * { ok:false, error }. Pure and side-effect-free; the API layer turns a
 * failure into its own error type.
 *
 * Strict where it matters: provided-but-invalid enum values FAIL (a typo'd
 * language must never silently vanish — downstream consumers have to be able
 * to trust stored values), while `archetype`/`briefVersion` from the input
 * are IGNORED (archetype is derived server-side; ignoring lets a fetched row
 * round-trip through an edit form unchanged). Unknown keys fail loudly.
 */
export function normalizeBrief(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Campaign brief must be an object with objective and product.' };
  }
  for (const key of Object.keys(raw)) {
    if (!['objective', 'product', 'audience', 'target', 'notes', 'archetype', 'briefVersion'].includes(key)) {
      return { ok: false, error: `Campaign brief has an unknown field "${key}".` };
    }
  }
  if (!BRIEF_OBJECTIVE_IDS.includes(raw.objective)) {
    return { ok: false, error: `Campaign brief needs an objective: one of ${BRIEF_OBJECTIVE_IDS.join(', ')}.` };
  }
  if (!BRIEF_PRODUCT_IDS.includes(raw.product)) {
    return { ok: false, error: `Campaign brief needs a product: one of ${BRIEF_PRODUCT_IDS.join(', ')}.` };
  }
  const brief = { briefVersion: BRIEF_VERSION, objective: raw.objective, product: raw.product };

  if (raw.audience !== undefined && raw.audience !== null) {
    if (!isPlainObject(raw.audience)) {
      return { ok: false, error: 'Campaign brief audience must be an object.' };
    }
    for (const key of Object.keys(raw.audience)) {
      if (!['language', 'ageBands', 'incomeBand'].includes(key)) {
        return { ok: false, error: `Campaign brief audience has an unknown field "${key}".` };
      }
    }
    const audience = {};
    if (raw.audience.language !== undefined && raw.audience.language !== null && raw.audience.language !== '') {
      if (!BRIEF_LANGUAGE_IDS.includes(raw.audience.language)) {
        return { ok: false, error: `Campaign brief audience.language must be one of ${BRIEF_LANGUAGE_IDS.join(', ')}.` };
      }
      audience.language = raw.audience.language;
    }
    if (raw.audience.ageBands !== undefined && raw.audience.ageBands !== null) {
      if (!Array.isArray(raw.audience.ageBands)) {
        return { ok: false, error: 'Campaign brief audience.ageBands must be an array.' };
      }
      for (const band of raw.audience.ageBands) {
        if (!BRIEF_AGE_BANDS.includes(band)) {
          return { ok: false, error: `Campaign brief audience.ageBands must be from ${BRIEF_AGE_BANDS.join(', ')}.` };
        }
      }
      // Canonical order, deduped — band picks are a set, not a sequence.
      const bands = BRIEF_AGE_BANDS.filter((b) => raw.audience.ageBands.includes(b));
      if (bands.length > 0) audience.ageBands = bands;
    }
    if (raw.audience.incomeBand !== undefined && raw.audience.incomeBand !== null && raw.audience.incomeBand !== '') {
      if (!BRIEF_INCOME_BAND_IDS.includes(raw.audience.incomeBand)) {
        return { ok: false, error: `Campaign brief audience.incomeBand must be one of ${BRIEF_INCOME_BAND_IDS.join(', ')}.` };
      }
      audience.incomeBand = raw.audience.incomeBand;
    }
    if (Object.keys(audience).length > 0) brief.audience = audience;
  }

  if (raw.target !== undefined && raw.target !== null) {
    if (!isPlainObject(raw.target)) {
      return { ok: false, error: 'Campaign brief target must be an object.' };
    }
    for (const key of Object.keys(raw.target)) {
      if (!['value', 'byDate'].includes(key)) {
        return { ok: false, error: `Campaign brief target has an unknown field "${key}".` };
      }
    }
    const hasValue = raw.target.value !== undefined && raw.target.value !== null && raw.target.value !== '';
    const hasDate = raw.target.byDate !== undefined && raw.target.byDate !== null && raw.target.byDate !== '';
    if (hasValue || hasDate) {
      if (!hasValue) {
        return { ok: false, error: 'Campaign brief target needs a number (a date alone is not a target).' };
      }
      const value = Number(raw.target.value);
      if (!Number.isInteger(value) || value < 1 || value > BRIEF_TARGET_MAX) {
        return { ok: false, error: `Campaign brief target.value must be a whole number between 1 and ${BRIEF_TARGET_MAX}.` };
      }
      const target = { value };
      if (hasDate) {
        if (!isValidIsoDay(raw.target.byDate)) {
          return { ok: false, error: 'Campaign brief target.byDate must be a valid YYYY-MM-DD date.' };
        }
        target.byDate = raw.target.byDate;
      }
      brief.target = target;
    }
  }

  if (raw.notes !== undefined && raw.notes !== null && raw.notes !== '') {
    if (typeof raw.notes !== 'string') {
      return { ok: false, error: 'Campaign brief notes must be a string.' };
    }
    const notes = raw.notes.trim().slice(0, BRIEF_NOTES_MAX);
    if (notes) brief.notes = notes;
  }

  return { ok: true, brief };
}

// ── derived archetype ──

/**
 * The page mechanic, derived from design_config — never asked (asking the
 * admin to restate what the config already says invites contradiction).
 * Version-tolerant inline reads: luckyDraw + quiz sit at the doc top level in
 * BOTH design_config versions; screening is form.gates.screeningCall on v2 /
 * screeningCallAtSubmit on v1; distribution keys nest under `distribution`
 * on v2 and sit flat on v1.
 *
 * `reward` = the campaign distributes a redeemable offer (marketplace listed,
 * featured drop, or staged marketplace content). A pure reward funnel that
 * never touched marketplace content derives as plain_form — an accepted
 * limit, recomputed on every save so it self-corrects as the doc grows.
 */
export function deriveArchetype(designConfig) {
  const doc = isPlainObject(designConfig) ? designConfig : {};
  const v2 = doc.version === 2;
  if (isPlainObject(doc.luckyDraw) && doc.luckyDraw.enabled === true) return 'draw';
  const quiz = isPlainObject(doc.quiz) ? doc.quiz : null;
  const questionCount = Array.isArray(quiz?.steps)
    ? quiz.steps.reduce((n, s) => n + (isPlainObject(s) && Array.isArray(s.questions) ? s.questions.length : 0), 0)
    : 0;
  if (quiz?.enabled === true && questionCount > 0) return 'quiz';
  const screening = v2 ? doc.form?.gates?.screeningCall === true : doc.screeningCallAtSubmit === true;
  if (screening) return 'screening';
  const drop = v2 ? doc.distribution?.featuredDrop : doc.featuredDrop;
  const listed = v2 ? doc.distribution?.marketplace?.listed : doc.marketplaceListed;
  const offerType = v2 ? doc.distribution?.marketplace?.offerType : doc.offer_type;
  if ((isPlainObject(drop) && drop.enabled === true) || listed === true || (typeof offerType === 'string' && offerType !== '')) {
    return 'reward';
  }
  return 'plain_form';
}

// ── consumers ──

/** One-line human summary for admin surfaces ("Agent leads · Insurance ·
 * Chinese (Mandarin) · 45-59, 60+ · ~200 by 2026-09-30"). Null when blank. */
export function summarizeBrief(targetAudience) {
  const n = normalizeBrief(targetAudience);
  if (!n.ok) return null;
  const b = n.brief;
  const parts = [
    BRIEF_OBJECTIVES.find((o) => o.id === b.objective).label,
    BRIEF_PRODUCTS.find((p) => p.id === b.product).label,
  ];
  if (b.audience?.language && b.audience.language !== 'any') {
    parts.push(BRIEF_LANGUAGES.find((l) => l.id === b.audience.language).label);
  }
  if (b.audience?.ageBands) parts.push(b.audience.ageBands.join(', '));
  if (b.audience?.incomeBand && b.audience.incomeBand !== 'any') {
    parts.push(BRIEF_INCOME_BANDS.find((i) => i.id === b.audience.incomeBand).label);
  }
  if (b.target) parts.push(`~${b.target.value}${b.target.byDate ? ` by ${b.target.byDate}` : ''}`);
  return parts.join(' · ');
}

// Fixed enum→phrase maps for the AI context. The prompt never sees a stored
// string (notes are excluded by design; target value/date are validated
// number/ISO-date) — the brief cannot become an injection surface.
const OBJECTIVE_PROMPT = {
  agent_leads: 'Success = qualified leads delivered to agents who will phone each signup.',
  screened_leads: 'Success = leads that pass a qualification screen before any agent spends time on them.',
  audience_build: 'Success = growing a retargetable audience of verified contacts; a soft, low-friction ask converts best.',
  partner_footfall: 'Success = customers physically redeeming at the partner — sell the visit, not a callback.',
};
const PRODUCT_PROMPT = {
  insurance: 'The offer is insurance / financial planning — the reader is a potential policyholder; credibility and clarity beat hype.',
  recruitment: 'This is a recruitment campaign — the reader is a potential recruit weighing a career move, NOT a customer buying a product.',
  partner_offer: 'A partner’s product or venue is the offer — the partner experience is the hero of the page.',
  education: 'The offer is tuition / enrichment classes — the reader is usually a parent deciding for their child; speak to outcomes and trust, not urgency.',
  property: 'The offer is property / real estate — the reader is weighing a major purchase, sale or tenancy; substance and local specifics beat hype.',
};
const LANGUAGE_PROMPT = {
  en: 'English',
  zh: 'Mandarin Chinese',
  ms: 'Malay',
  ta: 'Tamil',
};

/**
 * The brief as fixed factual phrases for the copy-AI context, or null when
 * the campaign has no brief. 'any' picks are omitted (they carry no steer);
 * notes are NEVER included (advisory, consumed by nothing).
 */
export function briefPromptFacts(targetAudience) {
  const n = normalizeBrief(targetAudience);
  if (!n.ok) return null;
  const b = n.brief;
  const facts = { objective: OBJECTIVE_PROMPT[b.objective], product: PRODUCT_PROMPT[b.product] };
  const audience = [];
  if (b.audience?.language && b.audience.language !== 'any') {
    audience.push(`Intended audience language: ${LANGUAGE_PROMPT[b.audience.language]}.`);
  }
  if (b.audience?.ageBands) {
    audience.push(`Intended age bands: ${b.audience.ageBands.join(', ')}.`);
  }
  if (b.audience?.incomeBand && b.audience.incomeBand !== 'any') {
    audience.push(`Intended household income: ${BRIEF_INCOME_BANDS.find((i) => i.id === b.audience.incomeBand).label}.`);
  }
  if (audience.length > 0) facts.audience = audience;
  if (b.target) {
    facts.target = `Stated target: ~${b.target.value} sign-ups${b.target.byDate ? ` by ${b.target.byDate}` : ''}.`;
  }
  return facts;
}

/**
 * Which profile questions this brief argues for — SUGGEST ONLY. Enabling a
 * question changes a live funnel's conversion; that stays a human decision
 * (the Studio Form panel renders these as one-click suggestions, and the AI
 * Fill-everything flow still never enables profile questions on its own).
 *
 * Deterministic rules over the fixed 5-question library:
 *  - audience_build wants `language` (a list you can segment beats a raw list)
 *  - a stated non-'any' language wants `language` (verify it per signup)
 *  - insurance wants `annual_income` (income qualifies a lead before a call)
 *  - insurance aimed at 45-59/60+ wants `retirement_age`
 *  - insurance aimed at 30-44 wants `children` (dependants drive coverage)
 *  - education wants `children` (the buyer is almost always a parent) and
 *    `annual_income` (class fees are a recurring purchase)
 *  - property wants `annual_income` (affordability is the qualifying fact)
 *  - recruitment/partner_offer suggest nothing beyond the language rules —
 *    asking a recruit or a voucher redeemer their income is pure friction
 *  - `pets` is never suggested (no brief axis maps to it)
 */
export function suggestProfileQuestions(targetAudience) {
  const n = normalizeBrief(targetAudience);
  if (!n.ok) return [];
  const b = n.brief;
  const out = new Map();
  const add = (id, reason) => {
    if (!out.has(id)) out.set(id, { id, reason });
  };
  if (b.objective === 'audience_build') {
    add('language', 'An audience you can segment by language is worth more than a raw contact list.');
  }
  if (b.audience?.language && b.audience.language !== 'any') {
    add('language', 'The brief targets a specific language — capture each signup’s actual preference.');
  }
  if (b.product === 'insurance') {
    add('annual_income', 'Income qualifies an insurance lead before an agent spends a call on it.');
    const bands = b.audience?.ageBands || [];
    if (bands.includes('45-59') || bands.includes('60+')) {
      add('retirement_age', 'A near-retirement audience makes retirement timing the key planning fact.');
    }
    if (bands.includes('30-44')) {
      add('children', 'A family-age audience — dependants drive coverage needs.');
    }
  }
  if (b.product === 'education') {
    add('children', 'The buyer is almost always a parent — how many children decides how many enrolments.');
    add('annual_income', 'Class fees are a recurring purchase — income qualifies the enquiry.');
  }
  if (b.product === 'property') {
    add('annual_income', 'Affordability is the qualifying fact for any property enquiry.');
  }
  // Canonical library order (language, annual_income, children, pets, retirement_age).
  const order = ['language', 'annual_income', 'children', 'pets', 'retirement_age'];
  return order.filter((id) => out.has(id)).map((id) => out.get(id));
}
