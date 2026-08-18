/**
 * AdRoll pixel client utilities — the fourth network alongside metaPixel.js /
 * tiktokPixel.js / googleAds.js, and the only one whose job is RETARGETING
 * rather than conversion measurement. That difference drives every design
 * decision in this file:
 *
 *   1. WIDER SURFACE. Meta/TikTok/Google fire on the campaign funnel only
 *      (`/LeadCapture`, `/offers/:slug`, `/flow/:slug`) because a conversion is
 *      attributed to a campaign. AdRoll's asset is the audience pool, so it also
 *      fires on the customer-brand browse and marketing pages — someone who
 *      browsed `/explore` and left is exactly who retargeting exists to reach.
 *   2. NO EVENT-ID DEDUP. There is no server-side counterpart to deduplicate
 *      against (no CAPI/Events-API equivalent wired), so pageView carries no
 *      shared event id and takes no once-per-session guard — every qualifying
 *      view is a legitimate audience touch.
 *   3. ALLOW-LIST, NOT DENY-LIST. isAdRollSurface enumerates the public
 *      customer routes instead of excluding the internal ones, so a new admin,
 *      ops or auth route is untagged by default rather than untagged only if
 *      somebody remembers to add it.
 *
 * DELIBERATELY ABSENT from the allow-list, beyond the usual admin/ops/auth
 * routes: `/r/:token` (reward claim), `/callback?t=…` (screening opt-in),
 * `/t/:slug` and `/share/:slug`. Each carries a bearer token in the URL, and
 * roundtrip.js reports the full location to AdRoll — tagging those pages would
 * hand a third-party ad network a working credential for a customer's reward.
 * Do not add them.
 *
 * The `adroll` queue + adroll_* globals live in index.html, gated on
 * VITE_ADROLL_ADV_ID + VITE_ADROLL_PIX_ID, and define the queue ONLY — the stub
 * neither injects roundtrip.js nor fires a pageView. initAdRoll() does the
 * injection and is invoked only after shouldTrackAdRoll passes, so the SDK never
 * loads on admin/ops/preview surfaces (same contract as tiktokPixel's deferred
 * `ttq.load()` and googleAds' deferred `gtag('config')`).
 *
 * Suppression: shares pixelSuppression's exclusion half (isSuppressedSurface) —
 * preview routes, the demo page, `?preview=true` and test-data campaigns are out
 * on identical terms to the other three networks.
 *
 * All functions are SSR-safe (defensive against missing window/document).
 */
import { isSuppressedSurface } from './pixelSuppression';

let sdkInjected = false;

/** Both halves are required — roundtrip.js is addressed by the advertisable id. */
export function resolveAdRollIds() {
  return {
    advId: import.meta.env.VITE_ADROLL_ADV_ID || '',
    pixId: import.meta.env.VITE_ADROLL_PIX_ID || '',
  };
}

/**
 * The campaign funnel pages. Split out because these are the surfaces whose
 * `campaign` object decides the test-data exclusion: the route-level tracker
 * skips them and each page fires its own pageView once the campaign has loaded
 * and proved itself real. Everywhere else there is no campaign to wait for.
 */
export function isAdRollCampaignSurface(pathname) {
  const path = (pathname || '').toLowerCase();
  if (path === '/leadcapture') return true;
  if (/^\/offers\/[a-z0-9-]+$/.test(path)) return true;
  if (/^\/flow\/[a-z0-9-]+$/.test(path)) return true;
  return false;
}

/** Public browse + marketing pages on the customer brand (redeem.sg). */
const BROWSE_SURFACES = new Set([
  '/',
  '/explore',
  '/dsa',
  '/winners',
  '/how-it-works',
  '/businesses',
  '/about',
  '/contact',
  '/personal-data-policy',
  '/leads/privacy',
]);

const BROWSE_PATTERNS = [
  /^\/c\/[^/]+$/, // category browse
  /^\/legal\/[^/]+$/, // marketplace legal docs
];

/** Every route AdRoll is allowed on: campaign funnel ∪ public browse. */
export function isAdRollSurface(pathname) {
  const path = (pathname || '').toLowerCase();
  if (isAdRollCampaignSurface(path)) return true;
  if (BROWSE_SURFACES.has(path)) return true;
  return BROWSE_PATTERNS.some((re) => re.test(path));
}

/**
 * `campaign` is only meaningful on the funnel surfaces; pass it there so a
 * test-data campaign stays out of the audience pool. Browse pages call without
 * one, which is why the gate must tolerate its absence.
 */
export function shouldTrackAdRoll({ campaign, pathname, search } = {}) {
  const { advId, pixId } = resolveAdRollIds();
  if (!advId || !pixId) return false;
  // AdRoll has no test-event-code equivalent, so dev firing needs an explicit
  // opt-in — same shape as VITE_GOOGLE_ADS_DEV_MODE. Keeps localhost traffic
  // out of the production audience.
  if (!import.meta.env.PROD && !import.meta.env.VITE_ADROLL_DEV_MODE) return false;
  if (isSuppressedSurface({ campaign, pathname, search })) return false;
  return isAdRollSurface(pathname);
}

/**
 * Inject roundtrip.js. Idempotent — the script tag goes in at most once per
 * page, and the queue defined in index.html buffers any track() call made
 * before it finishes loading.
 *
 * Only called after shouldTrackAdRoll passes, so the SDK never loads on
 * admin/ops/preview pages.
 */
export function initAdRoll() {
  if (sdkInjected) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // The index.html stub is what defines the queue; if it did not run, the build
  // has no AdRoll ids and there is nothing to load.
  if (!window.adroll || typeof window.adroll.track !== 'function') return;
  const advId = window.adroll_adv_id;
  if (!advId) return;

  try {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://s.adroll.com/j/${encodeURIComponent(advId)}/roundtrip.js`;
    const first = document.getElementsByTagName('script')[0];
    if (first && first.parentNode) first.parentNode.insertBefore(script, first);
    else document.head.appendChild(script);
    sdkInjected = true;
  } catch {
    /* injection failed — leave sdkInjected false so a later route can retry */
  }
}

/**
 * Fire AdRoll's pageView — the single event that grows the retargeting
 * audience. Safe to call on every route change; the SPA has no full page loads
 * for roundtrip.js to pick up on its own.
 */
export function trackAdRollPageView() {
  if (typeof window === 'undefined') return;
  if (!window.adroll || typeof window.adroll.track !== 'function') return;
  window.adroll.track('pageView');
}

/** Test seam — resets the module-level injection state. */
export function __resetAdRollStateForTests() {
  sdkInjected = false;
}
