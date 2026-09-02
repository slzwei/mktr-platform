import crypto from 'crypto';

/**
 * dncProtocol — the PURE PDPC realtime-API wire format: number normalisation,
 * the signature base string, RSA-SHA256 signing, the Authorization header and
 * response parsing.
 *
 * Split out of dncService.js so the shared DNC queue (src/dncGateway) can speak
 * the exact same protocol without importing Sequelize models, the prospect
 * tables, or Sentry. dncService re-exports every function below, so its public
 * API — and every existing test against it — is unchanged.
 *
 * Spec: docs/plans/dnc-scrubbing.md. Nothing here performs I/O.
 */

/** PEM private keys are often stored with literal "\n"; restore real newlines. */
export function normalizePem(pem) {
  if (!pem) return pem;
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

/**
 * Normalise a phone to the DNC wire format: 8 local digits starting 3/6/8/9.
 * Returns null for non-SG / malformed numbers (DNC only covers Singapore) → caller
 * marks the lead `skipped`.
 */
export function formatDncNumber(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('65')) d = d.slice(2); // 65XXXXXXXX
  else if (d.length === 10 && d.startsWith('65')) d = d.slice(2);
  if (d.length !== 8) return null;
  if (!/^[3689]\d{7}$/.test(d)) return null;
  return d;
}

/** Signature base string — order is fixed and must match the header timestamp exactly. */
export function buildBaseString({ orgCode, eServiceId, timestamp }) {
  return `orgCode=${orgCode}&eServiceId=${eServiceId}&timestamp=${timestamp}`;
}

/** RSA-SHA256 over the base string, strict base64 (no line breaks). */
export function signRequest(baseString, privateKeyPem) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(baseString, 'utf8');
  signer.end();
  return signer.sign(normalizePem(privateKeyPem), 'base64');
}

/** Authorization header value — field order is critical (orgCode, eServiceId, timestamp, appSignature). */
export function buildAuthHeader({ orgCode, eServiceId, timestamp, appSignature }) {
  return `orgCode=${orgCode}&eServiceId=${eServiceId}&timestamp=${timestamp}&appSignature=${appSignature}`;
}

/** Map an Annex-A status code → handling. */
export function mapStatusCode(code) {
  switch (code) {
    case 'S000': return { ok: true };
    // No credits: keep the lead retriable (→ pending) so the backfill recovers it after top-up,
    // and alert so a human tops up. Held leads stay fail-safe meanwhile.
    case 'S301': return { ok: false, retriable: true, alert: true, reason: 'insufficient_credits' };
    case 'S401':
    case 'S402':
    case 'S404': return { ok: false, retriable: false, alert: true, reason: 'auth' };
    case 'S403': return { ok: false, retriable: false, alert: true, reason: 'bad_timestamp' };
    case 'S101':
    case 'S102':
    case 'S405': return { ok: false, retriable: false, alert: true, reason: 'bad_request' };
    case 'S501': return { ok: false, retriable: true, reason: 'dnc_internal' };
    default: return { ok: false, retriable: true, reason: 'unknown' };
  }
}

/** Pull the validity end date out of the human-readable `msg` ("…valid until 06-Nov-2020"). */
export function parseValidUntil(msg) {
  if (!msg) return null;
  const m = String(msg).match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]} ${m[3]} 23:59:59 GMT+0800`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalise the DNC response JSON → typed result. */
export function parseResponse(json) {
  // Spec v1.1 documents a flat top-level `status_code` for every Annex-A code, but the live
  // system returns ERRORS as an `{ errorTo: { code, message, errors[] } }` envelope with
  // HTTP 500 (observed in PRODUCTION 31 Aug 2026 for S501). Reading only `status_code` left
  // every error as null → mapStatusCode's `default` (unknown/retriable, no alert), so the
  // per-code branches — S301 insufficient-credits and S401/S402/S404 auth, both of which set
  // `alert: true` — could never fire. Read both shapes.
  const statusCode = json?.status_code || json?.errorTo?.code || null;
  const results = Array.isArray(json?.numbers)
    ? json.numbers.map((n) => ({
        number: n.number,
        noVoiceCall: n.no_voice_call === 'R',
        // Spec v1.1 documents `no_text_message`, but the live UAT system returns
        // `no_text` (observed 12 Aug 2026, confirmed with DNC Ops). Accept both.
        noTextMessage: (n.no_text_message ?? n.no_text) === 'R',
        noFax: n.no_fax === 'R',
      }))
    : [];
  return {
    statusCode,
    results,
    validUntil: parseValidUntil(json?.msg),
    transactionId: json?.transactionid || null,
    createdTime: json?.created_time || null,
    rawMsg: json?.msg || null,
  };
}

export const DNC_CHECK_ENDPOINT = 'check/registry';

export default {
  normalizePem,
  formatDncNumber,
  buildBaseString,
  signRequest,
  buildAuthHeader,
  mapStatusCode,
  parseValidUntil,
  parseResponse,
  DNC_CHECK_ENDPOINT,
};
