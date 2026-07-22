/**
 * design_config marketplace keys — normalization + publication policy.
 *
 * The marketplace surfaces (redeem.sg /offers, /flow, /explore) echo these
 * values on PUBLIC pages, so like featuredDrop/luckyDraw they are normalized
 * both when saved (campaignService.clampDesignConfig) and again when building
 * the public DTO (marketplaceService) — old rows, duplicates, seeds, or future
 * write paths must not be able to smuggle arbitrary content or internal keys
 * onto a public page.
 *
 * `marketplaceListed` is the ONLY consumer-exposure switch and is admin-gated
 * (campaign PUT is open to agents, and agents can flip is_active — so
 * is_active/status alone must never publish a campaign).
 */

/**
 * THE campaign taxonomy (tracker "taxonomy") — the ONLY place a consumer
 * category is added or removed. Everything else derives from this array:
 *  - backend validation (CONSUMER_CATEGORIES → normalizeMarketplaceContent,
 *    the v2 clamp, and the /api/cohorts campaignCategories filter)
 *  - marketplace nav, /c/:id routes and labels (src/pages/marketplace/content.js)
 *  - Studio + classic editor pickers and AI pick rows
 *    (src/components/studio/marketplaceOptions.js)
 *  - cohort facet vocabulary (cohortService.getCohortFacets)
 *
 * Stored on campaigns as design_config.category (v1 flat) /
 * design_config.distribution.marketplace.category (v2) — read cross-version
 * via getStoredCategory (designConfigV2Clamp.js). NOT the same taxonomy as
 * Redeem Ops' partner categories (redeemOps/categoryService — admin-managed
 * DB rows for partner CRM / Discover verticals); the two serve different
 * domains on purpose.
 */
export const CONSUMER_CATEGORY_DEFS = [
  { id: 'art_creativity', label: 'Art & Creativity', group: 'education', blurb: 'Drawing, painting and portfolio discovery' },
  { id: 'coding_robotics', label: 'Coding & Robotics', group: 'education', blurb: 'Build, program and problem-solve' },
  { id: 'speech_performance', label: 'Speech & Performance', group: 'education', blurb: 'Confidence on stage and in class' },
  { id: 'sports_movement', label: 'Sports & Movement', group: 'education', blurb: 'Swim, play and move well' },
  { id: 'music_dance', label: 'Music & Dance', group: 'education', blurb: 'Instruments, voice and rhythm' },
  { id: 'academic', label: 'Academic', group: 'education', blurb: 'Diagnostics and subject support' },
  { id: 'family_lifestyle', label: 'Family & Lifestyle', group: 'lifestyle', blurb: 'Experiences to share together' },
  { id: 'wellness', label: 'Wellness', group: 'lifestyle', blurb: 'Self-care that earns its slot' },
  { id: 'dining', label: 'Dining', group: 'lifestyle', blurb: 'Tables worth booking' },
  { id: 'financial_education', label: 'Financial Education', group: 'lifestyle', blurb: 'Understand your money better' },
];

export const CONSUMER_CATEGORIES = CONSUMER_CATEGORY_DEFS.map((c) => c.id);

export const consumerCategoryLabel = (id) =>
  CONSUMER_CATEGORY_DEFS.find((c) => c.id === id)?.label || id;

