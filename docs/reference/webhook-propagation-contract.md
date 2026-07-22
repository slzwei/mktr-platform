# Webhook propagation contract — `lead.suppressed` v1

**Status:** emitter LIVE-dark since 2026-07-21 (tracker "propagate"); no subscriber carries the event until its per-destination env flag flips.
**Design:** durable projection + reconciler, NOT point-in-time fanout — `docs/plans/suppression-propagation-plan.md` (v2, post-Codex).
**Consumer plans:** `docs/plans/propagate-consumer-lyfe.md` · `docs/plans/propagate-consumer-mktr-leads.md`.

## 1. What the event means

**"Stop contacting the person behind this lead; keep the lead."** Emitted to every subscriber that was ever targeted with the lead's payload (`lead.created`/`lead.assigned` delivery history — any status, conservative over-notify) once the person unsubscribes, is admin-suppressed, or is erased.

Relationship to `lead.deleted` (PR C erasure): the fallback is **outcome-based** — a subscriber is skipped for the `scope:'all'` pair only when its `lead.deleted` delivery row for that lead actually EXISTS (not merely because it declares the capability). Deletion implies stop-contact, so when the deletion signal was queued, no duplicate suppression fires; but an erasure that ran while webhooks were disabled queued nothing, and the reconciler then projects the suppression fallback even to deleted-capable subscribers rather than silently dropping stop-contact. If a later repair also queues the deletion, receiving both is harmless — consumer merge is monotonic. A subscriber that handles `lead.suppressed` but not `lead.deleted` always gets the fallback `reason:'erasure', scope:'all'` — so stop-contact coverage can ship before a deletion handler exists.

There is **no un-suppression event** in v1. Consumer state is monotonic; if a lift path ever ships it will be a NEW event type, not a semantics change here.

## 2. Wire format

Transport identical to every existing event: `POST` to the subscriber URL, headers `X-Webhook-Event`, `X-Webhook-Delivery-Id`, `X-Webhook-Signature` (`sha256=<hex>` HMAC), `X-Webhook-Timestamp`, plus `X-Webhook-Signature-Version: v2` when the subscriber is v2 (v1 signs the raw body; v2 signs `${timestamp}.${rawBody}`). `deliveryId` is also merged into the JSON body.

```json
{
  "event": "lead.suppressed",
  "deliveryId": "<uuid>",
  "timestamp": "<ISO — send time>",
  "data": {
    "lead": { "externalId": "<prospect uuid — your stored external_id>" },
    "suppression": {
      "schemaVersion": 1,
      "scope": "marketing" | "all",
      "reason": "unsubscribe" | "complaint" | "admin" | "erasure",
      "channel": "all",
      "occurredAt": "<ISO — authoritative transition time, stable across repairs>"
    }
  }
}
```

- `scope` is what consumers act on: `all` = block every contact including transactional/service messages; `marketing` = block marketing, service messages may flow. `reason` is diagnostic only.
- `channel` is fixed `'all'` in v1 and carried for forward-compat (a future WhatsApp-STOP writes `channel:'whatsapp'` under a `schemaVersion` bump). Correspondingly, the emitter projects only `channel='all'` suppression rows — a per-channel suppression row is never promoted to a global scope.
- `timestamp` is queue/build time, not send time — retries and repairs re-send the same body. Use `occurredAt` for ordering, never `timestamp`.
- **Data minimization, stated honestly:** the payload carries no name/phone/email/consumerId, but `externalId + reason + occurredAt` is still pseudonymous person-related data. Consumers must not re-share it, must restrict it to the app that already holds the lead, and should log delivery ids, not payloads.

## 3. Consumer requirements (both apps)

1. Verify signature + timestamp exactly as for existing events; bind body `deliveryId` to the header where that machinery exists (mktr-leads).
2. Validate strictly: `event === 'lead.suppressed'`, `externalId` uuid, `scope ∈ {marketing, all}`, `reason ∈` the enum, `occurredAt` parseable. Unknown `schemaVersion` > 1 → still 2xx, apply what you understand.
3. Respond 2xx fast; the sender retries 3 attempts (delays 1s, 4s) then dead-letters (admin-retryable). A 4xx/5xx counts toward the subscriber-wide rolling-50 auto-disable.
4. **Idempotent + monotonic merge**: repairs re-send with a NEW deliveryId, and deliveries are unordered/concurrent. Keyed by `(source_name, external_id)`: `all` dominates `marketing`; an older `occurredAt` never downgrades newer state.
5. **Unknown lead = tombstone, not no-op**: a suppression can arrive before its `lead.created` (delivery concurrency). Store the suppression keyed by `(source_name, external_id)` and apply it when the lead later arrives (the created/assigned handlers must consult the tombstone).
6. Suppression state must actually gate outreach affordances (buttons, auto-sends), not just render a badge — `all` is a hard block.

## 4. Emitter internals (mktr-platform — for operators)

- State: `suppression_propagations` — one row per (subscriber, lead, scope); UNIQUE `(subscriberId, prospectId, scope)`; `queuedAt`/`deliveryId` track the outbox linkage. Rows are DERIVED — the reconciler (`suppressionPropagationService`) recomputes from `consumer_suppressions` + `consumers.erasedAt` ⨝ prospects (consumer link + phone-digit + call_bot fromNumber arms) ⨝ delivery history ⨝ current subscriptions.
- Passes: on boot; every 60 min; post-commit after unsubscribe/erasure; after capture of a lead whose consumer is linked (covers new-lead-while-suppressed). Any lost trigger heals on the next pass — the projection is the durability, including the ENTIRE dark period before a flag flip (the first pass after the flip is the backfill).
- A terminally-failed delivery is re-queued at most once per pass while the subscriber still carries the event.
- Erasure's payload cancel/scrub explicitly exempts `lead.deleted` AND `lead.suppressed` rows (neither carries direct identifiers — pseudonymous envelopes only).
- A dead-letter purge that deletes a failed `lead.suppressed` row does NOT strand its pair: the requeue query treats a missing delivery row like a failed one.

