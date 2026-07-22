/**
 * design_config v2 — FRONTEND MIRROR of backend/src/utils/designConfigV2.js.
 *
 * The backend file is the SOURCE OF TRUTH; this mirror exists so the SPA
 * (Studio, renderer, previews) can migrate/resolve without importing across
 * the package boundary. The two files' shared surface must stay identical —
 * src/lib/__tests__/designConfigV2.lockstep.test.js imports BOTH and fails the
 * build on any divergence (constants structurally, functions behaviorally over
 * the shared fixture corpus). Edit them together, backend first.
 *
 * Everything else about the contract, the canonicalization loss ledger (L1-L5),
 * and the no-clamping rule is documented in the backend twin's header.
 */

export const DESIGN_CONFIG_VERSION = 2;

export const TEMPLATE_IDS = [
  'editorial', 'poster', 'split', 'spotlight', 'express', 'journey',
  // Draw-focused directions (drawTemplates.jsx, design review 2026-07-22).
  'postcard', 'gazette', 'nightfall', 'stub', 'checklist',
];

/** The draw-focused subset — canonical source for every consumer (PagePanel,
 * AI look gating); drawTemplates.jsx's registry is test-pinned to equal it. */
export const DRAW_TEMPLATE_IDS = ['postcard', 'gazette', 'nightfall', 'stub', 'checklist'];

/** Per-template parameter defaults — one bag, every template persists its
 * params across switches; first Studio use seeds these. Migration seeds the
 * bag but copies editorial.formWidth ONLY when v1 stored one (v1's RENDER
 * default when absent is 480, not the editor-seed 400 — omitting preserves it). */
export const TEMPLATE_PARAM_DEFAULTS = {
  editorial: { formWidth: 400, cardStyle: 'raised' },
  poster: { overlay: 'dusk', formReveal: 'inline' },
  split: { mediaSide: 'left', mediaFit: 'cover' },
  spotlight: { introStyle: 'immersive', revealArt: 'meter' },
  express: { trustLine: '', storyFold: false },
  journey: { sectionRhythm: 'alternate', stickyCta: true },
  postcard: { mediaSide: 'left', cardStyle: 'float', factStyle: 'numbered' },
  gazette: { ruleDensity: 'airy', accentUse: 'fill', showSerial: true },
  nightfall: { overlayTone: 'ink', showCountdown: true, ctaStyle: 'bar' },
  stub: { ticketTone: 'paper', showSerial: true, stubEdge: 'bottom' },
  checklist: { boostStep: 'inline', heroBand: true, railStyle: 'line' },
};

export const THEME_RADIUS_IDS = ['soft', 'sharp', 'round'];
export const THEME_BACKGROUNDS = ['plain', 'wash', 'grain'];
export const FONT_IDS = ['fraunces', 'playfair', 'space-grotesk', 'albert-sans', 'inter'];

export const RADII = {
  soft: { card: 14, input: 10, btn: 12, modal: 18, media: 12, check: 4 },
  sharp: { card: 8, input: 6, btn: 7, modal: 12, media: 8, check: 3 },
  round: { card: 20, input: 12, btn: 999, modal: 24, media: 14, check: 5 },
};

/**
 * The 10 curated theme presets. `warm-cream` is FROZEN to the production
 * Editorial tokens (LeadCaptureLayout TOKENS + RADIUS, verified byte-exact
 * 2026-07-17) — it is the migration parity baseline and must never drift from
 * the live page. `rx` is a preset-exact radii override that wins while
 * theme.radius is untouched (resolveTheme).
 */
