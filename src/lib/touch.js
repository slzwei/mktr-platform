import { isSuppressedSurface } from './pixelSuppression';

/**
 * Touchpoint beacons (ads-centralisation §4.2/§4.4) — the client half of the
 * durable cross-channel visit history.
 *
 * ONE boot session id: `_mktr_sid_boot` in localStorage as
 * `{ id: <32-hex>, expiresAt: now+90d }`, regenerated past expiry. Creation is
 * serialized across tabs with the Web Locks API where available (re-read
 * inside the lock — the other tab may have won); without Web Locks,
 * last-writer-wins is accepted and the cross-tab guarantee is explicitly
 * best-effort — the server's httpOnly cookie converges every tab after the
 * first response, so a brief two-sid split can lose at most the first seconds
 * of one tab's touches. The header `X-Session-Id: <boot id>` rides every
 * touch beacon and the prospect submit because the client cannot read the
 * httpOnly cookie; the server prefers its validated cookie when both exist.
 *
 * Beacons are INTENTIONALLY LOSSY: keepalive fetch, every failure swallowed,
 * a 30-minute per-URL sessionStorage throttle, and the server enforces its
 * own per-session cap. The sid is never authorization material.
 */

const BOOT_KEY = '_mktr_sid_boot';
const BOOT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const THROTTLE_PREFIX = '_mktr_touch:';
const THROTTLE_TTL_MS = 30 * 60 * 1000;
const SID_RE = /^[a-f0-9]{32}$/;

// Query params that may ride into landingPath / the beacon body — attribution
// material only, never tokens (the token routes are outside the allow-list
// anyway, but the whitelist keeps a pasted URL's junk out of the row too).
const WHITELISTED_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'ttclid', 'gclid', 'gbraid', 'wbraid', 'campaign_id', 'ref',
];

function randomSid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readBoot() {
  try {
    const raw = localStorage.getItem(BOOT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || typeof rec.id !== 'string' || !SID_RE.test(rec.id)) return null;
    if (typeof rec.expiresAt !== 'number' || rec.expiresAt <= Date.now()) return null;
    return rec;
  } catch {
    return null;
  }
}

function mintBoot() {
  const rec = { id: randomSid(), expiresAt: Date.now() + BOOT_TTL_MS };
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify(rec));
  } catch {
    /* storage unavailable (private mode) — the id still serves this page */
  }
  return rec.id;
}

/** The boot session id — minted once, 90-day expiry, cross-tab-serialized where possible. */
export async function getBootSessionId() {
  if (typeof window === 'undefined') return null;
  const existing = readBoot();
  if (existing) return existing.id;
  if (navigator.locks?.request) {
    try {
      return await navigator.locks.request('mktr_sid_boot', async () => readBoot()?.id || mintBoot());
    } catch {
      return readBoot()?.id || mintBoot();
    }
  }
  return mintBoot();
}

/** The §4.4 gates: env flag ∧ not a suppressed surface ∧ (prod || dev opt-in). */
export function touchGatesPass({ campaign, pathname, search } = {}) {
  if (import.meta.env.VITE_TOUCH_ENABLED !== 'true') return false;
  if (!import.meta.env.PROD && !import.meta.env.VITE_TOUCH_DEV_MODE) return false;
  if (isSuppressedSurface({ campaign, pathname, search })) return false;
  return true;
}

function throttled(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const at = Number(raw);
      if (Number.isFinite(at) && Date.now() - at < THROTTLE_TTL_MS) return true;
    }
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* storage unavailable — fall through unthrottled, the server caps */
  }
  return false;
}

function apiBase() {
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
}

/**
 * Fire one touch beacon for the current URL. Fire-and-forget; every failure
 * is swallowed. `campaign` (when the surface has one loaded) feeds the
 * test-data suppression gate; `campaignId` rides to the server.
 */
export async function beaconTouch({ campaign, campaignId, surface } = {}) {
  try {
    if (typeof window === 'undefined' || !surface) return;
    const pathname = window.location.pathname;
    const search = window.location.search;
    if (!touchGatesPass({ campaign, pathname, search })) return;
    if (throttled(THROTTLE_PREFIX + pathname + search)) return;

    const params = new URLSearchParams(search);
    const kept = new URLSearchParams();
    for (const name of WHITELISTED_PARAMS) {
      const value = params.get(name);
      if (value) kept.set(name, value);
    }
    const qs = kept.toString();
    const bootId = await getBootSessionId();
    if (!bootId) return;

    const body = {
      surface,
      path: (pathname + (qs ? `?${qs}` : '')).slice(0, 512),
      ...(document.referrer ? { referrer: document.referrer.slice(0, 2048) } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(params.get('utm_source') ? { utm_source: params.get('utm_source').slice(0, 128) } : {}),
      ...(params.get('utm_medium') ? { utm_medium: params.get('utm_medium').slice(0, 128) } : {}),
      ...(params.get('utm_campaign') ? { utm_campaign: params.get('utm_campaign').slice(0, 190) } : {}),
      ...(params.get('utm_term') ? { utm_term: params.get('utm_term').slice(0, 190) } : {}),
      ...(params.get('utm_content') ? { utm_content: params.get('utm_content').slice(0, 190) } : {}),
      ...(params.get('fbclid') ? { fbclid: params.get('fbclid').slice(0, 512) } : {}),
      ...(params.get('ttclid') ? { ttclid: params.get('ttclid').slice(0, 512) } : {}),
      ...(params.get('gclid') ? { gclid: params.get('gclid').slice(0, 512) } : {}),
      ...(params.get('gbraid') ? { gbraid: params.get('gbraid').slice(0, 512) } : {}),
      ...(params.get('wbraid') ? { wbraid: params.get('wbraid').slice(0, 512) } : {}),
    };

    await fetch(`${apiBase()}/analytics/touch`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': bootId },
      body: JSON.stringify(body),
    });
  } catch {
    /* intentionally lossy */
  }
}

/**
 * Headers for the prospect submit (§4.2): the boot id rides X-Session-Id so
 * the fastest submit still binds a session. Gated on VITE_TOUCH_ENABLED —
 * flipped together with the backend, whose CORS allow-list must already
 * accept the header (a lone frontend flip would fail every submit preflight).
 */
export async function sessionSubmitHeaders() {
  try {
    if (import.meta.env.VITE_TOUCH_ENABLED !== 'true') return {};
    const bootId = await getBootSessionId();
    return bootId ? { 'X-Session-Id': bootId } : {};
  } catch {
    return {};
  }
}
