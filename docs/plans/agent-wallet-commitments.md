# Agent wallet + per-campaign lead commitments (mktr-leads external agents)

**Date:** 2026-07-15 · **Status:** REVIEWED — Codex round 1 (gpt-5.6-sol
xhigh) findings verified against code and folded in below (see "Codex round 1
resolutions"). Supersedes ambiguities in the original draft where marked.
**Replaces:** admin-administered lead packages for EXTERNAL agents (drain-down,
no conversion). Internal Lyfe agents are explicitly out of scope (later phase).

## Product decisions (locked with Shawn, 2026-07-15)

1. **Wallet**: $1 = 1 credit (store cents; SGD). Top-ups non-refundable to
   cash, no expiry — credits can only become leads.
2. **Per-campaign lead price**: admin-set `leadPriceCents` on the campaign
   (server-clamped, admin-only — campaign PUT is open to agents).
3. **Commitment**: agent self-serves "N leads of campaign X @ price" — debits
   wallet instantly, no admin involvement. The commitment size is the spend
   bound; NO other caps.
4. **Delivery unchanged**: round-robin among open commitments, instant webhook
   push to the mktr-leads app. No browsable inventory.
5. **No self-cancel** of commitments. The ONLY refund path: campaign
   **archived or completed** → undelivered remainder auto-returns to wallet as
   credits. **Paused → delivery stops, commitment holds** (no refund).
6. **Migration = drain-down**: verified in prod 2026-07-15 — only 2 external
   agents / 5 active assignments / 156 leads remaining. Existing package
   assignments keep delivering through the same routing until exhausted; no
   balance conversion. Package SALES stop at cutover.
7. **v2 (not this build)**: uncovered-lead push loop — when a lead quarantines
   with `no_funded_agent`, notify all external agents "commit now"; first
   committer releases it.

## Ground truth (verified in code)

| Piece | Reality |
|---|---|
| Routing pool | `systemAgent.js:119` — assignments `status:'active', leadsRemaining>0` joined through `LeadPackage.campaignId`. Campaign scoping lives on the PACKAGE, not the assignment |
| Charging | `leadCredits.js` — `deductLeadCredit` / `deductExternalLeadBalance` decrement `leadsRemaining` |
| Held leads | quarantine with `heldReason:'no_funded_agent'` when no funded agent — unchanged |
| External auth | HMAC-SHA256 over raw body (`EXTERNAL_APP_SECRET`), POST-only endpoints under `/api/external/*`, rate-limiter exempt (server_internal.js) |
| Billing scaffold | `/api/external/billing` (flag `BILLING_ENABLED`, currently unmounted): `catalog/checkout/status/history/document` + `hitpay-webhook` (HitPay-signature-authed). `Payment` model records provider/amount/status; `hitpayClient.js` + unit tests exist |
| Delivery to app | `lead.created` webhook routed by destination (`prospectHelpers.js:42` — `agent.mktrLeadsId → 'mktr_leads'`); the app already pushes on arrival |
| Assignment model | `LeadPackageAssignment`: `status active/completed/cancelled/expired`, `leadsRemaining`, leads/price snapshots |

## Design

### Zero-routing-change trick
A commitment = a normal `LeadPackageAssignment` under an **auto-created hidden
wallet package** per campaign (`LeadPackage` row: `type:'custom'`,
`name:'Wallet commitments'`, `campaignId`, `isPublic:false`, `status:'active'`,
created lazily on first commit). Routing, charging, drain-down coexistence and
held-lead behaviour all work untouched. New columns mark and price the
commitment (below).

### Data model (migrations 068+, guarded/idempotent, camelCase DDL)
- `campaigns.leadPriceCents` INTEGER NULL — no price = campaign not
  commit-able by external agents (catalog hides it).
- `lead_package_assignments.source` STRING(16) NOT NULL DEFAULT `'package'`
  (`package|wallet`) + `unitPriceCents` INTEGER NULL (per-lead snapshot at
  commit time — refunds = `leadsRemaining × unitPriceCents`).
- New `wallet_ledger` (append-only): `id`, `agentId` (users FK),
  `type: topup|commit|takedown_refund|adjustment`, `amountCents` (signed),
  `balanceAfterCents`, refs (`paymentId`, `assignmentId`, `campaignId`
  nullable), `note`, `createdBy` (null = system), `createdAt`. Indexes on
  (agentId, createdAt).
- `users.walletBalanceCents` INTEGER NOT NULL DEFAULT 0 — maintained in the
  SAME transaction as every ledger insert (atomic increment with a
  `balance + amount >= 0` guard; ledger is the audit truth, column is the
  fast read). Mirror indexes on models (sync-clobber lesson).

### Backend service — `walletService.js`
- `credit(agentId, amountCents, {type, refs, tx})` / `debit(...)` — single
  place that writes ledger + balance atomically; debit fails (409
  `insufficient_balance`) rather than going negative.
- `commit(agentId, campaignId, quantity)`: validate campaign is **active +
  priced (`leadPriceCents` non-null)** — commit-ability is priced-only; it
  does NOT read or write `campaign.externalEligible`, which belongs to the
  inert ExternalAgent buyer-marketplace gate (see resolutions #1/#2); `total =
  quantity × leadPriceCents`; debit wallet; find-or-create the campaign's
  wallet package; create assignment (`source:'wallet'`, `unitPriceCents`,
  `leadsTotal/leadsRemaining = quantity`, `status:'active'`) — one
  transaction. **Concrete row shapes (required NOT NULLs verified):** wallet
  package = `{ name:'Wallet commitments', type:'custom', campaignId,
  isPublic:false, status:'active', currency:'SGD', price:0, leadCount:0,
  createdBy: system-agent id }`; assignment `priceSnapshot = total/100` (SGD
  dollars, model requires it) alongside `unitPriceCents`. **Race safety:**
  `findOrCreate` alone is racy — migration adds `lead_packages.kind`
  STRING(16) NOT NULL DEFAULT `'catalog'` (`catalog|wallet`) + a UNIQUE
  partial index `(campaignId) WHERE kind='wallet'`, and commit retries once
  on unique-violation.
- `refundCampaignCommitments(campaignId, {reason, tx})`: for each wallet-source
  assignment with `leadsRemaining > 0` and status active → credit
  `leadsRemaining × unitPriceCents` (`type:'takedown_refund'`), zero the
  remainder, set assignment `status:'completed'` + note. **Concurrency-safe
  idempotency, not just skip-completed:** runs INSIDE one transaction with the
  campaign row locked (`SELECT … FOR UPDATE`) and assignments locked; plus a
  UNIQUE partial index on `wallet_ledger (assignmentId) WHERE
  type='takedown_refund'` so a double-archive race cannot double-credit.
- Hook: `campaignService.archiveCampaign` becomes transactional (it currently
  updates status + detaches QR tags with NO transaction — verified
  campaignService.js:525–534): lock campaign → refund → set `archived` in one
  tx; QR-tag detach moves after commit. `status:'completed'` is unreachable
  in code today (enum-only); guard comment requires any future completed
  transition to route through the same function. **Pause does NOT refund**
  (decision 5). setCampaignLaunchState pause path untouched.

### Top-up (reuse the billing scaffold — with an explicit `Payment.kind` branch)
Verified constraints: `checkout` currently 400s without `packageId`
(externalBillingController.js:96), `Payment.leadCount` is NOT NULL, and
settlement either creates a package assignment or marks `paid_unfulfilled`
when the package is missing (billingService.js:379–392). So `wallet_topup`
cannot ride the existing shape untouched:
- Migration adds `payments.kind` STRING(24) NOT NULL DEFAULT
  `'package_purchase'` (`package_purchase|wallet_topup`), relaxes nothing on
  existing rows; top-up rows set `leadPackageId` null, `leadCount 0`,
  `packageName 'Wallet top-up'`, amount from a preset whitelist
  ($100/$500/$2000 → cents).
- `checkout` branches on `kind`: `wallet_topup` skips packageId validation,
  creates the HitPay request + Payment(kind wallet_topup).
- Settlement: the existing handler already locks the Payment row
  (`findOne … lock: t.LOCK.UPDATE`) and short-circuits on `status==='paid'` —
  the wallet credit happens INSIDE that same locked transaction, branching on
  `payment.kind` BEFORE the package-fulfillment path (so a top-up can never
  fall into `paid_unfulfilled`). Idempotency = the existing status check +
  paid short-circuit, **plus** a UNIQUE partial index on `wallet_ledger
  (paymentId) WHERE type='topup'` as defense in depth.
- Receipts via the existing `document` endpoint.

### New external endpoints (HMAC POST, one router `/api/external/wallet`,
flag `AGENT_WALLET_ENABLED`, default false)
- `/summary` — balance + open commitments (campaign, remaining, unit price)
- `/ledger` — paginated ledger entries
- `/catalog` — commit-able campaigns: name, `leadPriceCents`, blurb/dates
  (whitelisted fields only — external surface, no design_config dump)
- `/commit` — `{campaignId, quantity}` → walletService.commit; returns new
  summary. No cancel endpoint exists (decision: no self-cancel).

### mktr-leads app (SEPARATE repo — screens only; backend is all mktr-platform)
- Wallet screen: balance, ledger, top-up (HitPay via expo-linking, same
  pattern as the built Buy Leads flow — App-Store-safe external browser).
- Commit flow: catalog → quantity picker → confirm ("160 credits · no
  cancellation · refunded as credits only if the campaign is taken down") →
  success. Copy must state the no-cash-refund rule at BOTH top-up and commit.
- Lead push: unchanged (already live).
- Note: repo has no write creds server-side — Shawn deploys the app/OTA.

### Admin (mktr-platform)
- Campaign form/designer: `leadPriceCents` input (admin-only server clamp in
  campaignService, same policy pattern as marketplaceListed).
- Agents/packages admin: wallet balance + committed-demand column; per-
  campaign committed-undelivered total (this is the ad-spend demand signal —
  also feeds the dashboard-redesign "agent supply" view).
- Admin adjustment endpoint (admin-auth): manual ledger `adjustment` with
  required note — the escape hatch that keeps "no refunds" enforceable
  without DB surgery.

### Cutover / rollout
1. Ship dark (`AGENT_WALLET_ENABLED=false`; `BILLING_ENABLED` still gates
   HitPay). Migrations are inert.
2. Provision HitPay (already scoped for Buy Leads), flip `BILLING_ENABLED`,
   test a $1 top-up end-to-end (webhook → ledger → balance).
3. Flip `AGENT_WALLET_ENABLED`; OTA the app screens.
4. Stop package sales to external agents (catalog switch); existing 5
   assignments drain naturally.
5. Watch: first commit → first routed lead → wallet debit trail; takedown
   refund on a test campaign.

### Tests
- walletService: atomic debit/credit, insufficient-balance 409, negative
  guard, ledger/balance consistency, commit transaction (package find-or-
  create, assignment shape), refund idempotency + pause-does-nothing.
- hitpay settlement idempotency (double webhook = single credit).
- Routing regression: wallet-source assignments join the pool exactly like
  package ones (existing decideAssignment tests extended).
- External endpoints: HMAC required, flag-off unmounted, catalog hides
  unpriced campaigns.

### Wallet-account lifecycle policy (new — closes the paid-commitment eraser)
Verified hazards: `deactivateUser` DESTROYS all the user's package assignments
(userService.js:358), bulk permanent delete does the same + FK-cascades
(userService.js:446, migration 014), and the mktr-leads sync hard-deletes
inactive agents absent upstream when they have no PROSPECTS — without checking
assignments or ledger rows (agentSyncService.js:477). With real money these
paths erase paid commitments. Policy:
- `deactivateUser` / bulk-delete: **reject (409)** when the user has open
  wallet-source commitments (`source='wallet'`, remaining > 0) or
  `walletBalanceCents > 0` — admin must resolve the balance first (takedown
  or manual `adjustment` to zero, note required). Assignment destroy keeps
  skipping `source='wallet'` rows in all cases: wallet history is never
  deleted, terminal states only.
- Users with ANY wallet_ledger history are excluded from the sync's
  pending-deletion + hard-delete queries (`NOT IN (SELECT DISTINCT "agentId"
  FROM wallet_ledger)`), mirroring the existing prospects guard.
- No silent refund on deactivation/deletion — refunds happen ONLY on campaign
  takedown (product decision 5); everything else is a manual adjustment with
  a note.

### Codex round 1 resolutions (2026-07-15, all verified against code)

1. **"Consent bypass" finding — REJECTED as a new hazard, kept as a
   documented stance.** mktr-leads agents ARE `users` rows (mktrLeadsId) and
   route through the internal package pool TODAY by design (the 2026-06 pivot:
   external agents = second team; webhook destination derives from
   `mktrLeadsId` in prospectHelpers). Wallet commitments are the same class of
   assignment for the same users — no new path. Codex's proposed fix
   (exclude mktrLeadsId users from resolveLeadRouting) would BREAK live
   delivery for the draining package agents and the wallet itself. The
   separate consent-gated resolver (`resolveLeadAssignment` + `allowExternal`)
   guards the INERT ExternalAgent buyer pool, not mktr-leads users. Flag for
   Shawn (product, not this build): whether `consent_third_party` should gate
   delivery to mktr-leads agents is a policy question about the pivot-era
   stance, unchanged by wallets.
2. **ExternalAgent/ExternalCampaignAgent parallel pool — stays INERT and out
   of scope.** Wallet eligibility = `leadPriceCents` non-null ONLY; the plan
   no longer says "external-eligible" anywhere near commit-ability (that word
   collided with `campaign.externalEligible`, the buyer-pool flag). Admin
   wallet roster filters `users.mktrLeadsId IS NOT NULL`. Do not set
   `externalEligible` on campaigns as part of this build.
3. Hidden-package NOT NULLs + race → concrete row shape, `lead_packages.kind`
   column + unique partial index (folded into `commit` above).
4. Payment/settlement fit → `payments.kind` branch inside the existing locked
   settlement transaction + unique topup ledger index (folded into Top-up).
5. Archive refund atomicity → transactional archiveCampaign + per-assignment
   unique takedown_refund index (folded into refund section).
6. User-lifecycle eraser → lifecycle policy section above.
7. WalletLedger model parity: register a `WalletLedger` model with
   `timestamps:false` + explicit `createdAt` (global Sequelize config defaults
   BOTH timestamps on; migration 070 has no updatedAt) and mirror ALL new
   columns/indexes on models (Campaign.leadPriceCents, User.walletBalanceCents,
   assignment source/unitPriceCents, package kind, every unique partial) so
   test `sync({force:true})` reproduces prod constraints.
8. `leadPriceCents` reaches the DB: add to `schemas.campaignCreate/Update`
   Joi (nullable positive int) AND to campaignService create/update persisted
   fields, with the admin-only clamp on both paths (verified: current schemas
   reject/strip it and the service ignores it).

### Codex round 2 — post-implementation review (2026-07-15, PR #159)

Reviewed the built diff at commit 184f339; verdict "do not merge yet" on
3 BLOCKERs / 4 MAJORs. All verified against code and FIXED in the follow-up
commit, except one accepted risk (below):

1. **Model validation rejected both entry paths** (LeadPackage.leadCount +
   Payment.leadCount had `min:1`; wallet rows carry 0 — my DI-mocked unit
   tests bypassed model validation entirely, which is why they were green).
   → kind-aware validators on both models.
2. **Soft-quota overdelivery**: priced campaigns on the default
   `enforceLeadQuota:false` path could deliver free leads on a failed/raced
   charge. → `leadQuota.decideAssignment` now treats **priced (leadPriceCents
   set) as always-enforced** — a pre-sold lead is never delivered free;
   the existing SKIP-LOCKED concurrency guarantee now covers wallet
   campaigns. Integration tests added (priced+soft+unfunded → held;
   priced+soft+funded → delivered + charged).
3. **Legacy package-admin paths could mutate paid commitments**
   (topUp/cancel/remove/delete/updateAssignment; updatePackage/deletePackage
   on the hidden container; catalogs listing it). → `rejectWalletAssignment`
   / `rejectWalletPackage` fences on all six mutation paths; wallet
   containers excluded from listPackages + getExternalAdminCatalog (the buy
   catalog already excluded them via price>0 + isPublic).
4. **duplicateCampaign spread leadPriceCents** — a non-admin could mint a
   priced campaign by duplicating a public one. → duplicates always start
   with `leadPriceCents: null`.
5. **Refund skipped malformed rows**, stranding an open commitment on an
   archived campaign. → refund now ABORTS the archive (500) on a wallet
   assignment without a positive unitPriceCents; DB CHECK
   `chk_lpa_wallet_unit_price` added in 069 + model validator.
6. **Lifecycle races**: deactivation guard now runs INSIDE the transaction
   under a user row lock, and `commit()` revalidates the agent (active +
   mktrLeadsId) under `FOR UPDATE` — commit and deactivate serialize.
   **Accepted risk (documented, not fixed):** `toggleUserStatus`/`updateUser`
   can still flip `isActive` without the wallet guard — but they destroy
   NOTHING; the commitment simply pauses with the agent and resumes on
   reactivation. Money cannot be lost through those paths.
7. **No idempotency on commit/adjust** — a broker retry after a lost
   response double-debited. → `withIdempotency` over the house
   IdempotencyKey table (key = `wallet:commit:{agentId}:{requestId}`,
   PK-collision aborts the duplicate transaction atomically, response stored
   in the same tx). `requestId` is REQUIRED on `/commit`, optional on admin
   adjust. 24h TTL.
8. Payment model now mirrors migration 040's three unique partial indexes
   (test `sync({force:true})` parity).

### Non-goals
- Internal (Lyfe) agents — later migration, same rails.
- Uncovered-lead "commit now" push loop (v2).
- Self-cancel of commitments; cash refunds; credit expiry.
- Browsable lead inventory (rejected — freshness/coverage).
- Activating the ExternalAgent buyer pool / `externalEligible` semantics.
