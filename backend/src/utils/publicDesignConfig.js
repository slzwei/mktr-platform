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

const PUBLIC_PASSTHROUGH_KEYS = [
  // Lead-capture page chrome + copy
  'themeColor', 'heroFont', 'imageUrl', 'videoUrl', 'storyText', 'storyEmphasis',
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
  };
}

/** Rebuild a public-safe design_config from a raw stored one. */
export function buildPublicDesignConfig(raw) {
  const dc = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of PUBLIC_PASSTHROUGH_KEYS) {
    if (dc[key] !== undefined) out[key] = dc[key];
  }
  const ld = publicLuckyDraw(dc.luckyDraw);
  if (ld) out.luckyDraw = ld;
  return out;
}
