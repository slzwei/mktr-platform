/**
 * Public design_config whitelist — everything the UNAUTHENTICATED surfaces
 * (GET /api/previews/public/:id → LeadCapture, and the marketplace DTO) are
 * allowed to see of a campaign's design_config.
 *
 * design_config is an unconstrained JSONB column that also carries INTERNAL
 * state — luckyDraw.activationId / termsVersionId / termsHash, plus whatever
 * future write paths add — so public reads must rebuild, never dump raw.
 * (docs/plans/redeem-marketplace-v2.md Phase 1: previews/public hardening.)
 *
 * Key list = the union of what the public pages actually read:
 * LeadCapture.jsx / leadCaptureContent.js / CampaignSignupForm.jsx /
 * CampaignQuiz.jsx / public/Preview.jsx, plus the marketplace content keys
 * (already normalized on save by campaignService.clampDesignConfig).
 */

import { normalizeLuckyDraw } from './luckyDraw.js';
import { classifyDesignConfigVersion, TEMPLATE_PARAM_DEFAULTS } from './designConfigV2.js';

const PUBLIC_PASSTHROUGH_KEYS = [
  // Lead-capture page chrome + copy (mediaType drives the none/image/video
  // hero switch in LeadCaptureLayout — omitting it breaks video campaigns)
  'themeColor', 'heroFont', 'imageUrl', 'videoUrl', 'mediaType', 'storyText', 'storyEmphasis',
  'heroCtaLabel', 'ctaText', 'formHeadline', 'formSubheadline', 'formWidth',
  'brandWordmark', 'brandFooter', 'regulatoryFooter', 'termsContent', 'customerHost',
  // Form contract (flat production keys; fieldOrder is string[] OR row objects)
  'fieldOrder', 'visibleFields', 'requiredFields',
  // Flow gates + channel
  'sgPrOnly', 'excludeAdvisors', 'dncCheckAtSubmit', 'otpChannel',
  // Funnel variants (public quiz/guided-review campaigns render from these)
  'quiz', 'guidedReview',
  // Marketplace content (clamped on save by normalizeMarketplaceContent)
  'name', 'category', 'offer_type', 'mode', 'qr_entry', 'age_range',
  'school_levels', 'dsa_related', 'showCapacity', 'availability', 'inclusions',
  'image_label', 'activation', 'sponsor', 'value_line', 'content_blocks',
];

/** Display-safe luckyDraw view — internal ids are NEVER public. */
export function publicLuckyDraw(raw) {
  const ld = normalizeLuckyDraw(raw);
  if (!ld || ld.enabled !== true) return undefined;
  return {
    enabled: true,
    ...(ld.prize ? { prize: ld.prize } : {}),
    ...(ld.closesAt ? { closesAt: ld.closesAt } : {}),
    ...(ld.boostClosesAt ? { boostClosesAt: ld.boostClosesAt } : {}),
    ...(ld.drawOn ? { drawOn: ld.drawOn } : {}),
    multiplier: ld.multiplier,
    ...(ld.winners ? { winners: ld.winners } : {}),
    ...(ld.bookingUrl ? { bookingUrl: ld.bookingUrl } : {}),
  };
}

// ── design_config v2 (Campaign Studio) public whitelist ──
// Same rebuild-never-dump invariant as v1, applied at LEAF level: every public
// subtree is reassembled from known keys so an unknown/internal nested child
// (a future form.internalNote, media.legacy, ai.*) can never leak by default.
// quiz + guidedReview are the two documented WHOLESALE exceptions — v1 already
// exposes them whole and the funnel renders from them; hardening their internals
// is tracked separately.
const pick = (src, keys) => {
  if (!src || typeof src !== 'object') return undefined;
  const out = {};
  for (const key of keys) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return Object.keys(out).length ? out : undefined;
};

