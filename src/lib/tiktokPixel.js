/**
 * TikTok Pixel client utilities — the TikTok counterpart of metaPixel.js for the
 * public lead-capture funnel. Fires browser-side `ttq` events (ViewContent,
 * CompleteRegistration, Lead) with stable event ids so they can deduplicate
 * against the server-side TikTok Events API (Phase 6), exactly as the Meta Pixel
 * dedups against CAPI. The same event ids generated in LeadCapture are reused for
 * both platforms — each platform dedups its own Pixel↔server pair independently.
 *
 * The `ttq` base loader lives in index.html, gated on VITE_TIKTOK_PIXEL_ID, and
 * only defines the queue stub — it does NOT call `ttq.load()`. initTikTokPixel()
 * injects the SDK and is invoked exclusively from LeadCapture once
 * shouldTrackTikTok passes, so the TikTok SDK loads only on the live
 * `/LeadCapture` page — never on admin/preview surfaces (mirrors how the Meta
 * Pixel defers `fbq('init')` to React).
 *
 * Suppression rules — see shouldTrackTikTok; identical page/preview/test-data
 * gating as metaPixel via the shared isTrackableLeadCapture predicate.
 *
 * All functions are SSR-safe (defensive against missing window/document/storage).
 */
import { isTrackableLeadCapture } from './pixelSuppression';

const TTCLID_STORAGE_KEY = '_mktr_ttclid';
const loadedPixelIds = new Set();

export function shouldTrackTikTok({ campaign, pathname, search } = {}) {
  if (!import.meta.env.VITE_TIKTOK_PIXEL_ID) return false;
  if (!import.meta.env.PROD && !import.meta.env.VITE_TIKTOK_TEST_EVENT_CODE) return false;
  // Shared page/preview/test-data suppression (kept in lock-step with Meta).
  return isTrackableLeadCapture({ campaign, pathname, search });
}

/**
 * Persist the TikTok click id (`ttclid`) from the landing URL — the TikTok
 * analogue of fbclid. Stored raw (TikTok does not wrap it the way Meta wraps
 * fbc), forwarded into the prospect submit so the Phase 6 Events API can attach
 * it for click-through attribution + iOS/cookie resilience.
 */
export function captureTtclidFromUrl(search) {
  if (!search || typeof sessionStorage === 'undefined') return null;
  try {
    const params = new URLSearchParams(search);
    const ttclid = params.get('ttclid');
    if (!ttclid) return null;
    sessionStorage.setItem(TTCLID_STORAGE_KEY, ttclid);
    return ttclid;
  } catch {
    return null;
  }
}

export function readTtclid() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(TTCLID_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Read the TikTok first-party cookie `_ttp` set by the pixel SDK (mirror readFbp). */
export function readTtp() {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const match = document.cookie.match(/(?:^|;\s*)_ttp=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Inject + initialise the TikTok pixel for a given id. Idempotent per id. Only
 * called from LeadCapture after shouldTrackTikTok passes, so the SDK never loads
 * on admin/preview pages.
 */
export function initTikTokPixel(pixelId) {
  if (!pixelId) return;
  if (typeof window === 'undefined' || !window.ttq || typeof window.ttq.load !== 'function') return;
  if (loadedPixelIds.has(pixelId)) return;
  window.ttq.load(pixelId);
  window.ttq.page();
  loadedPixelIds.add(pixelId);
}

/**
 * Fire a TikTok pixel event. The stable eventId is passed as the `event_id`
 * option so it deduplicates against the server-side Events API event of the same
 * name (Phase 6). No-op when the SDK isn't loaded (SSR / suppressed pages).
 */
export function trackTikTokEvent(eventName, params = {}, eventId) {
  if (typeof window === 'undefined' || !window.ttq || typeof window.ttq.track !== 'function') return;
  if (eventId) {
    window.ttq.track(eventName, params, { event_id: eventId });
  } else {
    window.ttq.track(eventName, params);
  }
}

export function trackTikTokViewContent(params = {}, eventId) {
  trackTikTokEvent('ViewContent', params, eventId);
}

export function trackTikTokCompleteRegistration(params = {}, eventId) {
  trackTikTokEvent('CompleteRegistration', params, eventId);
}

export function trackTikTokLead(params = {}, eventId) {
  trackTikTokEvent('Lead', params, eventId);
}