export const OFFER_TYPES = ['trial', 'assessment', 'workshop', 'reward', 'consultation'];
export const MODES = ['physical', 'online', 'hybrid'];
export const QR_ENTRIES = ['direct', 'detail'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Campaign types that can be marketplace-listed. quiz/guided_review have
 * their own qualification funnels the generic flow would silently bypass. */
export const MARKETPLACE_CAMPAIGN_TYPES = ['lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing'];

const SLOT_RE = /^\d{2}:\d{2}$/;

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

function cleanString(v, max) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function cleanEnum(v, allowed) {
  return typeof v === 'string' && allowed.includes(v) ? v : undefined;
}

function cleanStringArray(v, { maxItems, maxLen }) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const item of v) {
    const s = cleanString(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanInt(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Normalize the marketplace content keys out of a raw design_config-shaped
 * object. Returns ONLY the clean marketplace keys (absent = dropped) — callers
 * merge over/into the rest of design_config. Used on save AND on public read.
 */
export function normalizeMarketplaceContent(raw) {
  if (!isPlainObject(raw)) return {};
  const out = {};

  const name = cleanString(raw.name, 120);
  if (name) out.name = name;

  const category = cleanEnum(raw.category, CONSUMER_CATEGORIES);
  if (category) out.category = category;

  const offerType = cleanEnum(raw.offer_type, OFFER_TYPES);
  if (offerType) out.offer_type = offerType;

  const mode = cleanEnum(raw.mode, MODES);
  if (mode) out.mode = mode;

  const qrEntry = cleanEnum(raw.qr_entry, QR_ENTRIES);
  if (qrEntry) out.qr_entry = qrEntry;

  if (isPlainObject(raw.age_range)) {
    const min = cleanInt(raw.age_range.min, 0, 99);
    const max = cleanInt(raw.age_range.max, 0, 99);
    if (min !== undefined && max !== undefined && max >= min) out.age_range = { min, max };
  }

  const levels = cleanStringArray(raw.school_levels, { maxItems: 12, maxLen: 8 });
  if (levels && levels.length) out.school_levels = levels;

  if (typeof raw.dsa_related === 'boolean') out.dsa_related = raw.dsa_related;
  if (typeof raw.showCapacity === 'boolean') out.showCapacity = raw.showCapacity;

  if (isPlainObject(raw.availability)) {
    const days = Array.isArray(raw.availability.days)
      ? raw.availability.days.filter((d) => DAYS.includes(d)).slice(0, 7)
      : [];
    const slots = Array.isArray(raw.availability.slots)
      ? raw.availability.slots.filter((s) => typeof s === 'string' && SLOT_RE.test(s.trim())).map((s) => s.trim()).slice(0, 8)
      : [];
    if (days.length || slots.length) out.availability = { days, slots };
  }

  const inclusions = cleanStringArray(raw.inclusions, { maxItems: 8, maxLen: 120 });
  if (inclusions && inclusions.length) out.inclusions = inclusions;

  const imageLabel = cleanString(raw.image_label, 120);
  if (imageLabel) out.image_label = imageLabel;

  if (isPlainObject(raw.activation)) {
    const activation = { required: raw.activation.required === true };
    const type = cleanString(raw.activation.type, 40);
    if (type) activation.type = type;
    const mins = cleanInt(raw.activation.duration_mins, 5, 240);
    if (mins !== undefined) activation.duration_mins = mins;
    const summary = cleanString(raw.activation.summary, 160);
    if (summary) activation.summary = summary;
    const detail = cleanString(raw.activation.detail, 600);
    if (detail) activation.detail = detail;
    out.activation = activation;
  }

  if (raw.sponsor === null) {
    out.sponsor = null;
  } else if (isPlainObject(raw.sponsor)) {
    const kind = cleanString(raw.sponsor.kind, 40);
    const disclosure = cleanString(raw.sponsor.disclosure, 400);
    if (kind || disclosure) out.sponsor = { ...(kind ? { kind } : {}), ...(disclosure ? { disclosure } : {}) };
  }

  const valueLine = cleanString(raw.value_line, 80);
  if (valueLine) out.value_line = valueLine;

  if (isPlainObject(raw.content_blocks)) {
    const blocks = {};
    const dataUse = cleanString(raw.content_blocks.data_use, 400);
    if (dataUse) blocks.data_use = dataUse;
    const cancellation = cleanString(raw.content_blocks.cancellation, 400);
    if (cancellation) blocks.cancellation = cancellation;
    if (Array.isArray(raw.content_blocks.faq)) {
      const faq = [];
      for (const f of raw.content_blocks.faq) {
        if (!isPlainObject(f)) continue;
        const q = cleanString(f.q, 160);
        const a = cleanString(f.a, 400);
        if (q && a) faq.push({ q, a });
        if (faq.length >= 6) break;
      }
      if (faq.length) blocks.faq = faq;
    }
    if (Object.keys(blocks).length) out.content_blocks = blocks;
  }

  return out;
}

/**
 * Publication policy for design_config.marketplaceListed — mirrors
 * applyFeaturedDropPolicy: admins decide; everyone else preserves the stored
 * value. Returns a boolean, or undefined when the key should be absent.
 */
export function applyMarketplacePolicy({ incoming, stored, role }) {
  const norm = (v) => (v === true ? true : v === false ? false : undefined);
  if (role === 'admin') {
    return incoming === undefined ? norm(stored) : norm(incoming);
  }
  return norm(stored);
}
