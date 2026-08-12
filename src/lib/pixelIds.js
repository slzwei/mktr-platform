/**
 * Single source of truth for which pixel ids a campaign fires on.
 *
 * Every tracking call site — gates, conversion events and custom diagnostics —
 * MUST resolve through here so a campaign's ids can never diverge between the
 * gate that permits an event and the pixel that receives it (Codex R1 #8).
 *
 * Per-campaign override first, build env second. Both may be empty; the
 * callers treat a falsy id as "this platform is not configured".
 *
 * KNOWN LIMITATION (Codex R1 #9, deliberate): the browser SDK loaders in
 * index.html early-return when their VITE_*_PIXEL_ID is unset, so a campaign
 * that carries ONLY an override cannot fire browser-side on a build without
 * the env id — `window.fbq`/`window.ttq` never exist for initPixel to use.
 * Both production builds do set the env ids, so the override works today.
 * Making overrides work on env-less builds needs lazy SDK injection; deferred
 * until a second advertiser actually exists. The SERVER side has no such
 * limitation — metaCapiService/tiktokEventsService resolve the id late.
 */

export function resolveMetaPixelId(campaign) {
  return campaign?.metaPixelId || import.meta.env.VITE_META_PIXEL_ID || '';
}

export function resolveTikTokPixelId(campaign) {
  return campaign?.tiktokPixelId || import.meta.env.VITE_TIKTOK_PIXEL_ID || '';
}

/**
 * Google's account-level conversion id (`AW-XXXXXXXXX`). The per-campaign
 * override is read the same way as the other two platforms even though no
 * `googleAdsConversionId` column exists yet — a campaign simply never carries
 * one today, and adding the column later needs no change here.
 */
export function resolveGoogleAdsConversionId(campaign) {
  return campaign?.googleAdsConversionId || import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID || '';
}

/**
 * The conversion ACTION label that pairs with the id above (see googleAds.js —
 * `send_to` needs both halves). Account-level like the id; a campaign override
 * would let one campaign report into its own conversion action.
 */
export function resolveGoogleAdsLeadLabel(campaign) {
  return campaign?.googleAdsLeadLabel || import.meta.env.VITE_GOOGLE_ADS_LEAD_LABEL || '';
}

/** Every platform id for a campaign. */
export function resolvePixelIds(campaign) {
  return {
    metaPixelId: resolveMetaPixelId(campaign),
    tiktokPixelId: resolveTikTokPixelId(campaign),
    googleAdsConversionId: resolveGoogleAdsConversionId(campaign),
  };
}