export const THEME_PRESETS = [
  { id: 'warm-cream', name: 'Warm Cream', bg: '#F1DDB8', card: '#FFFAF0', storyCard: '#FAEAD0', modal: '#FBF7F0', ink: '#3D1F0B', bodyText: '#5A301A', muted: '#9A7E5C', hairline: '#E8D7B8', divider: '#D8C09A', accent: '#D17029', accentDeep: '#A85822', danger: '#B33A2E', success: '#7A8C6B', font: 'fraunces', radius: 'soft', rx: { card: 24, input: 999, btn: 999, modal: 28, media: 16, check: 6 }, parity: true, hostDefault: 'redeem' },
  { id: 'paper-white', name: 'Paper White', bg: '#FAFAF8', card: '#FFFFFF', ink: '#17191E', muted: '#818694', accent: '#4059C8', font: 'space-grotesk', radius: 'sharp', hostDefault: 'mktr' },
  { id: 'kopi', name: 'Kopi', bg: '#F3EBE0', card: '#FBF6EE', ink: '#3A2E22', muted: '#94836F', accent: '#8A5A2B', font: 'playfair', radius: 'soft' },
  { id: 'botanic', name: 'Botanic', bg: '#F1F4EC', card: '#FAFCF6', ink: '#26311F', muted: '#7C8A6E', accent: '#4E7A3A', font: 'albert-sans', radius: 'soft' },
  { id: 'peranakan', name: 'Peranakan', bg: '#FDF3F0', card: '#FFFAF8', ink: '#3B2430', muted: '#9A7A85', accent: '#C24E6A', font: 'fraunces', radius: 'round' },
  { id: 'graphite', name: 'Graphite', bg: '#232529', card: '#2C2E33', ink: '#F2F2EF', muted: '#9A9DA6', accent: '#7A9BFF', font: 'space-grotesk', radius: 'sharp', dark: true },
  { id: 'straits-teal', name: 'Straits Teal', bg: '#F2F6F5', card: '#FFFFFF', ink: '#152A28', muted: '#6E8582', accent: '#0E7C6B', font: 'albert-sans', radius: 'soft' },
  { id: 'ink-lime', name: 'Ink & Lime', bg: '#1C1D18', card: '#26271F', ink: '#F4F6E8', muted: '#9AA08A', accent: '#9CCF35', font: 'space-grotesk', radius: 'sharp', dark: true },
  { id: 'violet-hour', name: 'Violet Hour', bg: '#2E2447', card: '#3A2E59', ink: '#F3EFFC', muted: '#A99BC8', accent: '#B7F04C', font: 'fraunces', radius: 'round', dark: true },
  { id: 'tangerine', name: 'Tangerine', bg: '#FFF4EC', card: '#FFFBF7', ink: '#332014', muted: '#A08373', accent: '#F0590C', font: 'albert-sans', radius: 'round' },
];

export const PRESET_IDS = THEME_PRESETS.map((p) => p.id);

/** Server/editor length + range limits per v2 key (Phase 5 handoff §01). */
export const LIMITS = {
  wordmark: 40, headline: 80, subheadline: 150, story: 1200, emphasis: 160,
  heroCtaLabel: 40, submitLabel: 40, advertiserName: 60, regulatory: 1000,
  brand: 80, terms: 10000, dropTitle: 40, dropValue: 12, dropEmoji: 8,
  mkTitle: 120, mkValue: 80, mkAlt: 120, mkNote: 400, quizIntroH: 80,
  quizIntroS: 160, quizStart: 40, qPrompt: 140, qOption: 80, pTitle: 40,
  pDesc: 400, pCta: 40, pAngle: 80,
  mediaAlt: 120, formWidthMin: 300, formWidthMax: 600, trustLine: 80,
};

/** v2 field ids (array order = render order) and the v1 long-id mapping. */
export const FIELD_IDS = ['name', 'email', 'phone', 'dob', 'postal', 'education', 'salary'];
export const LOCKED_FIELD_IDS = ['name', 'email', 'phone'];
export const V1_TO_V2_FIELD_ID = {
  name: 'name', email: 'email', phone: 'phone', dob: 'dob',
  postal_code: 'postal', education_level: 'education', monthly_income: 'salary',
};
export const V2_TO_V1_FIELD_ID = Object.fromEntries(
  Object.entries(V1_TO_V2_FIELD_ID).map(([v1, v2]) => [v2, v1])
);
/** v1 default flat order (CampaignSignupForm's fallback when fieldOrder absent). */
const V1_DEFAULT_ORDER = ['name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'];

export function defaultFields() {
  return [
    { id: 'name', visible: true, required: true, row: null },
    { id: 'email', visible: true, required: true, row: null },
    { id: 'phone', visible: true, required: true, row: null },
    { id: 'dob', visible: true, required: false, row: null },
    { id: 'postal', visible: true, required: false, row: null },
    { id: 'education', visible: false, required: false, row: null },
    { id: 'salary', visible: false, required: false, row: null },
  ];
}

