# Webhook signature v2 cutover (P2-3)

**Status:** sender ready, live subscribers pinned to v1, receivers not yet dual-accepting.

## Why

The v1 signature is an HMAC over the raw body **alone**. Every delivery also carries
`X-Webhook-Timestamp`, and the receiver enforces a 5-minute freshness window on it — but that
header never enters the HMAC, so it is unauthenticated. Anyone who captures one delivery can
replay it indefinitely by rewriting the timestamp: the body-only signature still validates, and the
freshness check passes because the attacker controls the very field it reads.

`lead.created` is bounded by receiver-side idempotency (`external_id` + `source_name='mktr'`).
`lead.unassigned` and `lead.deleted` are **state-changing** and have no such backstop — a replayed
`lead.unassigned` un-assigns a lead that was legitimately re-assigned since.

v2 signs `${timestamp}.${rawBody}`, so a rewritten timestamp invalidates the signature.

## Current state after this PR

| Piece | State |
|---|---|
| `signatureVersionForSubscriber` | defaults to **v2**; `metadata.signatureVersion: 'v1'` is the explicit legacy opt-out |
| Any NEW subscriber | v2, timestamp-bound, no action needed |
| `Lyfe App` + `MKTR Leads App` | **pinned to v1** by `LIVE_SUBSCRIBER_SIGNATURE_VERSION` in `backend/src/database/bootstrap.js`, re-applied on every boot |

The pin is deliberate. Both receivers verify the body alone today, so flipping them without
deploying the receiver first would 401 **every** lead delivery — an outage, not a fix.

## The cutover

Strictly in this order. Each step is independently revertable.

### 1. Make the receivers accept BOTH schemes

`lyfe-app/supabase/functions/receive-mktr-lead/index.ts` — `verifySignature` currently hashes
`rawBody` only. Make it accept either, selected by the header the sender already emits:

```ts
async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  timestamp: string | null,
  version: string | null,
): Promise<boolean> {
  if (!signatureHeader.startsWith('sha256=')) return false;
  const receivedHex = signatureHeader.slice(7);

  // v2 binds the timestamp; v1 is the legacy body-only scheme. Accept both
  // during the cutover, then delete the v1 branch (step 4).
  const signed = version === 'v2' && timestamp ? `${timestamp}.${rawBody}` : rawBody;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signed));
  const computedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(receivedHex, computedHex);
}
```

Call site — read the timestamp **before** verifying, and pass both through:

```ts
const timestampHeader = req.headers.get('X-Webhook-Timestamp');
const signatureVersion = req.headers.get('X-Webhook-Signature-Version');
const valid = await verifySignature(rawBody, signatureHeader, webhookSecret, timestampHeader, signatureVersion);
```

Keep the existing mandatory-timestamp and 5-minute-window checks exactly as they are; under v2 they
become meaningful rather than advisory.

Deploy, and confirm live v1 traffic still succeeds — the version header is absent on v1 deliveries,
so they take the legacy branch unchanged.

Do the same for the mktr-leads receiver (separate repo, same shape).

### 2. Flip the sender

In `backend/src/database/bootstrap.js`:

```js
const LIVE_SUBSCRIBER_SIGNATURE_VERSION = 'v2';
```

One line. The self-heal in both `ensure*WebhookSubscriber` functions re-pins the existing rows on
the next boot, so no manual DB edit is needed.

### 3. Verify

- A real lead capture reaches Lyfe (`leads` row created, push delivered).
- `webhook_deliveries` shows `status: 'success'` for the new attempts — a scheme mismatch surfaces
  as a 401 and a retry, not a silent drop.
- Deliveries now carry `X-Webhook-Signature-Version: v2`.

### 4. Retire v1

Once both receivers have run on v2 for a soak period, delete the v1 branch from each
`verifySignature` and drop the legacy opt-out from `signatureVersionForSubscriber`.

## Rollback

Revert step 2 (the constant back to `'v1'`) and redeploy the backend. The dual-accept receivers from
step 1 keep working for both schemes, so rollback needs no receiver change.
