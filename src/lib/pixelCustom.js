/**
 * Shared gated emitter for NON-CONVERSION funnel diagnostics
 * (`otp_sent`, `otp_verified`, `duplicate_blocked`, `draw_entry_confirmed`).
 *
 * Extracted from MarketplaceFlow so the classic funnel (CampaignSignupForm)
 * emits the SAME event names through the SAME gate — otherwise the two funnels
 * can't be compared during a paid push. Never optimised on; safe to drop
 * without touching conversion integrity.
 *
 * These carry no event_id: they are not deduped against any server event
 * because no server counterpart exists.
 *
 * Callers must pass the campaign so the gate and the pixel ids agree
 * (`resolvePixelIds`) — a campaign whose platform is unconfigured stays
 * silent on that platform only.
 */

import { shouldTrack, trackCustomEvent, initPixel } from './metaPixel';
import { shouldTrackTikTok, trackTikTokEvent, initTikTokPixel } from './tiktokPixel';
import { resolveMetaPixelId, resolveTikTokPixelId } from './pixelIds';

/**
 * Fire a custom diagnostic on every configured platform.
 *
 * @param {string} name       event name (snake_case, shared across platforms)
 * @param {object} [options]
 * @param {object} options.campaign   campaign whose pixels/suppression apply
 * @param {object} [options.params]   event params
 * @param {boolean} [options.previewMode]  true → never fire (designer preview)
 */
export function trackFunnelEvent(name, { campaign, params = {}, previewMode = false } = {}) {
  if (!name || previewMode) return;
  if (typeof window === 'undefined') return;

  const ctx = {
    campaign,
    pathname: window.location?.pathname,
    search: window.location?.search,
  };

  const metaPixelId = resolveMetaPixelId(campaign);
  if (metaPixelId && shouldTrack({ ...ctx, pixelId: metaPixelId })) {
    initPixel(metaPixelId);
    trackCustomEvent(name, params);
  }

  const tiktokPixelId = resolveTikTokPixelId(campaign);
  if (tiktokPixelId && shouldTrackTikTok({ ...ctx, pixelId: tiktokPixelId })) {
    initTikTokPixel(tiktokPixelId);
    trackTikTokEvent(name, params);
  }
}
