/**
 * RSVP pages — the PUBLIC client (docs/plans/rsvp-pages.md §7.8).
 *
 * Deliberately NOT the shared apiClient: that one always sends
 * `credentials: 'include'`, reads a localStorage token, and reacts to 401s by
 * tearing down a session. An attendee on rsvp.redeem.sg has no session and
 * must never carry one — this client sends no cookies and no token, ever.
 *
 * Base URL: VITE_RSVP_API_BASE (the rsvp surface calls api.mktr.sg directly,
 * cross-origin under CORS, so the static site needs no /api rewrite) and
 * otherwise the build's VITE_API_URL (dev / other surfaces).
 */
const BASE = (import.meta.env.VITE_RSVP_API_BASE || import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'omit',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = body?.data;
    throw err;
  }
  return body;
}

/** The attendee-facing DTO (state open/closed/ended/full); throws { status: 404 } for an unknown or draft slug. */
export async function fetchPublicRsvp(slug) {
  const body = await call(`/rsvp-public/${encodeURIComponent(slug)}`);
  return body?.data ?? null;
}

/** { status: 'created' | 'updated' | 'ok' }; typed failures carry err.data.code (full / closed / ended / invalid). */
export async function submitRsvp(slug, payload) {
  const body = await call(`/rsvp-public/${encodeURIComponent(slug)}/respond`, { method: 'POST', body: JSON.stringify(payload) });
  return body?.data ?? null;
}

/**
 * Mobile verification. These are the funnel's own OTP endpoints (Singapore
 * mobiles only, six digits, ten minutes, five attempts, and a per-number daily
 * cap that protects the registered "MKTR" sender id). `phone` is the bare
 * 8-digit local number.
 */
export async function sendRsvpPhoneCode(phone) {
  return call('/verify/send', { method: 'POST', body: JSON.stringify({ phone, countryCode: '+65' }) });
}

/** Resolves on a good code; a wrong one throws with the server's own wording. */
export async function checkRsvpPhoneCode(phone, code) {
  const body = await call('/verify/check', { method: 'POST', body: JSON.stringify({ phone, code, countryCode: '+65' }) });
  const ok = body?.data?.verified === true || body?.data?.status === 'approved';
  if (!ok) throw new Error('That code did not verify. Please try again.');
  return true;
}