/** v1 flat marketplace key ↔ v2 distribution.marketplace key map. */
export const MARKETPLACE_V1_TO_V2 = {
  name: 'title', category: 'category', offer_type: 'offerType', mode: 'mode',
  qr_entry: 'qrLanding', school_levels: 'schoolLevels', dsa_related: 'dsaRelated',
  showCapacity: 'showCapacity', inclusions: 'inclusions', image_label: 'imageAlt',
  value_line: 'valueLine',
};

/** v1 keys CONSUMED by the migration (mapped into v2 structure). Everything
 * else — quiz, guidedReview, luckyDraw, dead style keys, unknown/future keys —
 * passes through verbatim (ledger L5). Also the scrub list for the v2 clamp:
 * none of these may ride along at the top level of a v2 document. */
export const V1_CONSUMED_KEYS = [
  'formHeadline', 'formSubheadline', 'brandWordmark', 'storyText', 'storyEmphasis',
  'heroCtaLabel', 'ctaText', 'regulatoryFooter', 'brandFooter',
  'imageUrl', 'videoUrl', 'mediaType', 'themeColor', 'heroFont', 'formWidth',
  'termsContent', 'customerHost', 'otpChannel',
  'sgPrOnly', 'excludeAdvisors', 'dncCheckAtSubmit',
  'visibleFields', 'requiredFields', 'fieldOrder',
  'featuredDrop', 'marketplaceListed',
  'name', 'category', 'offer_type', 'mode', 'qr_entry', 'age_range',
  'school_levels', 'dsa_related', 'showCapacity', 'availability', 'inclusions',
  'image_label', 'activation', 'sponsor', 'value_line', 'content_blocks',
];

/** Top-level v2 schema keys (used by downgrade + the clamp's alias scrub). */
export const V2_TOP_KEYS = ['version', 'template', 'theme', 'content', 'form', 'distribution', 'ai'];

// ───────────────────────── helpers (dependency-free) ─────────────────────────

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** WCAG relative luminance — verbatim math of src/lib/contrast.js (production). */
function luminance(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const lin = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}
const contrastRatio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** Production readableTextOn parity (white floor 3, warm-ink dark, light on invalid). */
export function onColor(bgHex, dark = '#3D1F0B', light = '#ffffff') {
  const bg = luminance(bgHex);
  if (bg == null) return light;
  return contrastRatio(bg, luminance(light) ?? 1) >= 3 ? light : dark;
}

/** YouTube id extraction — EXACTLY production's three 11-char forms
 * (LeadCaptureLayout.getYouTubeEmbedUrl); shorts/loose forms stay 'video'. */
