/**
 * Meta Pixel client utilities — used by the public lead-capture flow to fire
 * browser-side events (ViewContent, Lead) with stable event IDs that match the
 * server-side CAPI event IDs for Pixel/CAPI dedup.
 *
 * The fbevents.js base loader lives in index.html, gated on VITE_META_PIXEL_ID.
 * `initPixel` runs the actual `fbq('init', …)` once React has resolved the
 * pixel id (env var, or per-campaign override added in Phase 5).
 *
 * Suppression rules — see `shouldTrack`. Never track on:
 *   - design-prototype routes under `/preview*`
 *   - the demo route `/LeadCapture/demo`
 *   - PublicPreview `/p/:slug`
 *   - any URL with `?preview=true`
 *   - test-data campaigns (`campaign.is_test_data === true`)
 *   - dev mode without VITE_META_TEST_EVENT_CODE (prevents dev pollution of prod stats)
 *
 * All functions are SSR-safe (defensive against missing window/document/sessionStorage).
 */

import { isTrackableLeadCapture } from './pixelSuppression';

const FBC_STORAGE_KEY = '_mktr_fbc';
const initialisedPixelIds = new Set();

export function shouldTrack({ campaign, pathname, search } = {}) {
  if (!import.meta.env.VITE_META_PIXEL_ID) return false;
  if (!import.meta.env.PROD && !import.meta.env.VITE_META_TEST_EVENT_CODE) return false;
  // Shared page/preview/test-data suppression (kept in lock-step with TikTok).
  return isTrackableLeadCapture({ campaign, pathname, search });
}

export function generateEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function captureFbcFromUrl(search) {
  if (!search || typeof sessionStorage === 'undefined') return null;
  try {
    const params = new URLSearchParams(search);
    const fbclid = params.get('fbclid');
    if (!fbclid) return null;
    const fbc = `fb.1.${Date.now()}.${fbclid}`;
    sessionStorage.setItem(FBC_STORAGE_KEY, fbc);
    return fbc;
  } catch {
    return null;
  }
}

export function readFbc() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(FBC_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function readFbp() {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const match = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
  return match ? match[1] : null;
}

export function initPixel(pixelId) {
  if (!pixelId) return;
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (initialisedPixelIds.has(pixelId)) return;
  window.fbq('init', pixelId);
  initialisedPixelIds.add(pixelId);
}

export function trackEvent(eventName, params = {}, options) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (options) {
    window.fbq('track', eventName, params, options);
  } else {
    window.fbq('track', eventName, params);
  }
}

export function trackLead(params = {}, eventId) {
  trackEvent('Lead', params, eventId ? { eventID: eventId } : undefined);
}

/**
 * Fire a CompleteRegistration Pixel event. Used at the quiz result reveal — the
 * strongest mid-funnel optimisation signal for paid social. Pass the stable
 * registration event id so it dedups against the server-side CAPI
 * CompleteRegistration (sendCompleteRegistrationEvent) fired at form submit.
 */
export function trackCompleteRegistration(params = {}, eventId) {
  trackEvent('CompleteRegistration', params, eventId ? { eventID: eventId } : undefined);
}
