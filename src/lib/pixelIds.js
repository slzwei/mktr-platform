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

/** Both ids for a campaign: `{ metaPixelId, tiktokPixelId }`. */
export function resolvePixelIds(campaign) {
  return {
    metaPixelId: resolveMetaPixelId(campaign),
    tiktokPixelId: resolveTikTokPixelId(campaign),
  };
}