## 5. Go-live runbook (per consumer — ORDER IS THE SAFETY)

1. Apply the consumer plan in that repo (migration + EF allowlist + handler + gating). Deploy it.
2. **Synthetic verification BEFORE the flip**, in the subscriber's actual signature mode (both are v1 today): hand-sign a `lead.suppressed` POST with the shared secret directly against the EF; assert 200 + state landed + idempotent on re-send + unknown-lead tombstone path.
3. Flip the env flag on the mktr backend Render service (`LYFE_LEAD_SUPPRESSED_ENABLED` / `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED`) → the restart's boot pass adds the event to the subscriber AND backfills the dark-period pairs.
4. Verify: `suppression_propagations` rows appear for that subscriber; deliveries flow `success`; consumer-side rows updated.

**Why the order is load-bearing:** both receivers 400 unknown events; the sender's auto-disable trips after the newest 50 delivery rows are all `failed` — a premature flip can disable the subscriber and stop ALL lead delivery to that app. Also note: bootstrap force-re-enables managed subscribers at boot, so an auto-disable during a bad rollout will resurrect on the next deploy while the flag is still on — the flag itself is the kill switch, flip it off first.

**Kill switch:** flip the flag off (next boot removes the event → reconciler stops queueing for that subscriber; projected pairs persist harmlessly) and, if deliveries are already pending, cancel them:
```sql
UPDATE webhook_deliveries SET status='failed', "errorMessage"='cancelled: rollout aborted'
 WHERE "eventType"='lead.suppressed' AND status='pending';
```
(Recovery/timers ignore event arrays — pending rows would otherwise keep attempting.) Re-flipping later re-queues from the pairs automatically.

## 6. `lead.unsuppressed` v1 — the resubscribe lift (added 2026-07-22)

**"The person behind this lead re-consented; marketing contact is allowed again."** Emitted when a fresh OTP-VERIFIED agree-all capture lifts a prior `unsubscribe`-reason suppression (latest-explicit-consent-wins — Shawn's Reading-2 decision; evidence = a `source:'resubscribe'` consent-ledger event whose `occurredAt` is the watermark below). Only ever `scope:'marketing'`; the `'all'` scope (erasure) is a latch and never lifts. `complaint`/`admin` suppressions never auto-lift.

```json
{
  "event": "lead.unsuppressed",
  "deliveryId": "<uuid>",
  "timestamp": "<ISO — queue/build time>",
  "data": {
    "lead": { "externalId": "<prospect uuid>" },
    "unsuppression": { "schemaVersion": 1, "scope": "marketing", "reason": "resubscribe", "occurredAt": "<ISO>" }
  }
}
```

**Merge rule (BOTH events): a PERSISTENT per-lead state row, watermarked.** The consumer's suppression row is never deleted — it carries `state ('suppressed'|'lifted')` + the `occurred_at` watermark (deleting it would destroy the watermark and let a repaired OLDER suppression re-suppress a lifted person, and would discard lifts arriving before their suppression). Rules:
- scope `'all'` (erasure) is a latch: marketing events never touch it; same-scope `'all'` refreshes the watermark forward only; an `'all'` suppression outranks any marketing state regardless of timestamps.
- a marketing suppression applies when STRICTLY newer, or on an EQUAL watermark when the row is lifted — **ties resolve toward suppressed** (fail-safe direction).
- a lift applies only when STRICTLY newer; with no row present it INSERTS a lifted row (the pre-arrival watermark hold).
- lead columns stamp only from a resulting suppressed state (arrival hooks/triggers check `state='suppressed'`); a valid lift nulls `do_not_contact_*` **where scope is `'marketing'` only** and logs a `resubscribed` activity when state actually changed.

New leads of a lifted person need no lift delivery — no suppression exists on the emitter, nothing stamps them (the lifted row is a hold, not a suppression), and create-time outreach (wa_intro) resumes naturally.

**Documented residuals (Codex resub-round dispositions):** (a) transition ordering uses millisecond wall-clock `occurredAt` — a same-millisecond unsub/resub tie resolves toward suppressed at every layer (emitter lift requires strictly-newer; consumer ties prefer suppressed), so the failure direction is a missed lift, never a wrong un-suppression; (b) the OTP verification marker is phone-scoped for 10 minutes, not bound to the capturing request — a same-window caller knowing the phone could piggyback a verified capture (pre-existing spine semantics; raised stakes noted for the counsel pack and the future one-time-capture-credential hardening); (c) if the lift's savepoint fails, the person simply stays suppressed until their next verified agree-all capture — the consent backfill heals evidence, not lifts (fail-safe by construction).

Sender side: pairs are a two-state machine (`state` desired / `deliveredState` conveyed); flips re-queue automatically; a subscriber whose `events` lacks `lead.unsuppressed` keeps its lifted pairs unqueued (silently, each pass) until its allowlist catches up — both events ride the same per-destination env flags, so managed subscribers always carry them together.
