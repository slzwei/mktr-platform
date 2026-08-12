/**
 * Google Ads (gtag.js) client utilities — the Google counterpart of
 * metaPixel.js / tiktokPixel.js for the public lead-capture funnel.
 *
 * Google differs from the other two networks in three ways that shape this file:
 *
 *   1. There is no "pixel id + event name" pair. A Google conversion is addressed
 *      by `send_to: "{conversionId}/{label}"`, where the conversion id is the
 *      account-level `AW-XXXXXXXXX` and the label is minted per conversion ACTION
 *      in the Google Ads UI. Both halves are required — a conversion fired without
 *      its label is silently discarded by Google, not attributed to the account.
 *   2. `gtag('config', id)` sends its own page_view, so there is no separate
 *      ViewContent call. Configuring the id IS the view event. It is still routed
 *      through the shared session guard so offer → flow navigation configures once.
 *   3. Dedup uses `transaction_id`, not a per-event id parameter. We pass the SAME
 *      stable event id the Meta/TikTok calls already use, so all three networks
 *      dedup on one value and the funnel stays comparable across platforms.
 *
 * The gtag/dataLayer stub lives in index.html, gated on
 * VITE_GOOGLE_ADS_CONVERSION_ID, and defines the queue ONLY — it neither injects
 * gtag.js nor calls `config`. initGoogleAds() does both, and is invoked only after
 * shouldTrackGoogle passes, so the SDK never loads on admin/preview surfaces
 * (mirrors how tiktokPixel defers `ttq.load()` to React).
 *
 * Suppression rules — see shouldTrackGoogle; identical page/preview/test-data
 * gating as Meta and TikTok via the shared isTrackableLeadCapture predicate.
 *
 * NO CLICK-ID CAPTURE HERE, deliberately. Meta and TikTok need `captureFbcFromUrl`
 * / `captureTtclidFromUrl` because their SERVER-side counterparts (CAPI, Events
 * API) must be handed the click id explicitly. gtag.js reads `gclid`/`gbraid`/
 * `wbraid` off the landing URL itself and persists them in its own first-party
 * `_gcl_aw` cookie, so browser-side attribution already works with nothing extra.
 * A parallel capture would only serve a future offline-conversion upload — and
 * Google rejects offline conversions for clicks older than 90 days, so there is
 * no click history worth banking in advance. Add capture WITH that upload, not
 * before it.
 *
 * Also not handled here: Enhanced Conversions for Leads (needs hashed PII wired
 * through the submit) and the offline outcome upload itself, which belongs with
 * the backend lead-outcome path rather than in a browser tag.
 *
 * All functions are SSR-safe (defensive against missing window/document).
 */
import { isTrackableLeadCapture } from './pixelSuppression';

const configuredIds = new Set();
let sdkInjected = false;

/**
 * `conversionId` is the CALLER-RESOLVED id for this campaign (see lib/pixelIds.js)
 * — pass it so a per-campaign override is honoured instead of being vetoed by the
 * build env var. Omitted → falls back to the env id (matches Meta/TikTok).
 */
export function shouldTrackGoogle({ campaign, pathname, search, conversionId } = {}) {
  const resolvedId = conversionId ?? import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID;
  if (!resolvedId) return false;
  // Google has no test-event-code equivalent, so dev firing needs an explicit
  // opt-in flag rather than a code. Same intent as VITE_META_TEST_EVENT_CODE:
  // keep dev traffic out of production conversion stats.
  if (!import.meta.env.PROD && !import.meta.env.VITE_GOOGLE_ADS_DEV_MODE) return false;
  // Shared page/preview/test-data suppression (kept in lock-step with Meta/TikTok).
  return isTrackableLeadCapture({ campaign, pathname, search });
}

/**
 * Inject gtag.js and configure the conversion id. Idempotent per id; the script
 * tag itself is injected at most once per page regardless of how many ids are
 * configured (gtag multiplexes internally).
 *
 * Only called after shouldTrackGoogle passes, so the SDK never loads on
 * admin/preview pages. The `config` call emits Google's page_view — that is the
 * view event for this network, which is why there is no separate view function.
 */
export function initGoogleAds(conversionId) {
  if (!conversionId) return;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  if (configuredIds.has(conversionId)) return;

  if (!sdkInjected) {
    if (typeof document === 'undefined') return;
    try {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(conversionId)}`;
      const first = document.getElementsByTagName('script')[0];
      if (first && first.parentNode) first.parentNode.insertBefore(script, first);
      else document.head.appendChild(script);
      sdkInjected = true;
    } catch {
      return;
    }
  }

  window.gtag('config', conversionId);
  configuredIds.add(conversionId);
}

/**
 * Fire a Google Ads conversion.
 *
 * Both `conversionId` and `label` are required — `send_to` is meaningless
 * without the pair, and Google drops a malformed one silently rather than
 * erroring, so we refuse to emit it instead of shipping an invisible no-op.
 *
 * `transactionId` becomes Google's dedup key. Pass the same stable event id used
 * for the Meta/TikTok events so a retried submit cannot double-count.
 */
export function trackGoogleConversion(conversionId, label, { value, currency = 'SGD', transactionId } = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  if (!conversionId || !label) return;

  const payload = { send_to: `${conversionId}/${label}` };
  if (typeof value === 'number' && Number.isFinite(value)) {
    payload.value = value;
    payload.currency = currency;
  }
  if (transactionId) payload.transaction_id = transactionId;

  window.gtag('event', 'conversion', payload);
}

/**
 * The funnel's single conversion action: a completed signup. In the marketplace
 * flow this point is reached only AFTER phone OTP verification, so it is already
 * a phone-verified lead — the strongest signal available to bid on without the
 * offline-outcome upload.
 */
export function trackGoogleLead(conversionId, label, opts = {}) {
  trackGoogleConversion(conversionId, label, opts);
}

/** Test seam — resets the module-level idempotency state. */
export function __resetGoogleAdsStateForTests() {
  configuredIds.clear();
  sdkInjected = false;
}
