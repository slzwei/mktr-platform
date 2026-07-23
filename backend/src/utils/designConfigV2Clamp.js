/**
 * design_config v2 — SERVER-ONLY clamping, write-gating, and cross-version
 * stored-state accessors. Backend-only by design (never mirrored to src/lib):
 * the shared schema/migration surface lives in ./designConfigV2.js (the twin);
 * this module is the policy layer campaignService applies on the save path.
 *
 * WRITE GATE: v2 documents are NOT accepted for persistence until
 * `DESIGN_CONFIG_V2_WRITES_ENABLED === 'true'` (default OFF — the Campaign
 * Studio revamp lands dark; the flag flips only after PR 2/3 make every
 * design_config reader version-aware). While the flag is off, campaignService
 * rejects ANY version-tagged document with a typed 422, so no v2 doc can exist
 * in the database and every live reader keeps seeing pure v1 shapes.
 *
 * ALIAS SCRUB: a v2 document may not carry known v1 keys at the top level.
 * Existing readers (featuredDropsService homepage, marketplaceService gate)
 * trust top-level `featuredDrop` / `marketplaceListed`, and campaign PUT/POST
 * are open to agents — without the scrub, a hybrid `{version:2, featuredDrop:
 * {enabled:true}}` payload would bypass the admin-only publication policy.
 * Exceptions: `customerHost` (derived mirror, always rewritten from the
 * clamped distribution.host) and `luckyDraw` (top-level in both versions,
 * admin-policy-gated). Unknown non-v1 top-level keys pass through (forward
 * compatibility); unknown NESTED children inside the v2 schema subtrees are
 * stripped (the public whitelist and future readers must never meet
 * unvetted nested state).
 */

import {
  classifyDesignConfigVersion,
  defaultFields,
  FIELD_IDS,
  FONT_IDS,
  LIMITS,
  LOCKED_FIELD_IDS,
  MARKETPLACE_V1_TO_V2,
  QR_V1_TO_V2,
  marketplaceToV1,
  PRESET_IDS,
  readLegacyView,
  TEMPLATE_IDS,
  TEMPLATE_PARAM_DEFAULTS,
  THEME_BACKGROUNDS,
  THEME_PRESETS,
  THEME_RADIUS_IDS,
  V1_CONSUMED_KEYS,
  V2_TOP_KEYS,
  youTubeIdFrom,
} from './designConfigV2.js';
import { applyFeaturedDropPolicy } from './featuredDrop.js';
import { applyLuckyDrawPolicy } from './luckyDraw.js';
import { applyMarketplacePolicy, normalizeMarketplaceContent } from './marketplaceContent.js';
import { normalizeCustomerHostChoice } from './customerHost.js';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const cleanString = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const cleanEnum = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Rollout gate — read per call so tests (and a live env flip) take effect
 * without a module reload dance. Default OFF. */
export function designConfigV2WritesEnabled() {
  return process.env.DESIGN_CONFIG_V2_WRITES_ENABLED === 'true';
}

export { classifyDesignConfigVersion };

/**
 * Legacy-shaped (v1-flat) view of an any-version doc, for backend READERS.
 * Never throws: `readLegacyView` throws on unsupported version tags (which the
 * write gate makes unstorable), so this belt-and-braces wrapper returns the
 * caller's FAIL-SAFE view instead — each site picks the default that keeps it
 * on its safe branch (e.g. DNC readers pass `{ dncCheckAtSubmit: true }` so a
 * surprise shape can never silently skip a compliance check).
 */
export function readLegacyViewSafe(doc, fallback = {}) {
  try {
    return readLegacyView(doc);
  } catch {
    return fallback;
  }
}

// ───────────────── cross-version stored-state accessors ─────────────────
// The save path must read stored policy state from the STORED document's own
// version — a stored-v1 → incoming-v2 transition save would otherwise look up
// `distribution.*` on a flat doc, find nothing, and silently drop the v1
// publication state through the non-admin preserve policy.

export function getStoredFeaturedDrop(doc) {
  if (!isPlainObject(doc)) return undefined;
  return classifyDesignConfigVersion(doc) === 'v2' ? doc.distribution?.featuredDrop : doc.featuredDrop;
}