const V2_PUBLIC_MARKETPLACE_KEYS = [
  'title', 'category', 'offerType', 'mode', 'imageAlt', 'valueLine', 'inclusions',
  'showCapacity', 'audienceAgeMin', 'audienceAgeMax', 'schoolLevels', 'dsaRelated',
  'days', 'slots', 'activation', 'sponsor', 'dataUse', 'cancellation', 'faq',
  'qrLanding',
  // NOT 'listed' — publication state stays internal, like v1's marketplaceListed.
  // NOT 'endsAt' (removed PR 5) — the clamp never persists it and consumer
  // expiry is ops-derived (activation window / offer validity), so the key was
  // an unreachable schema/whitelist inconsistency.
];

function buildPublicDesignConfigV2(dc) {
  const out = { version: 2 };

  const template = {};
  if (dc.template?.id !== undefined) template.id = dc.template.id;
  const paramsIn = dc.template?.params;
  const params = {};
  for (const [tpl, defaults] of Object.entries(TEMPLATE_PARAM_DEFAULTS)) {
    const p = pick(paramsIn?.[tpl], Object.keys(defaults));
    if (p) params[tpl] = p;
  }
  if (Object.keys(params).length) template.params = params;
  if (Object.keys(template).length) out.template = template;

  const theme = pick(dc.theme, ['preset', 'accent', 'font', 'radius', 'background']);
  if (theme) out.theme = theme;

  const content = pick(dc.content, [
    'wordmark', 'headline', 'subheadline', 'story', 'emphasis',
    'heroCtaLabel', 'submitLabel', 'advertiserName',
  ]) || {};
  const footer = pick(dc.content?.footer, ['regulatory', 'brand']);
  if (footer) content.footer = footer;
  // media WITHOUT the internal legacy shadow (v1-URL bookkeeping for downgrade).
  const media = pick(dc.content?.media, ['kind', 'src', 'alt']);
  if (media) content.media = media;
  if (Object.keys(content).length) out.content = content;

  const form = pick(dc.form, ['verification']) || {};
  if (Array.isArray(dc.form?.fields)) {
    form.fields = dc.form.fields
      .filter((f) => f && typeof f === 'object')
      .map((f) => pick(f, ['id', 'visible', 'required', 'row']) || {});
  }
  const gates = pick(dc.form?.gates, ['sgPr', 'advisorExclusion', 'dncCheck']);
  if (gates) form.gates = gates;
  const terms = pick(dc.form?.terms, ['template', 'html']);
  if (terms) form.terms = terms;
  if (Object.keys(form).length) out.form = form;

  if (dc.quiz !== undefined) out.quiz = dc.quiz;
  if (dc.guidedReview !== undefined) out.guidedReview = dc.guidedReview;

  const distribution = { host: dc.distribution?.host === 'mktr' ? 'mktr' : 'redeem' };
  const marketplace = pick(dc.distribution?.marketplace, V2_PUBLIC_MARKETPLACE_KEYS);
  if (marketplace) distribution.marketplace = marketplace;
  // featuredDrop stays internal here (v1 parity — the homepage service builds
  // its own DTO from the stored doc).
  out.distribution = distribution;
  out.customerHost = distribution.host; // legacy mirror for v1-era readers

  const ld = publicLuckyDraw(dc.luckyDraw);
  if (ld) out.luckyDraw = ld;
  return out;
}

/** Rebuild a public-safe design_config from a raw stored one (version-aware). */
export function buildPublicDesignConfig(raw) {
  const dc = raw && typeof raw === 'object' ? raw : {};
  if (classifyDesignConfigVersion(dc) === 'v2') return buildPublicDesignConfigV2(dc);
  const out = {};
  for (const key of PUBLIC_PASSTHROUGH_KEYS) {
    if (dc[key] !== undefined) out[key] = dc[key];
  }
  const ld = publicLuckyDraw(dc.luckyDraw);
  if (ld) out.luckyDraw = ld;
  return out;
}
