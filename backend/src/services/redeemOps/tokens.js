import crypto from 'crypto';

/**
 * Fulfilment tokens (docs/redeem-ops/ERD.md §3.16): random 32-byte base64url,
 * SHA-256 at rest, shown once — never sequential or database ids.
 */
export function mintToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** Short human-typable voucher hint (last 4 of the raw token, uppercased). */
export function tokenHintOf(raw) {
  return String(raw).slice(-4).toUpperCase();
}