export function getStoredMarketplaceListed(doc) {
  if (!isPlainObject(doc)) return undefined;
  return classifyDesignConfigVersion(doc) === 'v2' ? doc.distribution?.marketplace?.listed : doc.marketplaceListed;
}

/** Campaign taxonomy category (tracker "taxonomy") — save paths keep it valid
 * (normalizeMarketplaceContent enum-drops anything else), so readers get a
 * CONSUMER_CATEGORIES id or undefined. */
export function getStoredCategory(doc) {
  if (!isPlainObject(doc)) return undefined;
  const raw = classifyDesignConfigVersion(doc) === 'v2' ? doc.distribution?.marketplace?.category : doc.category;
  return typeof raw === 'string' && raw ? raw : undefined;
}

export function getStoredLuckyDraw(doc) {
  // Top-level in BOTH versions (admin-API-managed, editor-invisible).
  return isPlainObject(doc) ? doc.luckyDraw : undefined;
}

export function getStoredTermsHtml(doc) {
  if (!isPlainObject(doc)) return '';
  const raw = classifyDesignConfigVersion(doc) === 'v2' ? doc.form?.terms?.html : doc.termsContent;
  return typeof raw === 'string' ? raw : '';
}

export function getStoredHostChoice(doc) {
  if (!isPlainObject(doc)) return 'redeem';
  const raw = classifyDesignConfigVersion(doc) === 'v2' ? doc.distribution?.host : doc.customerHost;
  return normalizeCustomerHostChoice(raw);
}

export function getStoredAi(doc) {
  if (!isPlainObject(doc)) return undefined;
  return classifyDesignConfigVersion(doc) === 'v2' && isPlainObject(doc.ai) ? doc.ai : undefined;
}

// ───────────────────────── v2 subtree clamps ─────────────────────────

function clampTemplate(raw) {
  const id = cleanEnum(isPlainObject(raw) ? raw.id : undefined, TEMPLATE_IDS, 'editorial');
  const incomingParams = isPlainObject(raw) && isPlainObject(raw.params) ? raw.params : {};
  const params = {};
  for (const [tpl, defaults] of Object.entries(TEMPLATE_PARAM_DEFAULTS)) {
    const inc = isPlainObject(incomingParams[tpl]) ? incomingParams[tpl] : {};
    const out = {};
    for (const [key, def] of Object.entries(defaults)) {
      const v = inc[key];
      if (typeof def === 'boolean') out[key] = v === undefined ? def : v === true;
      else if (typeof def === 'number') {
        const n = Number(v);
        out[key] = Number.isFinite(n) ? n : def;
      } else out[key] = typeof v === 'string' ? v : def;
    }
    // editorial.formWidth range + express.trustLine length — the only
    // non-enum params with server limits.
    if (tpl === 'editorial') {
      const n = Number(inc.formWidth);
      if (Number.isFinite(n)) out.formWidth = Math.min(LIMITS.formWidthMax, Math.max(LIMITS.formWidthMin, Math.round(n)));
      else delete out.formWidth; // absent stays absent (render default 480)
    }
    if (tpl === 'poster') out.overlay = cleanEnum(out.overlay, ['dusk', 'plain'], 'dusk');
    if (tpl === 'split') {
      out.mediaSide = cleanEnum(out.mediaSide, ['left', 'right'], 'left');
      out.mediaFit = cleanEnum(out.mediaFit, ['cover', 'contain'], 'cover');
    }
    if (tpl === 'spotlight') {
      out.introStyle = cleanEnum(out.introStyle, ['immersive', 'card'], 'immersive');
      out.revealArt = cleanEnum(out.revealArt, ['meter', 'plain'], 'meter');
    }
    if (tpl === 'express') out.trustLine = cleanString(inc.trustLine, LIMITS.trustLine) ?? '';
    if (tpl === 'journey') out.sectionRhythm = cleanEnum(out.sectionRhythm, ['alternate', 'stacked'], 'alternate');
    // Draw-focused templates (drawTemplates.jsx) — booleans (showSerial,
    // showCountdown, heroBand) are already typed by the generic pass above.
    if (tpl === 'postcard') {
      out.mediaSide = cleanEnum(out.mediaSide, ['left', 'right'], 'left');
      out.cardStyle = cleanEnum(out.cardStyle, ['float', 'flush'], 'float');
      out.factStyle = cleanEnum(out.factStyle, ['numbered', 'inline'], 'numbered');
    }
    if (tpl === 'gazette') {
      out.ruleDensity = cleanEnum(out.ruleDensity, ['airy', 'dense'], 'airy');
      out.accentUse = cleanEnum(out.accentUse, ['text', 'fill'], 'fill');
    }
    if (tpl === 'nightfall') {
      out.overlayTone = cleanEnum(out.overlayTone, ['dusk', 'ink'], 'ink');
      out.ctaStyle = cleanEnum(out.ctaStyle, ['bar', 'pill'], 'bar');
    }
    if (tpl === 'stub') {
      out.ticketTone = cleanEnum(out.ticketTone, ['paper', 'accent'], 'paper');
      out.stubEdge = cleanEnum(out.stubEdge, ['top', 'bottom'], 'bottom');
    }
    if (tpl === 'checklist') {
      out.boostStep = cleanEnum(out.boostStep, ['inline', 'footnote'], 'inline');
      out.railStyle = cleanEnum(out.railStyle, ['line', 'dots'], 'line');
    }
    params[tpl] = out;
  }
  return { id, params };
}

