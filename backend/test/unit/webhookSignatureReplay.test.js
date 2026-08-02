/**
 * P2-3 regression: the timestamp is part of what gets signed.
 *
 * v1 hashes the raw body ALONE. Every delivery carries X-Webhook-Timestamp and
 * the receiver enforces a 5-minute freshness window on it — but that header
 * never entered the HMAC, so it was unauthenticated. An attacker who captured
 * one delivery could replay it forever by rewriting the timestamp: the
 * body-only signature still validated, and the freshness check passed because
 * the attacker controlled the field it reads.
 *
 * These model the receiver's own check — recompute the HMAC over what the
 * scheme says is signed, and compare — so "rejected" here means "rejected on
 * the wire".
 */
import '../setup.js';
import crypto from 'crypto';
import { signWebhookAttempt, signatureVersionForSubscriber } from '../../src/services/webhookSigning.js';

const SECRET = 'shared-webhook-secret';
const BODY = JSON.stringify({ event: 'lead.unassigned', deliveryId: 'd-1', data: { id: 'lead-9' } });
const CAPTURED_AT = '2026-08-02T10:00:00.000Z';
const REPLAYED_AT = '2026-08-02T18:30:00.000Z'; // hours later, inside nobody's window

/** What a receiver does: recompute over the signed content for the claimed version. */
function receiverAccepts({ signature, rawBody, timestamp, version }) {
  const signed = version === 'v1' ? rawBody : `${timestamp}.${rawBody}`;
  const expected = `sha256=${crypto.createHmac('sha256', SECRET).update(signed).digest('hex')}`;
  return signature === expected;
}

describe('replaying a captured delivery with a fresh timestamp', () => {
  it('is REJECTED under v2 — the timestamp is bound into the signature', () => {
    const signature = signWebhookAttempt({
      secret: SECRET, rawBody: BODY, timestamp: CAPTURED_AT, signatureVersion: 'v2',
    });

    // The attacker replays the captured body + signature, rewriting only the
    // timestamp header so the receiver's freshness window passes.
    expect(receiverAccepts({ signature, rawBody: BODY, timestamp: REPLAYED_AT, version: 'v2' })).toBe(false);

    // ...and the original delivery still verifies, so this is not a blanket reject.
    expect(receiverAccepts({ signature, rawBody: BODY, timestamp: CAPTURED_AT, version: 'v2' })).toBe(true);
  });

  it('was ACCEPTED under v1 — this is the hole being closed', () => {
    const signature = signWebhookAttempt({
      secret: SECRET, rawBody: BODY, timestamp: CAPTURED_AT, signatureVersion: 'v1',
    });

    expect(receiverAccepts({ signature, rawBody: BODY, timestamp: REPLAYED_AT, version: 'v1' })).toBe(true);
  });

  it('still rejects a tampered BODY under v2', () => {
    const signature = signWebhookAttempt({
      secret: SECRET, rawBody: BODY, timestamp: CAPTURED_AT, signatureVersion: 'v2',
    });
    const tampered = JSON.stringify({ event: 'lead.deleted', deliveryId: 'd-1', data: { id: 'lead-9' } });

    expect(receiverAccepts({ signature, rawBody: tampered, timestamp: CAPTURED_AT, version: 'v2' })).toBe(false);
  });

  it('produces a different signature per timestamp for one body', () => {
    const a = signWebhookAttempt({ secret: SECRET, rawBody: BODY, timestamp: CAPTURED_AT, signatureVersion: 'v2' });
    const b = signWebhookAttempt({ secret: SECRET, rawBody: BODY, timestamp: REPLAYED_AT, signatureVersion: 'v2' });
    expect(a).not.toBe(b);

    // v1 cannot tell those two deliveries apart — the defect in one line.
    const v1a = signWebhookAttempt({ secret: SECRET, rawBody: BODY, timestamp: CAPTURED_AT, signatureVersion: 'v1' });
    const v1b = signWebhookAttempt({ secret: SECRET, rawBody: BODY, timestamp: REPLAYED_AT, signatureVersion: 'v1' });
    expect(v1a).toBe(v1b);
  });
});

describe('version selection', () => {
  it('defaults to the timestamp-bound scheme', () => {
    expect(signatureVersionForSubscriber({ metadata: {} })).toBe('v2');
    expect(signatureVersionForSubscriber({})).toBe('v2');
    expect(signatureVersionForSubscriber(undefined)).toBe('v2');
  });

  it('honours the explicit legacy opt-out and nothing else', () => {
    expect(signatureVersionForSubscriber({ metadata: { signatureVersion: 'v1' } })).toBe('v1');
    // A typo must not silently downgrade a subscriber to the replayable scheme.
    expect(signatureVersionForSubscriber({ metadata: { signatureVersion: 'V1' } })).toBe('v2');
    expect(signatureVersionForSubscriber({ metadata: { signatureVersion: 'typo' } })).toBe('v2');
  });
});
