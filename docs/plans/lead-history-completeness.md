# Lead History completeness — draw outcomes, voucher lifecycle, resends, consent

Shawn's ask (2026-07-26, after the delivery-truth work): the lead-profile History
should also show (1) draw outcomes + session undo, (2) the voucher lifecycle
beyond redeemed, (3) staff resends, (4) consent withdrawals/erasure. All four are
read-time projections over data that already exists; no new writes anywhere.

## Data sources (verified in code)

| Event | Where it lives today | Key facts |
|---|---|---|
| Draw result | `getProspectDrawStatus` already returns `outcome.status ∈ selected_pending/selected_claimed/selected_unclaimed/selected_unreachable/selected_ineligible/selected_declined/not_selected_yet/not_selected_final` + `attemptNo/claimDeadline/claimedAt` (`luckyDrawService.js:1046-1067`) | **No timestamp** in the per-prospect projection — `DrawAttempt.drawnAt` exists but isn't mapped |
| Session undo | `redemption_events` type **`unlock_reversed`** (staff, `metadata.reason`, supersedesEventId) — `entitlementService.js` undoSessionUnlock | |
| Customer opened pass/voucher | `redemption_events` type **`claim_viewed`** (actorType consumer, no metadata) — `rewardClaim.js:65-70` | High-volume risk: every page view writes one |
| Merchant/console scan | `redemption_events` type **`verify_attempt`**; draw-pass scans carry `metadata.draw: true` | Draw scans already surface as "Draw boost recorded" — exclude `draw:true` |
| Void after redemption | `redemption_events` type **`reversed`** (redemptionId, staff) | |
| Expiry | `redemption_events` type **`expired`** (sweep-written) | |
| Cancellation | **No redemption_event** — evidence is `reward_inventory_events` type `cancelled` (reason, createdAt) + entitlement.status | One extra bounded query on `RewardInventoryEvent` |
| Staff resend | `redemption_events` type `manual_override`, `metadata.action ∈ resend_pass/resend_voucher/resend_boost/auto_resend` + `channel` (email/whatsapp/both/link) | actorUserId → staff name resolvable |
| Consent withdrawal | `ConsentEvent` kind `contact`, `granted:false`, source `unsubscribe`, `metadata.via ∈ unsubscribe_link/wa_stop/…` (applyUnsubscribe) | WA STOP just started writing these (wa-delivery-truth) |
| Re-subscribe / re-grant | `ConsentEvent` granted:true with non-capture source (lift path — exact source strings verified at implementation) | Capture-time grants are NOT timeline rows (the signup row implies them) |
| Erasure | `consumer.erasedAt` (already on the journey payload) | Row, not just the banner |

## Backend changes (all in `leadProfileService` — admin-only, bounded)

1. **`entitlementEvents(entitlementIds)`** — one query over `redemption_events`
   for types `unlock_reversed / claim_viewed / verify_attempt / reversed /
   expired / manual_override(action LIKE resend_% or auto_resend)`, ASC,
   LIMIT ~300; plus one `reward_inventory_events` query for `cancelled` rows.
   Projected per entitlement as `events: [{ at, type, action?, channel?,
   reason?, draw?, actorName? }]` — actor names batched via `User` (staff who
   resent/reversed/cancelled). `claim_viewed` **collapsed to first-per-entitlement**
   ("first opened") + count — a customer refreshing their pass page must not
   flood History.