function clampTheme(raw, hostChoice) {
  const t = isPlainObject(raw) ? raw : {};
  const hostDefault = THEME_PRESETS.find((p) => p.hostDefault === hostChoice)?.id
    || (hostChoice === 'mktr' ? 'paper-white' : 'warm-cream');
  const preset = cleanEnum(t.preset, PRESET_IDS, hostDefault);
  let accent = null;
  if (typeof t.accent === 'string') {
    let h = t.accent.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(h)) accent = h.startsWith('#') ? h : `#${h}`;
  }
  return {
    preset,
    accent,
    ...(FONT_IDS.includes(t.font) ? { font: t.font } : {}),
    ...(THEME_RADIUS_IDS.includes(t.radius) ? { radius: t.radius } : {}),
    ...(THEME_BACKGROUNDS.includes(t.background) ? { background: t.background } : {}),
  };
}

function clampContent(raw) {
  const c = isPlainObject(raw) ? raw : {};
  const out = {};
  const str = (key, max) => {
    const v = cleanString(c[key], max);
    if (v !== undefined) out[key] = v;
  };
  str('wordmark', LIMITS.wordmark);
  str('headline', LIMITS.headline);
  str('subheadline', LIMITS.subheadline);
  str('story', LIMITS.story);
  str('emphasis', LIMITS.emphasis);
  str('heroCtaLabel', LIMITS.heroCtaLabel);
  str('submitLabel', LIMITS.submitLabel);
  str('advertiserName', LIMITS.advertiserName);
  if (isPlainObject(c.footer)) {
    const footer = {};
    const reg = cleanString(c.footer.regulatory, LIMITS.regulatory);
    const brand = cleanString(c.footer.brand, LIMITS.brand);
    if (reg !== undefined) footer.regulatory = reg;
    if (brand !== undefined) footer.brand = brand;
    if (Object.keys(footer).length) out.footer = footer;
  }
  // Draw-chrome copy overrides — each key optional; whitespace-only or empty
  // strings are DROPPED (empty = "use the composed default", so a cleared
  // field can never blank a trust/anti-scam line into nothing).
  if (isPlainObject(c.drawCopy)) {
    const drawCopy = {};
    const dcStr = (key, max) => {
      const v = cleanString(c.drawCopy[key], max);
      if (v !== undefined && v.trim()) drawCopy[key] = v.trim();
    };
    dcStr('trustRow', LIMITS.drawTrustRow);
    dcStr('scamLine', LIMITS.drawScamLine);
    dcStr('winnersNote', LIMITS.drawWinnersNote);
    dcStr('ctaSubline', LIMITS.drawCtaSubline);
    dcStr('freeEntryTag', LIMITS.drawFreeEntryTag);
    dcStr('boostBody', LIMITS.drawBoostBody);
    if (Object.keys(drawCopy).length) out.drawCopy = drawCopy;
  }
  // Submit CTA font size (px) — a real number only (Number() coercion would
  // turn null/''/[] into 0 → clamped 12, i.e. junk becoming a tiny CTA),
  // rounded and clamped to the shared range; anything else is dropped
  // (absent = the funnel's default size).
  if (typeof c.submitFontSize === 'number' && Number.isFinite(c.submitFontSize)) {
    out.submitFontSize = Math.min(
      LIMITS.submitFontSizeMax,
      Math.max(LIMITS.submitFontSizeMin, Math.round(c.submitFontSize))
    );
  }
  const m = isPlainObject(c.media) ? c.media : {};
  let kind = cleanEnum(m.kind, ['none', 'image', 'video', 'youtube'], 'none');
  const src = typeof m.src === 'string' ? m.src.slice(0, 2048) : '';
  // A youtube kind must actually be a recognizable YouTube URL; a video kind
  // that IS one gets reclassified — one honest classification server-side.
  if (kind === 'youtube' && !youTubeIdFrom(src)) kind = 'video';
  else if (kind === 'video' && youTubeIdFrom(src)) kind = 'youtube';
  const media = { kind, src: kind === 'none' ? '' : src, alt: cleanString(m.alt, LIMITS.mediaAlt) ?? '' };
  if (isPlainObject(m.legacy)) {
    const legacy = {};
    if (typeof m.legacy.imageUrl === 'string') legacy.imageUrl = m.legacy.imageUrl.slice(0, 2048);
    if (typeof m.legacy.videoUrl === 'string') legacy.videoUrl = m.legacy.videoUrl.slice(0, 2048);
    if (Object.keys(legacy).length) media.legacy = legacy;
  }
  out.media = media;
  return out;
}

