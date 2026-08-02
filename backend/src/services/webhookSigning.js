import crypto from 'crypto';

/**
 * Webhook signature versions.
 *
 *   v1 — HMAC over the raw body ALONE.
 *   v2 — HMAC over `${timestamp}.${rawBody}`.
 *
 * v1 sends X-Webhook-Timestamp but never mixes it into the HMAC, so the header
 * is unauthenticated: anyone who captures one delivery can replay it with a
 * freshly-rewritten timestamp and the body-only signature still validates —
 * the receiver's 5-minute replay window is defeated by rewriting the very field
 * it checks. For lead.created the blast radius is bounded by receiver-side
 * idempotency, but lead.unassigned and lead.deleted are state-changing and have
 * no such backstop.
 *
 * v2 binds the timestamp, so a rewritten one invalidates the signature (P2-3).
 */

/** v2 unless a subscriber explicitly pins itself to the legacy scheme. */
export const DEFAULT_SIGNATURE_VERSION = 'v2';

/**
 * Which scheme to sign a given subscriber's deliveries with.
 *
 * `metadata.signatureVersion: 'v1'` is the explicit LEGACY OPT-OUT and exists
 * for exactly one reason: a receiver that cannot yet verify v2. Both live
 * subscribers are pinned that way by bootstrap until the receive-mktr-lead edge
 * function accepts both schemes — see docs/plans/webhook-signature-v2-cutover.md.
 * Anything unrecognised falls through to the secure default rather than
 * silently downgrading.
 */
export function signatureVersionForSubscriber(subscriber) {
  return subscriber?.metadata?.signatureVersion === 'v1' ? 'v1' : DEFAULT_SIGNATURE_VERSION;
}

/** Build the HMAC header for one delivery attempt. */
export function signWebhookAttempt({ secret, rawBody, timestamp, signatureVersion }) {
  const signedContent = signatureVersion === 'v1' ? rawBody : `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
  return `sha256=${digest}`;
}
