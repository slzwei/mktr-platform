# Physical voucher handover — consultant-funded, consultant-administered

**Status:** PLAN, not yet implemented. For review before build.
**Repo:** mktr-platform, branch off `main` @ 9632761.

## 1. The business reality (this is the constraint, not a preference)

Some campaign rewards are **physical vouchers** (e.g. "Redeem $10 Fairprice
Voucher"). The consultant **buys the vouchers with their own money** and
administers them entirely — MKTR never holds stock, never funds them, never
sees a serial number. At the meeting the consultant simply hands the lead a
paper voucher.

Therefore MKTR needs to record exactly ONE fact: *this lead was promised a
reward, and a consultant confirmed handing it over.* That is the
promise-vs-delivery record (dispute handling, the campaign-promise audit, and
funnel truth). Anything more — serial capture, custody sub-ledgers, stock
assignment — was explicitly rejected as modelling inventory MKTR does not own.

## 2. What exists today

`physical_voucher` is ALREADY a legal `fulfilmentMethod`
(`backend/src/services/redeemOps/rewardService.js:15`, and the column comment on
`backend/src/models/RewardOffer.js:47`). It is **inert**: nothing in the codebase
branches on `fulfilmentMethod`. Confirmed by grep — every hit is a Joi schema, a
service allowlist, or a display attribute passed to the claim page
(`backend/src/routes/rewardClaim.js:55`, `backend/src/routes/externalEntitlements.js:124`).

The `agent_unlock` lifecycle (`entitlementService.js:55-58`):

```
capture → eligible  (reservation; presentation-pass token + reservation email)
   ↓  consultant unlock at the meeting — scan or button (unlockEntitlement:449)
issued              (mints voucher token + expiresAt; queues voucher email/WA)
   ↓  PARTNER redeems the voucher token (redemptionService.complete:145)
redeemed
```

### The mismatch

For a physical voucher the consultant's handover IS the fulfilment. FairPrice
is not a partner and will never call `redemptionService.complete`. So:

1. **The entitlement parks at `issued` forever.** `expireReservations`
   (`entitlementService.js:852`) only sweeps `status: 'eligible'`, so it does
   not even age out. `redeemedQuantity` / `activations.redeemedCount` stay 0 and
   every redemption funnel reads 0% for these offers.
2. **The lead gets a misleading message.** Unlock mints a voucher token and
   `expiresAt` (`entitlementService.js:522-535`) and queues the voucher
   email/WA — a token and claim link for a voucher already in their hand.

Note the existing draw-rail carve-out at the same site: when `drawCtx` is set,
unlock deliberately mints NO token and leaves `expiresAt` untouched. **The
physical-voucher case wants the same "no token" shape but a different terminal
state**, so this is a second sibling branch, not a reuse of `drawCtx`.

## 3. Proposed change

### 3.1 Handover is terminal

In `unlockEntitlement`, when the offer's `fulfilmentMethod === 'physical_voucher'`
(and no `drawCtx`):

- Do NOT mint a voucher token, `tokenHint`, or a redemption `expiresAt`.
- Transition `eligible → redeemed` **in the same transaction** as the unlock,
  keeping the existing conditional-transition predicate (status + expiry +
  activation-still-active) so the TOCTOU and replay guarantees are unchanged.
- Write a `Redemption` row with `method: 'agent_handover'`, `actorType: 'agent'`,
  `actorUserId: agentUser.id`, `locationId: null`.
- Queue a plain handover receipt instead of the voucher email — no token, no
  claim URL.

**Inventory (CORRECTED — round 1 review, verified against current code).**
An earlier draft of this plan said the handover must record the issuance and
then the redemption in the same transaction. **That was wrong and would have
double-counted issuance.** Inventory is consumed at RESERVATION, not at unlock:
`issueForProspect` does `UPDATE activations SET "issuedCount" = "issuedCount" + 1`
plus `d.inventory.recordIssued(...)` at `entitlementService.js:330-347`, while
the entitlement is still `eligible`. `unlockEntitlement` performs ZERO inventory
or counter movement (verified: nothing in the transaction at
`entitlementService.js:519-563` touches inventory).

So at handover the implementation must record ONLY the redemption:
`inventory.recordRedeemed(...)` + `UPDATE activations SET "redeemedCount" =
"redeemedCount" + 1`. The `"issuedQuantity" - "redeemedQuantity" >= 1` guard
(`inventoryService.js:151-154`) is already satisfied by the reservation-time
issuance, and the `committed ≥ allocated ≥ issued ≥ redeemed` invariant holds.

### 3.2 Two field values

- `Redemption.method` gains `agent_handover`. Verified in prod: there are **zero
  CHECK constraints** on `redemptions` and `reward_offers`, and `method` is a
  plain `STRING(24)` whose allowed set lives only in a column comment
  (`models/Redemption.js:23`). So this is additive and free.
- `RewardOffer.fundingSource` gains `agent` (today `partner|mktr|shared`,
  `models/RewardOffer.js:31`). Without it, consultant-funded spend is reported
  as MKTR's or a partner's.

### 3.3 The partner placeholder

`RewardOffer.partnerOrganisationId` is `allowNull: false`, but there is no
partner. Recommendation: ONE reusable placeholder org ("Consultant-funded (no
partner)") for all self-funded rewards.

Explicitly rejected: creating "NTUC FairPrice" as a real `PartnerOrganisation`.
Redeem Ops would surface it as a managed partner with stages, tasks, cadences
and assignment queues it must not have.

### 3.4 Quota

`allocatedQuantity` is set nominally high and ignored. MKTR is not rationing
something the consultant buys. (The allocation gate in `issueForProspect` still
runs; it just never binds.)

### 3.5 Delivery plumbing the handover receipt needs (round 1 review)

A handover receipt is a THIRD delivery kind and the engine does not know it:

- `queueDelivery` routes on kind at `entitlementService.js:205` and again in the
  reconciler at `:964` — `kind === 'voucher' ? notifyUnlock : kind ===
  'boost_receipt' ? notifyBoostReceipt : notifyReservation`. Anything unknown
  falls through to the RESERVATION sender, so a handover receipt would silently
  send the "here is your pass" email and log as a pass.
- `reconcileMissedDeliveries` (`entitlementService.js:946`) sweeps only
  `status: ['eligible','issued']`. A terminal `redeemed` handover whose receipt
  failed would NEVER be retried. Either widen that sweep for this case or accept
  (and document) that handover receipts are best-effort.
- Consultant-facing copy hard-codes the voucher story and would lie:
  `lyfeEntitlementUnlock.js:98-99` ("the customer has been emailed their
  voucher" / "share the customer's pass link"), `externalEntitlements.js:266`,
  and `RedemptionsPage.jsx:205-206` ("email with QR sent to the customer").

### 3.6 Status readers that must be checked

Collapsing to `redeemed` changes what these see. Reviewed, and believed correct
as-is — but the implementation must confirm each:

- `cancelEntitlement:820` and `cancelLiveEntitlementsForProspectTx:1166` accept
  only `['eligible','issued']`. A handed-over voucher becomes uncancellable —
  which is RIGHT (you cannot un-hand-over a physical voucher), and matches how a
  real redemption already behaves.
- `erasureService.js:466` treats `['eligible','issued']` as live and cancels
  them; a `redeemed` row is redacted but not cancelled — also correct.
- `externalEntitlements.js:203-213` falls back to the latest terminal row when
  no live one exists, so the consultant card still shows it. No break.
- `entitlementPresentState.js:14` / `rewardClaim.js:135` change the displayed
  state from "unlocked" to "redeemed" — intended.

## 4. Deliberately NOT in scope

- **Serial capture at handover.** MKTR does not administer the vouchers.
- **Per-consultant custody / stock assignment.** The inventory ledger has no
  custodian dimension (`RewardInventoryEvent` has no `agentId`) and is not
  gaining one.
- **Creating the Fairprice activation itself.** That is the moment this goes
  live to 100 real leads and stays a human decision.

## 4b. Round-2 review findings (Codex gpt-5.6-sol xhigh; each re-verified by hand)

**BLOCKER — the button path's replay breaks.** `unlockEntitlement`'s
`prospectId` lookup filters `status: ['eligible','issued']`
(`entitlementService.js:457`). Once a physical handover is `redeemed`, a retry
finds nothing and throws 404 at `:461` — *before* the `['issued','redeemed']`
replay carve-out at `:476`. A consultant double-tapping "handed over" gets
"Entitlement not found". (The SCAN path is unaffected: it looks up by
`presentationTokenHash` with no status filter, so it reaches the carve-out.)
Fix: keep the live-first query, then fall back to the latest REDEEMED physical
handover. Do not just add `redeemed` to the first query — that could mask a
newer live entitlement.

**HIGH — readers §3.6 missed.**
- `resendDelivery` maps kind as `eligible→pass : issued→voucher : null`, then
  throws 409 on null (`entitlementService.js:700-702`) — a handover receipt can
  never be resent.
- Console `canShare` suppresses resend for redeemed (`RedemptionsPage.jsx:390`),
  and `deliveryStatus` shows nothing when a redeemed row has no receipt
  (`RedemptionsPage.jsx:90-91`).
- **The CAPI sweep already selects `status: 'redeemed'`**
  (`redemptionOutcomeService.js:180-186`). So handovers get CAPI'd whether or
  not we fire it inline — this path is NOT CAPI-free, and the choice is only
  *when*, not *whether*.

**HIGH — forbid `physical_voucher` + `unlockPolicy: 'on_capture'`.** That combo
mints a voucher token and sends voucher delivery at capture
(`entitlementService.js:309-327`, `:367-390`), bypassing handover entirely. Add
activation validation requiring `agent_unlock` for physical offers.

**HIGH — mis-tap correction is undefined.** Void marks the redemption reversed
and cancels the entitlement but does NOT decrement `redeemedQuantity`,
`redeemedCount`, or issuance (`redemptionService.js:255-276`). A mis-tapped
handover would leave funnel truth inflated. Needs a reason-gated correction that
reverses both redemption and reservation accounting in one transaction.

**MEDIUM — completeness.** The handover `Redemption` must supply the NOT NULL
`rewardOfferId`, `activationId`, `partnerOrganisationId`
(`models/Redemption.js:18-20`) — which is precisely why the placeholder partner
org in §3.3 is mandatory, not cosmetic. `fundingSource` must also be added to
the Joi allowlist (`controllers/redeemOps/rewardsController.js:22`), and the new
receipt kind to the console noun map (`RedemptionsPage.jsx:43`).

### Verdict
Core `eligible → redeemed` design is sound; **not safe to implement until the
blocker and the four HIGH items are addressed.**

## 5. Questions for the reviewer — ANSWERED (round 2)

1. **Direct `eligible → redeemed` inside `unlockEntitlement`.** Do not call
   `redemptionService.complete()` — it requires `issued` (`:184`). Extract a
   shared transaction-level accounting helper and call it inside the unlock
   transaction after the conditional update.
2. **Yes, fire CAPI** — and deliberately, since the sweep will fire it anyway.
   Dispatch post-commit and on redeemed replay; the deterministic event ID makes
   it idempotent (`redemptionOutcomeService.js:132-145`).
3. **Yes, via reason-gated Void — not draw undo.** Draw undo is a
   restoration-free `issued → eligible` (`entitlementService.js:589-630`), which
   is the wrong shape here.
4. **Reuse the existing offer read** at `entitlementService.js:514`; it already
   loads `fulfilmentMethod`. Evaluate the physical branch only when `!drawCtx`,
   preserving draw priority.
5. **`Redemption.method`,** not a new `RedemptionEvent.type`. Keep the event
   `redeemed` with `{method, locationId}` metadata
   (`redemptionService.js:231-234`); a new type fragments redemption reporting.

## 6. Original questions (superseded by §5 above)

1. Is collapsing `eligible → redeemed` inside `unlockEntitlement` the right
   seam, or should the physical path call `redemptionService.complete`
   internally to reuse its accounting? (`complete` requires `status === 'issued'`
   at `redemptionService.js:184`, so reuse implies a two-step commit or a new
   entry point.)
2. `redemptionService.complete` fires a Meta CAPI conversion (`fireCapi()`).
   The proposed in-`unlockEntitlement` path would bypass it. Should a handover
   fire the same down-funnel event? It is a real conversion.
3. `undoSessionUnlock` exists for draw rails. Does a mis-tapped handover need an
   undo, given it now writes a terminal `redeemed` + a `Redemption` row?
4. Does branching on `fulfilmentMethod` inside `unlockEntitlement` require an
   extra `RewardOffer` read, or can it ride the existing
   `d.RewardOffer.findByPk(entitlement.rewardOfferId)` at
   `entitlementService.js:514`?
5. Is `agent_handover` better modelled as a `Redemption.method`, or as a
   distinct `RedemptionEvent.type`, given `writeEvent(..., type: 'redeemed')`
   already carries `metadata: { method, locationId }`?
