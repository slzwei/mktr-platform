# Suppression/erasure propagation — plan v2 (post-Codex round 1, tracker "propagate")

**Base:** origin/main @ 0b7c8dd. **Codex round 1:** 25 findings, verdict "rethink" — the v1 point-in-time fanout was lossy (dark-period loss #4, future leads #5, capture races #6, erasure self-sabotage #8, fake idempotency #10, savepoint loss #11). v2 adopts Codex's prescribed shape: **a durable suppression-propagation projection + deterministic reconciler** — the same state-derived, assignment-not-increment pattern as the consumer spine. All 25 findings dispositioned in §7.

**Scope:** emitter side (mktr-platform) to DONE-AND-LIVE, dark; spec doc; two cross-repo consumer PLAN docs (Shawn applies). Event name `lead.suppressed` (Codex: accept).

## 1. Architecture — projection, not fanout

**Source of truth** (already exists): `consumer_suppressions` + `consumers.erasedAt`. Target scope per consumer = `'all'` when erased/reason-erasure else `'marketing'`.

**NEW table `suppression_propagations`** (migration 083 + model, indexes mirrored, sync-tolerant guards, advisory-locked runner):

| column | type | notes |
|---|---|---|
| `id` | UUID PK v4 | |
| `consumerId` | UUID NOT NULL FK consumers RESTRICT | provenance; NEVER in payloads |
| `prospectId` | UUID NOT NULL FK prospects CASCADE | the lead (externalId downstream) |
| `subscriberId` | UUID NOT NULL FK webhook_subscribers CASCADE | |
| `scope` | VARCHAR(16) NOT NULL CHECK in ('marketing','all') | monotonic: 'all' row may join a 'marketing' row, never replaces it |
| `reason` | VARCHAR(32) NOT NULL | diagnostic copy (unsubscribe/complaint/admin/erasure) |
| `occurredAt` | timestamptz NOT NULL | authoritative transition time: suppression.createdAt / consumer.erasedAt (Codex #12) |
| `deliveryId` | UUID nullable | the WebhookDelivery this pair queued |
| `queuedAt` | timestamptz nullable | null = needs queueing |
| timestamps | | |

**UNIQUE `uq_sp_sub_prospect_scope` (subscriberId, prospectId, scope)** — DB-level idempotency (kills #10; concurrent reconcilers: `ON CONFLICT DO NOTHING`). Index `idx_sp_needs_queue (queuedAt) WHERE queuedAt IS NULL`; `idx_sp_consumer (consumerId)`.

**Reconciler `reconcileSuppressionPropagation({ consumerId = null })`** (new `backend/src/services/suppressionPropagationService.js`, DI factory) — deterministic, safe to run anytime, concurrently, repeatedly:
1. Load suppressed-or-erased consumers (optionally one): `consumers c JOIN consumer_suppressions s ON s."consumerId"=c.id` UNION erased (`erasedAt IS NOT NULL`); compute scope + occurredAt per consumer (erasure dominates).
2. Their leads: prospects by `consumerId` arm + (non-erased only) digits-phone arm + call_bot `fromNumber` arm (erasure already relinks its rows to the consumer, so erased consumers need only the id arm).
3. Targeted subscribers per lead = **`historicallyTargetedSubscribers(prospectIds)`** (extracted from erasureService, renamed per Codex #2 — delivery HISTORY rows of `lead.created`/`lead.assigned`, any status: conservative over-notify, documented) ∩ `enabled:true` ∩ `events.includes('lead.suppressed')` (subscription checked at reconcile time — **this is what makes the dark→flip backfill automatic**: pairs for a newly-subscribed consumer app appear on the first pass after the flip, healing the entire dark period; kills #4).
4. **Erasure-fallback rule** (Codex: accept with durability): for scope-'all'-via-erasure consumers, subscribers whose `events` include `lead.deleted` get NO pair — their signal is the erasure outbox (+ its dead-letter repair; contract states this reliance explicitly, #23).
5. INSERT missing `(subscriberId, prospectId, scope)` pairs `ON CONFLICT DO NOTHING` (scope escalation marketing→all = a second pair; downgrade impossible — no unsuppression exists, #9 contract side).
6. Queue phase: pairs `queuedAt IS NULL` (or whose delivery row is terminally `failed` — re-queue at most once per pass, only while the subscriber still carries the event) → create `WebhookDelivery` rows (payload §2) + set `queuedAt`/`deliveryId` in the SAME txn as the delivery row; flush post-commit. Requeue-vs-auto-disable pressure documented (#14): suppressions are rare and the flip-ordering runbook is the real guard.

**Triggers** (all post-commit, fire-and-forget with `.catch(warn)` — replaces v1's savepoint fanout; a lost trigger costs nothing because state heals, kills #11):
- `applyUnsubscribe` — after txn commit (both created AND alreadySuppressed paths — re-unsubscribe after a missed pass still heals, #4).
- `eraseConsumer` — post-commit, targeted.
- **Capture** — after `dispatchEvent('lead.created')` in `prospectService` + `metaLeadService` (so the history row exists): `if (prospect.consumerId) reconcile({consumerId}).catch(...)` — the reconciler no-ops cheaply when the consumer isn't suppressed. Retell path: consumerId always null (spine-excluded) → naturally no-op, comment only. This closes future-leads #5 and the capture race #6 deterministically; the periodic pass is the backstop.
- **Boot + every 60 min** (`bootstrap.js` setInterval, house pattern) — the backstop + the flag-flip backfill executor.

## 2. Wire contract (spec doc `docs/reference/webhook-propagation-contract.md`, deliverable)

```json
{
  "event": "lead.suppressed",
  "deliveryId": "<uuid>",
  "timestamp": "<ISO now>",
  "data": {
    "lead": { "externalId": "<prospect uuid>" },
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
- Explicit `schemaVersion` (#17). `channel` fixed 'all' in v1, carried for WA-STOP future (dedupe key gains channel on that schema bump, #6.7-accepted).
- **Data-minimized, NOT "PII-free"** (#16): externalId+reason+timestamp is pseudonymous person-related data. Contract states: deliver only to the app that already holds the lead; no re-sharing; log deliveryIds not payloads; `reason` retained as diagnostic (consumers act on `scope` only).
- Transport identical to existing events (HMAC v1/v2 per subscriber, same headers). Consumer MUST: verify signature+timestamp, bind body deliveryId to header where it has that machinery, validate fields strictly (#17), respond 2xx fast, treat unknown `lead.externalId` as a **tombstone to store, not a no-op** (#7), merge monotonically ('all' dominates; older occurredAt never downgrades newer state, #9).
- Sender-side facts stated honestly: retries = 3 attempts (delays 1s, 4s — no 16s, #1); failed rows → dead-letter, admin-retryable; rolling-50 all-failed auto-disable is subscriber-wide (#14) and bootstrap re-enables managed subscribers at boot (#14) — the runbook's kill-switch section covers: flip env flag off (stops new pairs at reconcile) **+ cancel pending `lead.suppressed` delivery rows via admin SQL** (recovery ignores events arrays, #13); re-queue after re-flip is automatic (failed-pair rule §1.6).

## 3. Emitter changes (mktr-platform, all dark)

1. **Migration 083 + `SuppressionPropagation` model** (§1 table).
2. **`suppressionPropagationService.js`**: reconciler + `buildLeadSuppressedPayload` (in `prospectHelpers.js` beside the other builders, exercised by the payload-contract guard — which also gains the missing unassigned/held/inline-builder coverage, #3).
3. **`webhookService.js`**: extract + rename `historicallyTargetedSubscribers(prospectIds, tx)`; erasureService switches to it (tests pin behavior).
4. **`erasureService.js`**: (a) helper swap; (b) **add `lead.suppressed` to the cancel+scrub EXCLUSION list** beside `lead.deleted` (#8 — payload is PII-free-by-contract; cancelling pending ones just to have the reconciler re-queue them is churn and breaks history); (c) post-commit targeted reconcile trigger.
5. **`consentService.applyUnsubscribe`**: post-commit trigger (no in-txn work — v1's savepoint fanout deleted).
6. **Capture hooks**: `prospectService` + `metaLeadService` post-dispatch trigger (3 lines each).
7. **`bootstrap.js`**: env-gated `requiredEvents` (`LYFE_LEAD_SUPPRESSED_ENABLED`, `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED`) applied to **both the update AND create paths** (#15); reconciler boot-run + 60-min interval.
8. **`env.example`** + spec doc + two consumer plan docs.

## 4. Consumer plans v2 (deliverable docs; tombstone-first, monotonic)

**Shared shape (both repos):** a `mktr_lead_suppressions` tombstone table keyed `(source_name, external_id)` storing `scope, reason, occurred_at, delivery_id, created_at` — **insert-or-escalate RPC** (atomic; scope 'all' dominates 'marketing'; older occurredAt never downgrades, #9/#19/#21): claim delivery id (where dedup machinery exists), upsert tombstone, and IF the lead exists apply `do_not_contact_at/do_not_contact_scope` columns + activity row in the same txn. **Lead-arrival hook**: `lead.created`/`lead.assigned` handlers consult the tombstone and stamp new rows on insert (#7 — suppression-before-created safe). Outreach gating (#20): every in-app contact affordance (call/WA buttons, wa_intro enqueue in mktr-leads' create RPC) checks scope ('all' = hard block; 'marketing' = warn badge; v1 minimum = mktr-leads gates `enqueue_wa_intro` via the tombstone at create time — which also fixes the suppressed-person-re-signup wa_intro hole #20).
- **lyfe-app**: migration (columns + tombstone + `lead_activity_type` enum value 'suppressed'); EF: allowlist + handler as a single RPC call (atomicity substitute for its missing dedup table, #19); UI badge; `gen:types`. Flip `LYFE_LEAD_SUPPRESSED_ENABLED` LAST.
- **mktr-leads**: migration (columns + tombstone + `process_mktr_lead_suppression` RPC following the deletion-RPC precedent); EF allowlist + handler; badge + wa_intro gate. Flip `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED` LAST.
- Both: synthetic verification BEFORE the flip **in the subscriber's actual signature mode** (v1 today; command recipe in each doc, #22); the 400-until-flipped warning; strict payload validation table (#17). Anchors marked "verify in-repo before applying" (#25 — consumer repos absent from this checkout; my anchors came from a mapping pass of those repos this session, restated as assumptions to re-verify).

## 5. Tests (backend jest, real PG; suites: new `suppressionPropagation.test.js` + touched regressions)

1. Reconcile from state: suppressed consumer with 3 leads (linked / phone-matched / call_bot-fromNumber), history to S1(subscribed)+S2(not) → pairs+deliveries exactly S1×3, payload spec-shaped (schemaVersion, scope, no consumerId/phone/name), occurredAt == suppression.createdAt across repeated runs.
2. Determinism/idempotency: run twice → zero new rows (DB unique proof: two CONCURRENT reconcilers via parallel txns → no dup, no error).
3. **Dark→flip backfill** (#4): suppress while S1 lacks the event → 0 pairs; add event → next pass creates pairs (the whole dark cohort).
4. **Future lead** (#5): unsubscribe, THEN new capture same consumer → capture-hook pass (or periodic) yields the new pair.
5. Race shape (#6): capture committed but reconcile ran before its delivery row → 0 pairs; after dispatch → pair appears (periodic heals).
6. Escalation (#9): unsubscribe→pairs(marketing); erase → 'all' pairs added for suppressed-only subscriber; lead.deleted-handling subscriber gets NO suppression pair but keeps its lead.deleted row (fallback matrix, both arms).
7. Erasure interplay (#8): pending lead.suppressed delivery survives erasure's cancel+scrub (exclusion list); erasure suite regression green after the helper swap.
8. Failed-pair requeue: delivery row forced 'failed' → next pass requeues ONCE while subscribed; not when unsubscribed (kill-switch semantics) — plus runbook SQL cancels pendings (asserted inert afterward).
9. Triggers: unsubscribe/erase/capture each fire reconcile (spy); trigger failure (dep throws) → suppression/capture still commits (post-commit isolation — a REAL SQL error inside the reconciler against a live outer flow, per #24's savepoint-test critique... reconciler is post-commit so the assertion is: writer unaffected, next pass heals).
10. Bootstrap: flag on → events gain lead.suppressed on BOTH update and create paths (#15); flag off → removed; reconcile interval registered.
11. Payload-contract guard extended: consumerId absent from ALL builders incl. new one + unassigned/held/inline Meta/Retell (#3).
12. WEBHOOK_ENABLED=false: reconcile creates pairs but queues nothing; flip → queued (pairs are the durability).

Regressions: erasure.test.js, consentLedger.test.js(+unit), webhook suites, prospectService suites, migrations test. Frontend: vitest contract run.

## 6. Rollout

Deploy backend (migration 083 runs at boot, advisory-locked). Flags OFF: reconciler runs but matches zero subscribed subscribers → creates zero pairs; zero deliveries; zero behavior change. Live proof: NEW Render deploy; `psql` (read-only MCP) `SELECT count(*) FROM suppression_propagations` (=0) + boot log line `suppression propagation reconciler armed (dark)` in Render logs; admin subscribers listing shows unchanged events arrays. Tracker: emitter live-dark + plans delivered → seed per contract gate (consumer side awaits Shawn).

## 7. Codex round-1 disposition

Folded: #1 (doc), #2 (rename+doc), #3 (guard coverage), #4 (reconciler = backfill; alreadySuppressed re-triggers), #5 (capture hook + periodic), #6 (post-dispatch ordering + periodic heal), #7 (consumer tombstones), #8 (scrub exclusion + dedupe moved out of payload JSON), #9 (monotonic scope pairs + consumer merge rules), #10 (DB unique + ON CONFLICT), #11 (durable pairs replace savepoint fanout), #12 (persisted occurredAt), #13 (runbook cancel + reconcile-side gate), #14 (documented; event-scoped breaker declined as out-of-scope rework of the shared webhook layer — suppressions are low-volume and flip-ordering is the operative guard), #15 (both paths), #16 (language + confidentiality clauses), #17 (schemaVersion + validation tables), #18 (dedupe out of JSON; history scan stays — one-off per reconcile over a small table, measured acceptable; index follow-up noted), #19/#20/#21 (consumer plans v2), #22 (signature-mode recipe), #23 (reliance stated), #24 (test list §5), #25 (anchors flagged as re-verify).
Declined: none outright; #14/#18 partially (documented bounds instead of rework), rationale above.