2. **Draw outcome timestamp** — `luckyDrawService` per-prospect outcome gains
   `drawnAt` (last attempt's `drawnAt`) in both `selected_*` and `not_selected_*`
   branches. Additive field; nothing else changes.
3. **Consent timeline** — `journey.consentTimeline`: `ConsentEvent.findAll`
   for the consumer, `granted:false` (all) plus `granted:true` whose source is
   not a capture source, ASC, LIMIT 50, projected `{ at: occurredAt, granted,
   source, via: metadata.via, campaignId, channels }`.
4. All three attach inside `enrichJourneyProfile` (same admin gate as
   assignments/receipts); the consumer-less B4 path gets `events` on its
   signupProfile entitlements too (its anchor activities already tell the rest).

## FE (`AdminV2LeadProfile.jsx` buildHistory + tiles)

New rows, all with the campaign dot where a campaign is known:

- **Draw outcome** (family `outcome`, glyph `★`, ok colors; not-selected quiet
  generic): `Selected in the draw — attempt 2` at `outcome.drawnAt`;
  `selected_claimed` → additional `Prize claimed ✦`-style row at `claimedAt`;
  `selected_unclaimed/unreachable/ineligible/declined` → `Selection lapsed —
  unclaimed` etc.; `not_selected_final` → `Not selected in the draw` (quiet).
  Missing `drawnAt` (old data) → skip the row rather than invent a time.
- **Session undo** → `Draw boost undone${reason ? ` — ${reason}` : ''}` (family
  `unassignment` colors/glyph `←`).
- **Voucher lifecycle** → `Opened their voucher page` (first view, quiet,
  family delivery), `Voucher scanned at merchant` per non-draw verify_attempt
  (quiet), `Voucher expired` / `Voucher cancelled — <reason>` /
  `Redemption voided — <staff>` (family reward, bad tone for voided).
- **Staff resends** → `Voucher resent by <staff> — WhatsApp` /
  `Boost receipt resent by <staff>` / `Share link issued by <staff>`
  (family delivery; `auto_resend` → `Voucher resend retried automatically`).
- **Consent** (new family `consent`, glyph `✋`, hold colors):
  `Marketing consent withdrawn — WhatsApp STOP` / `— unsubscribe link`;
  `Marketing consent re-granted — <source>`; `Erased under PDPA — personal
  data removed` at `erasedAt` (family `unassignment` bad tone).

Dedupe guards: the existing `Voucher redeemed ✓` row stays the only redeemed
row; draw verify_attempts excluded (boost row covers them); `claim_viewed`
first-only; anchor raw activities untouched (none of these types are
prospect_activities).

## Tests

- Backend: unit tests on the new projections with DI fakes (event classification,
  claim_viewed collapse, cancel-from-inventory rows, resend actor naming,
  consent filter incl. wa_stop via; drawnAt added to outcome).
- FE: fixture gains events/outcome/consentTimeline; assertions for one row of
  each family; existing suites stay green.

## v2 — Codex review deltas (2026-07-26, 21 findings)

Accepted and implemented:
- **Cancel source corrected** (finding 1): `cancelEntitlement` DOES write
  `manual_override {action:'cancelled', reason}` with the staff actor — the
  planned `reward_inventory_events` query was wrong (unindexed, actor-less)
  and is dropped.
- **`expired` = reservation expiry only** (2): the sweep touches `eligible`
  rows only. Ledger event labeled "Reservation expired"; issued-voucher expiry
  is DERIVED from `expiresAt` past + status issued (skipped for recorded draw
  sessions).
- **Bounding** (3): lifecycle fetch is newest-first LIMIT 200 re-sorted ASC;
  `claim_viewed` collapsed IN SQL (MIN + COUNT per entitlement) so a
  refresh-happy customer can never starve the cap.
- **Consent predicate** (4/5/6): `kind:'contact'` + source allowlist —
  withdrawals `source:'unsubscribe'` (metadata.via = wa_stop/unsubscribe_link),
  re-grants `source:'resubscribe'` only. Capture denials, backfill rows and
  erasure's own false event stay off (erasedAt carries that row). Documented
  non-row: a capture-to-capture re-grant without an intervening suppression.
  Fetch DESC with the canonical `occurredAt, createdAt, id` tie-break, reversed.
- **`outcomeAt`** (7): selection timestamps at `drawnAt`; claims/lapses at
  `claimedAt || attempt.updatedAt`; `not_selected_final` at the winning
  attempt's `claimedAt`. Rows are skipped, never invented, when a timestamp
  is absent.
- **Draw-scan classification by `drawLinked`** (8): the entitlement's derived
  flag decides the noun ("Pass scanned by consultant" vs "Voucher scanned at
  merchant") — event metadata is fail-open on the writer side. Rejected scans
  render too (15).
- **Neutral first-open copy** (9): "Opened their reward link — ×N views".
- **B4 path** (10): buildHistory's entitlement loop falls back to
  `signupProfile.entitlements` — lifecycle AND delivery rows now render for
  consumer-less leads.
- **Row tone** (12): explicit `tone:'bad'` (void, cancel, lapse, withdrawal,
  erasure) — `--bad` colored text, new `outcome` (★) and `consent` (✋) tiles.
- **"Resend initiated"** (13): the audit row commits before the fire-and-forget
  send; receipts carry the outcome. `auto_resend` voiced as system activity (21).
- **Reason allowlist** (14): only `unlock_reversed` and `cancelled` surface
  `metadata.reason` (truncated 120); erasure's scrub of metadata.reason
  degrades erased rows to the bare fact automatically.
- **Honest cap** (17): header flips to "LATEST 120 OF N EVENTS" when truncated.
- **Isolation** (18): both new projections `.catch` to empty shapes — a
  projection failure can never null the profile.

Deferred, documented: cross-draw-cycle history (older draws are reduced
projections — finding 16); `contactedAt` timeline row; DB-integration tests
for limit starvation/erasure assertions (CI-side follow-up — finding 19);
pre-existing unbounded journey inputs (11 — predates this work).

## Risks / notes

- Everything is additive projection; no writer changes, so no behavioral risk
  to capture/fulfilment paths.
- Volume: LIMITs on every query; claim_viewed collapsed; History already caps
  at 120 rows rendered.
- `outcome.drawnAt` is the only cross-service touch (luckyDrawService) —
  additive field, draw suites must stay green.
