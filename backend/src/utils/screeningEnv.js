/**
 * screeningEnv — the screening feature's env-derived facts that more than one
 * module needs, in ONE place.
 *
 * Two consumers with very different import graphs share this:
 *  - the dialer (`retellScreeningService` / `screeningGate`) — call-window
 *    math, the clamped from-number, the first-dial delay;
 *  - the PUBLIC campaign hydrations (`campaignPreviewService`,
 *    `trackerService`) — which print "an automated call from <number> will
 *    ring you" on the draw success page.
 *
 * Keeping the from-number clamp here (rather than duplicating the regex at the
 * public edge) is the point: the number the success page PROMISES and the
 * number the dialer actually calls FROM can never drift apart.
 *
 * Pure + dependency-light on purpose — trackerService is on the QR-scan hot
 * path and its unit suite mocks a tight import graph; nothing here may pull in
 * models, webhooks, or the screening services.
 */

import { readLegacyViewSafe } from './designConfigV2Clamp.js';

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Singapore, no DST
const E164_RE = /^\+[1-9]\d{9,14}$/;

export const DEFAULT_CALL_WINDOW = '10:00-20:00';
/** Seconds to wait after signup before the FIRST screening dial. */
export const DEFAULT_DIAL_DELAY_SECONDS = 60;
/** Ceiling for the configured delay — past this the sweep, not a timer, owns it. */
const MAX_DIAL_DELAY_SECONDS = 900;

// ---------------------------------------------------------------------------
// Call window (SGT, "HH:MM-HH:MM")
// ---------------------------------------------------------------------------

/** "HH:MM-HH:MM" → minutes-of-day bounds; anything unparseable → the default. */
export function parseWindow(spec) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim());
  if (!m) return { startMin: 10 * 60, endMin: 20 * 60 };
  const startMin = Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
  const endMin = Math.min(23, Number(m[3])) * 60 + Math.min(59, Number(m[4]));
  return endMin > startMin ? { startMin, endMin } : { startMin: 10 * 60, endMin: 20 * 60 };
}

function sgtMinutesOfDay(date) {
  const sgt = new Date(date.getTime() + SGT_OFFSET_MS);
  return sgt.getUTCHours() * 60 + sgt.getUTCMinutes();
}

export function inCallWindow(cfg, now = new Date()) {
  const { startMin, endMin } = parseWindow(cfg.callWindow);
  const mins = sgtMinutesOfDay(now);
  return mins >= startMin && mins < endMin;
}

/** Next window-open instant at/after `from` (UTC Date). */
export function nextWindowOpen(cfg, from = new Date()) {
  const { startMin } = parseWindow(cfg.callWindow);
  const sgt = new Date(from.getTime() + SGT_OFFSET_MS);
  const dayStartUtc = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - SGT_OFFSET_MS;
  const todayOpen = new Date(dayStartUtc + startMin * 60 * 1000);
  if (todayOpen > from && !inCallWindow(cfg, from)) return todayOpen;
  return new Date(dayStartUtc + 24 * 60 * 60 * 1000 + startMin * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Env readers
// ---------------------------------------------------------------------------

/** The clamped E.164 number screening calls originate from, or null. */
export function screeningFromNumber() {
  const raw = (process.env.RETELL_SCREENING_FROM_NUMBER || '').trim();
  return E164_RE.test(raw) ? raw : null;
}

export function screeningCallWindow() {
  return (process.env.SCREENING_CALL_WINDOW || DEFAULT_CALL_WINDOW).trim();
}

/**
 * How long to wait after signup before the first dial. Default 60s: the
 * consumer needs a beat to read "we'll ring you" on the success page and stop
 * typing before the phone lights up. 0 restores the pre-2026-07-30 behaviour
 * (dial the instant the lead lands).
 */
export function screeningDialDelaySeconds() {
  const n = Number(process.env.SCREENING_DIAL_DELAY_SECONDS);
  if (!Number.isFinite(n)) return DEFAULT_DIAL_DELAY_SECONDS;
  return Math.min(MAX_DIAL_DELAY_SECONDS, Math.max(0, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

/**
 * What an UNAUTHENTICATED campaign page may say about the screening call-back,
 * or null when it must say nothing.
 *
 * Fail-closed on every axis — a promise we cannot keep is worse than silence:
 *  - the campaign's gate must be ON (`form.gates.screeningCall`);
 *  - the deployment must actually be able to dial (feature flag + agent id +
 *    from-number + API key — the same `configured` conjunction the dialer
 *    checks, mirrored here because the public edge must not import the dialer);
 *  - a dry run promises a call that is deliberately never placed.
 *
 * `windowOpen` is evaluated at HYDRATION time (page load), which is minutes
 * ahead of submit — close enough to phrase the wait honestly, and far better
 * than trusting a consumer device's clock for the SGT conversion.
 */
export function publicScreeningCallback(designConfig, now = new Date()) {
  if (readLegacyViewSafe(designConfig, {}).screeningCallAtSubmit !== true) return null;
  if (String(process.env.RETELL_SCREENING_ENABLED || 'false').toLowerCase() !== 'true') return null;
  if (String(process.env.SCREENING_DRY_RUN || 'false').toLowerCase() === 'true') return null;
  if (!/^agent_[a-z0-9]{10,64}$/i.test((process.env.RETELL_SCREENING_AGENT_ID || '').trim())) return null;
  if (!process.env.RETELL_API_KEY) return null;
  const number = screeningFromNumber();
  if (!number) return null;

  const callWindow = screeningCallWindow();
  return {
    number,
    etaMinutes: Math.max(1, Math.ceil(screeningDialDelaySeconds() / 60)),
    callWindow,
    windowOpen: inCallWindow({ callWindow }, now),
  };
}

export default {
  parseWindow,
  inCallWindow,
  nextWindowOpen,
  screeningFromNumber,
  screeningCallWindow,
  screeningDialDelaySeconds,
  publicScreeningCallback,
};