function clampFields(raw) {
  const canonical = defaultFields();
  if (!Array.isArray(raw)) return canonical;
  const seen = new Set();
  const ordered = [];
  for (const entry of raw) {
    if (!isPlainObject(entry) || !FIELD_IDS.includes(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const locked = LOCKED_FIELD_IDS.includes(entry.id);
    ordered.push({
      id: entry.id,
      visible: locked ? true : entry.visible === true,
      required: locked ? true : entry.required === true,
      row: typeof entry.row === 'string' && entry.row ? entry.row.slice(0, 40) : null,
    });
  }
  for (const f of canonical) if (!seen.has(f.id)) ordered.push(f);
  return ordered;
}

function clampForm(raw) {
  const f = isPlainObject(raw) ? raw : {};
  const gates = isPlainObject(f.gates) ? f.gates : {};
  const out = {
    fields: clampFields(f.fields),
    verification: f.verification === 'whatsapp' ? 'whatsapp' : 'sms',
    gates: {
      sgPr: gates.sgPr === true,
      advisorExclusion: gates.advisorExclusion === true,
      dncCheck: gates.dncCheck === true,
      screeningCall: gates.screeningCall === true,
    },
  };
  if (isPlainObject(f.terms)) {
    const html = cleanString(f.terms.html, LIMITS.terms);
    if (html !== undefined) {
      out.terms = {
        template: cleanEnum(f.terms.template, ['default', 'privacy', 'marketing'], 'default'),
        html,
      };
    }
  }
  return out;
}

/** v2 marketplace clamp = rename to v1 → the EXISTING validator → rename back
 * (same rules as v1 saves, zero duplicated validation). */
function clampMarketplace(raw) {
  if (!isPlainObject(raw)) return undefined;
  const v1 = marketplaceToV1(raw);
  delete v1.marketplaceListed; // policied separately
  const normalized = normalizeMarketplaceContent(v1);
  const out = {};
  for (const [v1Key, v2Key] of Object.entries(MARKETPLACE_V1_TO_V2)) {
    if (normalized[v1Key] !== undefined) out[v2Key] = normalized[v1Key];
  }
  // qr_entry is the ONLY marketplace key whose VALUES differ between versions
  // ('direct'/'detail' ↔ 'form'/'offer'), so the key-rename loop above is not
  // enough — without this the v1 value was written straight into the v2 doc and
  // every save silently reverted the operator's (or the AI's) QR-landing pick:
  // 'offer' saved as 'detail', the Studio segment re-rendered as "Straight to
  // form", and 'detail' shipped in the public DTO. marketplaceFromV1 has always
  // done this; the clamp's hand-rolled inverse did not.
  if (typeof out.qrLanding === 'string') out.qrLanding = QR_V1_TO_V2[out.qrLanding] || out.qrLanding;
  if (normalized.age_range) {
    out.audienceAgeMin = normalized.age_range.min;
    out.audienceAgeMax = normalized.age_range.max;
  }
  if (normalized.availability) {
    if (normalized.availability.days?.length) out.days = normalized.availability.days;
    if (normalized.availability.slots?.length) out.slots = normalized.availability.slots;
  }
  if (normalized.activation) {
    const { duration_mins: durationMins, ...rest } = normalized.activation;
    out.activation = { ...rest, ...(durationMins !== undefined ? { durationMins } : {}) };
  }
  if (normalized.sponsor === null) out.sponsor = null;
  else if (normalized.sponsor) out.sponsor = { disclosed: true, ...normalized.sponsor };
  if (normalized.content_blocks) {
    if (normalized.content_blocks.data_use !== undefined) out.dataUse = normalized.content_blocks.data_use;
    if (normalized.content_blocks.cancellation !== undefined) out.cancellation = normalized.content_blocks.cancellation;
    if (normalized.content_blocks.faq !== undefined) out.faq = normalized.content_blocks.faq;
  }
  return Object.keys(out).length ? out : undefined;
}

// ───────────────────────── the v2 clamp ─────────────────────────

/**
 * Clamp + policy-gate an incoming v2 document against the stored one (either
 * version). Mirrors the v1 clamp's contract: lengths/enums normalized,
 * admin-only subtrees preserved on non-admin saves, unknown top-level keys
 * preserved, known v1 aliases scrubbed, customerHost mirror derived.
 */
export function clampDesignConfigV2(incoming, storedConfig, role) {
  const dc = isPlainObject(incoming) ? incoming : {};
  const distributionIn = isPlainObject(dc.distribution) ? dc.distribution : {};
  const host = normalizeCustomerHostChoice(distributionIn.host);

  const out = {
    version: 2,
    template: clampTemplate(dc.template),
    theme: clampTheme(dc.theme, host),
    content: clampContent(dc.content),
    form: clampForm(dc.form),
  };

  // quiz / guidedReview — verbatim passthrough (documented v1-parity exceptions).
  if (dc.quiz !== undefined) out.quiz = clone(dc.quiz);
  if (dc.guidedReview !== undefined) out.guidedReview = clone(dc.guidedReview);

  // Admin-gated subtrees, stored state read from the stored doc's OWN version.
  const featuredDrop = applyFeaturedDropPolicy({
    incoming: distributionIn.featuredDrop,
    stored: getStoredFeaturedDrop(storedConfig),
    role,
  });
  const listed = applyMarketplacePolicy({
    incoming: isPlainObject(distributionIn.marketplace) ? distributionIn.marketplace.listed : undefined,
    stored: getStoredMarketplaceListed(storedConfig),
    role,
  });
  const luckyDraw = applyLuckyDrawPolicy({
    incoming: dc.luckyDraw,
    stored: getStoredLuckyDraw(storedConfig),
    role,
  });
  const marketplace = clampMarketplace(distributionIn.marketplace);

  out.distribution = {
    host,
    ...(featuredDrop !== undefined ? { featuredDrop } : {}),
    ...(marketplace !== undefined || listed !== undefined
      ? { marketplace: { ...(marketplace || {}), ...(listed !== undefined ? { listed } : {}) } }
      : {}),
  };
  if (luckyDraw !== undefined) out.luckyDraw = luckyDraw;

  // ai — Studio-internal subtree: admins write it, non-admin saves preserve it.
  const ai = role === 'admin'
    ? (isPlainObject(dc.ai) ? clone(dc.ai) : undefined)
    : getStoredAi(storedConfig);
  if (ai !== undefined) out.ai = ai;

  // Derived legacy mirror — ALWAYS from the clamped host, never from incoming.
  out.customerHost = host;

  // Unknown top-level passthrough with the v1-alias scrub.
  for (const [key, value] of Object.entries(dc)) {
    if (V2_TOP_KEYS.includes(key)) continue;
    if (key === 'customerHost' || key === 'luckyDraw' || key === 'quiz' || key === 'guidedReview') continue;
    if (V1_CONSUMED_KEYS.includes(key)) continue; // the scrub — no smuggled aliases
    out[key] = clone(value);
  }
  return out;
}