export function youTubeIdFrom(url) {
  if (typeof url !== 'string' || !url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// ─────────────────────── version classification ───────────────────────

/** 'legacy' (no version field / not an object) · 'v2' (version === 2) ·
 * 'unsupported' (any other version value, incl. version 3 and '2'). */
export function classifyDesignConfigVersion(doc) {
  if (!isPlainObject(doc)) return 'legacy';
  if (!('version' in doc)) return 'legacy';
  return doc.version === DESIGN_CONFIG_VERSION ? 'v2' : 'unsupported';
}

export const isV2 = (doc) => classifyDesignConfigVersion(doc) === 'v2';

/** Cross-version marketplace publication flag — for surfaces that read the raw
 * doc directly (admin lists/dashboard) rather than a server-rebuilt DTO. */
export function getMarketplaceListedFromDoc(doc) {
  if (!isPlainObject(doc)) return undefined;
  return isV2(doc) ? doc.distribution?.marketplace?.listed : doc.marketplaceListed;
}

// ───────────────────────── field model migration ─────────────────────────

/** Required-flag canonicalization (ledger L1). */
function canonicalRequired(v1Value) {
  if (v1Value === false || v1Value === 'optional') return false;
  if (v1Value === undefined || v1Value === null) return false;
  return Boolean(v1Value);
}

/** v1 {visibleFields, requiredFields, fieldOrder} → canonical v2 fields[7]. */
export function fieldsFromV1(visibleFields = {}, requiredFields = {}, fieldOrder = undefined) {
  const rawEntries = Array.isArray(fieldOrder) && fieldOrder.length > 0 ? fieldOrder : V1_DEFAULT_ORDER;
  const seen = new Set();
  const ordered = [];
  rawEntries.forEach((entry, index) => {
    const columns = typeof entry === 'string'
      ? [entry]
      : isPlainObject(entry) && Array.isArray(entry.columns) ? entry.columns : [];
    const rowId = isPlainObject(entry) && typeof entry.id === 'string' && entry.id
      ? entry.id : `row-${index}`;
    const valid = columns
      .map((c) => V1_TO_V2_FIELD_ID[c])
      .filter((id) => id && !seen.has(id));
    valid.forEach((id) => {
      seen.add(id);
      // A row only pairs fields when ≥2 of its columns survived (ledger L3).
      ordered.push({ id, row: valid.length >= 2 ? rowId : null });
    });
  });
  for (const id of V1_DEFAULT_ORDER.map((k) => V1_TO_V2_FIELD_ID[k])) {
    if (!seen.has(id)) ordered.push({ id, row: null });
  }
  return ordered.map(({ id, row }) => {
    const v1Id = V2_TO_V1_FIELD_ID[id];
    if (LOCKED_FIELD_IDS.includes(id)) return { id, visible: true, required: true, row };
    const visible = (id === 'education' || id === 'salary')
      ? visibleFields[v1Id] === true // opt-in fields (ledger L2)
      : visibleFields[v1Id] !== false; // opt-out fields (dob/postal)
    return { id, visible, required: canonicalRequired(requiredFields[v1Id]), row };
  });
}

/** Canonical v2 fields[] → v1 {visibleFields, requiredFields, fieldOrder}. */
export function fieldsToV1(fields) {
  const list = Array.isArray(fields) && fields.length ? fields : defaultFields();
  const visibleFields = { phone: true };
  const requiredFields = {};
  for (const f of list) {
    if (LOCKED_FIELD_IDS.includes(f.id)) continue;
    const v1Id = V2_TO_V1_FIELD_ID[f.id];
    if (!v1Id) continue;
    visibleFields[v1Id] = f.visible === true;
    requiredFields[v1Id] = f.required === true;
  }
  const fieldOrder = [];
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    const v1Id = V2_TO_V1_FIELD_ID[f.id];
    if (!v1Id) continue;
    if (f.row && i + 1 < list.length && list[i + 1].row === f.row) {
      const partner = list[i + 1];
      fieldOrder.push({ id: f.row, columns: [v1Id, V2_TO_V1_FIELD_ID[partner.id]] });
      i += 1;
    } else {
      fieldOrder.push({ id: f.row || `row-${v1Id}`, columns: [v1Id] });
    }
  }
  return { visibleFields, requiredFields, fieldOrder };
}

// ───────────────────────── theme migration helpers ─────────────────────────

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * Blend `hex` toward `target` by `amount` (0..1). Returns `hex` unchanged when
 * either side is unparseable, so a malformed operator accent can never blank a
 * surface. The warm-cream input fill depends on the exact arithmetic here:
 * mix('#FFFAF0', '#FFFFFF', .4) === '#FFFCF6', the frozen production value.
 */
export function mixHex(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  if (!a || !b) return hex;
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

/**
 * An accent that is legible AS TEXT on `bg` — the accent itself when it already
 * clears `min`, otherwise stepped toward the surface's opposite pole until it
 * does. Light accents (lime, periwinkle) are unreadable as text on white; this
 * keeps the campaign's hue while making the label readable. Falls back to the
 * ink/light pole when even the extreme cannot clear the bar.
 */
export function accentTextOn(accent, bg, min = 4.5, ink = '#3D1F0B') {
  const bgL = luminance(bg);
  const accentL = luminance(accent);
  if (bgL == null || accentL == null) return accent;
  if (contrastRatio(accentL, bgL) >= min) return accent;
  const pole = bgL > 0.5 ? '#000000' : '#FFFFFF';
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mixHex(accent, pole, step / 10);
    const l = luminance(candidate);
    if (l != null && contrastRatio(l, bgL) >= min) return candidate;
  }
  return bgL > 0.5 ? ink : '#FFFFFF';
}

/** Nearest preset by accent RGB distance; invalid/absent hex → warm-cream. */
export function nearestPresetForAccent(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'warm-cream';
  let best = THEME_PRESETS[0];
  let bestDist = Infinity;
  for (const p of THEME_PRESETS) {
    const prgb = hexToRgb(p.accent);
    const d = (rgb[0] - prgb[0]) ** 2 + (rgb[1] - prgb[1]) ** 2 + (rgb[2] - prgb[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best.id;
}

// ───────────────────────── marketplace migration ─────────────────────────


/** v1 qr_entry values ↔ v2 qrLanding values (the enums differ, not just the key:
 * v1 'direct'|'detail' ↔ v2 'form'|'offer' per the Phase 5 handoff). Unknown
 * values pass through verbatim (the save clamp validates). */
const QR_V1_TO_V2 = { direct: 'form', detail: 'offer' };
const QR_V2_TO_V1 = { form: 'direct', offer: 'detail' };

function marketplaceFromV1(dc) {
  const out = {};
  for (const [v1Key, v2Key] of Object.entries(MARKETPLACE_V1_TO_V2)) {
    if (dc[v1Key] !== undefined) out[v2Key] = clone(dc[v1Key]);
  }
  if (typeof out.qrLanding === 'string') out.qrLanding = QR_V1_TO_V2[out.qrLanding] || out.qrLanding;
  if (isPlainObject(dc.age_range)) {
    if (dc.age_range.min !== undefined) out.audienceAgeMin = dc.age_range.min;
    if (dc.age_range.max !== undefined) out.audienceAgeMax = dc.age_range.max;
  }
  if (isPlainObject(dc.availability)) {
    if (dc.availability.days !== undefined) out.days = clone(dc.availability.days);
    if (dc.availability.slots !== undefined) out.slots = clone(dc.availability.slots);
  }
  if (isPlainObject(dc.activation)) {
    const { duration_mins: durationMins, ...rest } = dc.activation;
    out.activation = { ...clone(rest), ...(durationMins !== undefined ? { durationMins } : {}) };
  }
  if (dc.sponsor === null) out.sponsor = null; // explicitly-cleared sponsor is a distinct v1 state
  else if (isPlainObject(dc.sponsor)) out.sponsor = { disclosed: true, ...clone(dc.sponsor) };
  if (isPlainObject(dc.content_blocks)) {
    if (dc.content_blocks.data_use !== undefined) out.dataUse = dc.content_blocks.data_use;
    if (dc.content_blocks.cancellation !== undefined) out.cancellation = dc.content_blocks.cancellation;
    if (dc.content_blocks.faq !== undefined) out.faq = clone(dc.content_blocks.faq);
  }
  if (dc.marketplaceListed !== undefined) out.listed = dc.marketplaceListed === true;
  return Object.keys(out).length ? out : undefined;
}

export function marketplaceToV1(mk) {
  if (!isPlainObject(mk)) return {};
  const out = {};
  for (const [v1Key, v2Key] of Object.entries(MARKETPLACE_V1_TO_V2)) {
    if (mk[v2Key] !== undefined) out[v1Key] = clone(mk[v2Key]);
  }
  if (typeof out.qr_entry === 'string') out.qr_entry = QR_V2_TO_V1[out.qr_entry] || out.qr_entry;
  if (mk.audienceAgeMin !== undefined || mk.audienceAgeMax !== undefined) {
    out.age_range = {
      ...(mk.audienceAgeMin !== undefined ? { min: mk.audienceAgeMin } : {}),
      ...(mk.audienceAgeMax !== undefined ? { max: mk.audienceAgeMax } : {}),
    };
  }
  if (mk.days !== undefined || mk.slots !== undefined) {
    out.availability = {
      ...(mk.days !== undefined ? { days: clone(mk.days) } : {}),
      ...(mk.slots !== undefined ? { slots: clone(mk.slots) } : {}),
    };
  }
  if (isPlainObject(mk.activation)) {
    const { durationMins, ...rest } = mk.activation;
    out.activation = { ...clone(rest), ...(durationMins !== undefined ? { duration_mins: durationMins } : {}) };
  }
  if (mk.sponsor === null) out.sponsor = null;
  else if (isPlainObject(mk.sponsor)) {
    const { disclosed, ...rest } = mk.sponsor;
    if (disclosed === true || Object.keys(rest).length) out.sponsor = clone(rest);
  }
  if (mk.dataUse !== undefined || mk.cancellation !== undefined || mk.faq !== undefined) {
    out.content_blocks = {
      ...(mk.dataUse !== undefined ? { data_use: mk.dataUse } : {}),
      ...(mk.cancellation !== undefined ? { cancellation: mk.cancellation } : {}),
      ...(mk.faq !== undefined ? { faq: clone(mk.faq) } : {}),
    };
  }
  if (mk.listed !== undefined) out.marketplaceListed = mk.listed === true;
  return out;
}

// ───────────────────────────── upgrade (v1 → v2) ─────────────────────────────

/**
 * Pure, idempotent, NON-CLAMPING v1→v2 migration. Values are preserved
 * verbatim (over-limit copy, invalid hex, out-of-range widths survive — the
 * SAVE clamp normalizes, exactly as it does for v1 today). Throws on
 * unsupported versions.
 */
export function upgradeDesignConfig(doc) {
  const version = classifyDesignConfigVersion(doc);
  if (version === 'v2') return clone(doc);
  if (version === 'unsupported') {
    throw new Error(`Unsupported design_config version: ${JSON.stringify(doc?.version)}`);
  }
  const dc = isPlainObject(doc) ? doc : {};
  const out = { version: DESIGN_CONFIG_VERSION };

  // template — params bag seeded; editorial.formWidth copied only when stored.
  const params = clone(TEMPLATE_PARAM_DEFAULTS);
  delete params.editorial.formWidth;
  if (dc.formWidth !== undefined) params.editorial.formWidth = clone(dc.formWidth);
  out.template = { id: 'editorial', params };

  // theme — verbatim values; preset by nearest accent distance.
  out.theme = {
    preset: nearestPresetForAccent(dc.themeColor),
    accent: dc.themeColor !== undefined ? clone(dc.themeColor) : null,
    ...(dc.heroFont !== undefined ? { font: clone(dc.heroFont) } : {}),
  };

  // content — slots mapped only when present (no default-stuffing).
  const content = {};
  const slot = (v1Key, v2Key) => {
    if (dc[v1Key] !== undefined) content[v2Key] = clone(dc[v1Key]);
  };
  slot('brandWordmark', 'wordmark');
  slot('formHeadline', 'headline');
  slot('formSubheadline', 'subheadline');
  slot('storyText', 'story');
  slot('storyEmphasis', 'emphasis');
  slot('heroCtaLabel', 'heroCtaLabel');
  slot('ctaText', 'submitLabel');
  const footer = {};
  if (dc.regulatoryFooter !== undefined) footer.regulatory = clone(dc.regulatoryFooter);
  if (dc.brandFooter !== undefined) footer.brand = clone(dc.brandFooter);
  if (Object.keys(footer).length) content.footer = footer;
  // media — kind per the renderer's own selection rules (ledger L4), inactive
  // URLs preserved in the internal legacy shadow for exact downgrade.
  const mediaType = dc.mediaType || (dc.imageUrl ? 'image' : 'none');
  let kind = 'none';
  if (mediaType === 'image') kind = 'image';
  else if (mediaType === 'video') kind = youTubeIdFrom(dc.videoUrl) ? 'youtube' : 'video';
  const src = kind === 'image' ? (dc.imageUrl || '') : kind === 'none' ? '' : (dc.videoUrl || '');
  const legacy = {};
  if (dc.imageUrl !== undefined) legacy.imageUrl = clone(dc.imageUrl);
  if (dc.videoUrl !== undefined) legacy.videoUrl = clone(dc.videoUrl);
  content.media = { kind, src, alt: '', ...(Object.keys(legacy).length ? { legacy } : {}) };
  out.content = content;

  // form
  out.form = {
    fields: fieldsFromV1(dc.visibleFields || {}, dc.requiredFields || {}, dc.fieldOrder),
    verification: dc.otpChannel === 'whatsapp' ? 'whatsapp' : 'sms',
    gates: {
      sgPr: dc.sgPrOnly === true,
      advisorExclusion: dc.excludeAdvisors === true,
      dncCheck: dc.dncCheckAtSubmit === true,
    },
    ...(dc.termsContent !== undefined
      ? { terms: { template: 'default', html: clone(dc.termsContent) } }
      : {}),
  };

  // distribution (+ derived legacy customerHost mirror at top level)
  const host = dc.customerHost === 'mktr' ? 'mktr' : 'redeem';
  const marketplace = marketplaceFromV1(dc);
  out.distribution = {
    host,
    ...(dc.featuredDrop !== undefined ? { featuredDrop: clone(dc.featuredDrop) } : {}),
    ...(marketplace !== undefined ? { marketplace } : {}),
  };
  out.customerHost = host;

  // verbatim passthrough: everything the migration did not consume (ledger L5).
  for (const [key, value] of Object.entries(dc)) {
    if (key === 'customerHost') continue; // rewritten as the derived mirror above
    if (V1_CONSUMED_KEYS.includes(key)) continue;
    out[key] = clone(value);
  }
  return out;
}

// ───────────────────────────── downgrade (v2 → v1) ─────────────────────────────

/**
 * Pure inverse over the render contract: a downgraded Editorial + Warm Cream
 * doc drives the v1 renderer identically. PROPOSED/v2-only keys (template,
 * theme extras, advertiserName, ai, media.alt) drop. Also the legacy-view
 * adapter for backend readers during the cutover (PR 2/3).
 */
export function downgradeDesignConfig(doc) {
  const version = classifyDesignConfigVersion(doc);
  if (version === 'legacy') return clone(isPlainObject(doc) ? doc : {});
  if (version === 'unsupported') {
    throw new Error(`Unsupported design_config version: ${JSON.stringify(doc?.version)}`);
  }
  const out = {};

  // passthrough first (quiz / guidedReview / luckyDraw / unknown top-level).
  for (const [key, value] of Object.entries(doc)) {
    if (V2_TOP_KEYS.includes(key) || key === 'customerHost') continue;
    out[key] = clone(value);
  }

  const content = isPlainObject(doc.content) ? doc.content : {};
  const back = (v2Key, v1Key) => {
    if (content[v2Key] !== undefined) out[v1Key] = clone(content[v2Key]);
  };
  back('wordmark', 'brandWordmark');
  back('headline', 'formHeadline');
  back('subheadline', 'formSubheadline');
  back('story', 'storyText');
  back('emphasis', 'storyEmphasis');
  back('heroCtaLabel', 'heroCtaLabel');
  back('submitLabel', 'ctaText');
  if (isPlainObject(content.footer)) {
    if (content.footer.regulatory !== undefined) out.regulatoryFooter = clone(content.footer.regulatory);
    if (content.footer.brand !== undefined) out.brandFooter = clone(content.footer.brand);
  }
  const media = isPlainObject(content.media) ? content.media : { kind: 'none', src: '' };
  out.mediaType = media.kind === 'youtube' ? 'video' : (media.kind || 'none');
  const legacy = isPlainObject(media.legacy) ? media.legacy : {};
  if (legacy.imageUrl !== undefined) out.imageUrl = clone(legacy.imageUrl);
  else if (media.kind === 'image' && media.src) out.imageUrl = clone(media.src);
  if (legacy.videoUrl !== undefined) out.videoUrl = clone(legacy.videoUrl);
  else if ((media.kind === 'video' || media.kind === 'youtube') && media.src) out.videoUrl = clone(media.src);

  const theme = isPlainObject(doc.theme) ? doc.theme : {};
  const preset = THEME_PRESETS.find((p) => p.id === theme.preset) || THEME_PRESETS[0];
  if (theme.accent !== undefined && theme.accent !== null) out.themeColor = clone(theme.accent);
  // A null accent means "the preset's own accent". For warm-cream that IS the
  // v1 renderer's absent-themeColor default, so omitting the key round-trips
  // exactly; other presets (Studio-authored, no v1 counterpart) bake theirs so
  // the v1 renderer shows the right color.
  else if (preset.id !== 'warm-cream') out.themeColor = preset.accent;
  if (theme.font !== undefined) out.heroFont = clone(theme.font);

  const editorialParams = doc.template?.params?.editorial;
  if (isPlainObject(editorialParams) && editorialParams.formWidth !== undefined) {
    out.formWidth = clone(editorialParams.formWidth);
  }

  const form = isPlainObject(doc.form) ? doc.form : {};
  const v1Fields = fieldsToV1(form.fields);
  out.visibleFields = v1Fields.visibleFields;
  out.requiredFields = v1Fields.requiredFields;
  out.fieldOrder = v1Fields.fieldOrder;
  out.otpChannel = form.verification === 'whatsapp' ? 'whatsapp' : 'sms';
  const gates = isPlainObject(form.gates) ? form.gates : {};
  out.sgPrOnly = gates.sgPr === true;
  out.excludeAdvisors = gates.advisorExclusion === true;
  out.dncCheckAtSubmit = gates.dncCheck === true;
  if (isPlainObject(form.terms) && form.terms.html !== undefined) out.termsContent = clone(form.terms.html);

  const distribution = isPlainObject(doc.distribution) ? doc.distribution : {};
  out.customerHost = distribution.host === 'mktr' ? 'mktr' : 'redeem';
  if (distribution.featuredDrop !== undefined) out.featuredDrop = clone(distribution.featuredDrop);
  Object.assign(out, marketplaceToV1(distribution.marketplace));

  return out;
}

/** Backend-reader adapter: any-version doc → the v1 shape readers understand. */
export const readLegacyView = downgradeDesignConfig;

// ───────────────────────────── theme resolution ─────────────────────────────

/**
 * Resolve a v2 theme block to concrete tokens (studio-data reference
 * implementation; onAccent via the production contrast helper). Preset-exact
 * `rx` radii win while theme.radius is untouched or equals the preset's own.
 */
export function resolveTheme(theme = {}) {
  const p = THEME_PRESETS.find((x) => x.id === theme.preset) || THEME_PRESETS[0];
  const accent = theme.accent || p.accent;
  const fontId = FONT_IDS.includes(theme.font) ? theme.font : p.font;
  let r = RADII[theme.radius || p.radius] || RADII.soft;
  if (p.rx && (!theme.radius || theme.radius === p.radius)) r = p.rx;
  const disabledBg = p.hairline || mixHex(p.card, p.dark ? '#FFFFFF' : '#000000', p.dark ? 0.16 : 0.1);
  return {
    ...p,
    accent,
    onAccent: onColor(accent),
    fontId,
    r,
    storyCard: p.storyCard || p.card,
    modal: p.modal || p.card,
    bodyText: p.bodyText || p.ink,
    divider: p.divider || p.hairline || (p.dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.16)'),
    accentDeep: p.accentDeep || accent,
    // Status colors are surface-aware: the light-theme pair sits at ~2:1 on a
    // dark card, so dark presets get lifted variants. warm-cream declares both
    // explicitly and is untouched (frozen parity).
    danger: p.danger || (p.dark ? '#F2938B' : '#B4443C'),
    success: p.success || (p.dark ? '#7FD1A0' : '#2F6B43'),
    line: p.hairline || (p.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)'),
    soft: p.dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.045)',
    // OPAQUE input fill. The funnel paints typed text in `ink`, so this must
    // track the theme or the text goes invisible (dark presets sat at 1.1:1 on
    // the old hardcoded '#FFFCF6'). Lightening the card by .4 reproduces the
    // frozen warm-cream value byte-exactly; dark presets lift off the card
    // instead so the field still reads as a well.
    inputBg: p.inputBg || mixHex(p.card, '#FFFFFF', p.dark ? 0.08 : 0.4),
    // Disabled control fill + its label. `hairline` was being used as a surface
    // AND fed to a hex-only contrast helper, which returned white for the 9
    // presets whose hairline is an rgba() string. These are always opaque hex.
    disabledBg,
    onDisabled: onColor(disabledBg),
    // The accent, stepped until it is legible AS TEXT on the form card — lime
    // and periwinkle accents are ~1.8:1 on white and vanish as link/label text.
    accentText: accentTextOn(accent, p.card),
    bgCss: theme.background === 'wash'
      ? `linear-gradient(180deg, ${accent}18, ${p.bg} 320px)`
      : theme.background === 'grain'
        ? `repeating-linear-gradient(45deg, ${p.dark ? 'rgba(255,255,255,.02)' : 'rgba(0,0,0,.015)'} 0 2px, transparent 2px 4px)`
        : 'none',
  };
}
