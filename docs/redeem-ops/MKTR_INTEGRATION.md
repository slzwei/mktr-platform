# Redeem Ops ↔ MKTR Integration

> Phase 0 deliverable. Defines the ONLY sanctioned touchpoints between the Redeem Ops module and
> the canonical MKTR acquisition domains. Everything else is out of bounds (see
> `RECOMMENDED_ARCHITECTURE.md` §10).

## 1. Campaign integration

### Canonical model & ID

- Model: `backend/src/models/Campaign.js` → table `campaigns`, PK `id` (UUID v4). This UUID is the
  **only** campaign reference Redeem Ops stores (`activations.campaignId`).
- Status source of truth: `campaigns.status` (`draft|active|paused|completed|archived`) +
  `is_active` — displayed read-only in Redeem Ops; changed only via MKTR
  (`setCampaignLaunchState`, `backend/src/services/campaignService.js:311`).

### How Redeem Ops searches campaigns (link picker)

New read-only projection endpoint inside the Redeem Ops namespace (so host-guard + capability
gating applies, and MKTR's `/api/campaigns` admin surface stays untouched):

```
GET /api/redeem-ops/campaigns?search=&status=&page=&limit=
→ { campaigns: [{ id, name, status, type, isActive, customerHost, publicUrl,
                  createdAt, linkedActivationId | null }], pagination }
```

Implementation: `services/redeemOps/campaignProjection.js` queries the `Campaign` model directly
with a **fixed attribute allowlist** (`id,name,status,type,is_active,design_config→customerHost,
createdAt`) — never returns `design_config` wholesale (it contains builder internals). `publicUrl`
is computed with the existing host helpers (`resolveCustomerHost` semantics; backend equivalent in
`backend/src/utils/customerHost.js:customerHostOrigin`) → `…/LeadCapture?campaign_id={id}`.
`linkedActivationId` is a LEFT JOIN on `activations` (status ∈ preparing/active/paused) so the
picker can show "already linked".

### How a campaign is linked / unlinked

- `POST /api/redeem-ops/activations` and `PATCH …/:id/campaign` set `campaignId` after validating:
  campaign exists; not `archived`; not already linked to another live activation (**partial unique
  index** `activations(campaignId) WHERE status IN ('preparing','active','paused')` — DB-enforced,
  not just app-checked). A `campaignNameSnapshot` is stored for display resilience
  (`SET NULL` FK — see `ERD.md`).
- Link/unlink writes `redeem_ops_audit_events` (`action: activation.campaign_linked`).

### Campaign display, metrics, and hand-off

- Read-only detail card on the Activation page: name, status badge, type, public URL
  (copyable), customer host.
- Metrics: reuse `computeCampaignMetrics(campaignId)`
  (`backend/src/services/campaignService.js:12`) and, where needed, the analytics aggregation
  (`getCampaignAnalytics`, line 456) — surfaced via
  `GET /api/redeem-ops/activations/:id/campaign-metrics`. **No re-counting in Redeem Ops**;
  registrations/verified-lead numbers always come from these MKTR functions.
- "Open in MKTR" deep link: `https://mktr.sg/admin/campaigns/{id}/workspace` (route exists in
  `src/pages/index.jsx`). Redeem Ops renders it as an external link; campaign editing never
  happens on the ops surface.

### What is forbidden

Redeem Ops must never: create/update/archive campaigns, mutate `design_config`, generate QR/short
links, or touch delivery-pool/lead-package state. (Enforced by code review + the absence of any
write path in `campaignProjection.js`.)

## 2. Lead integration

### Canonical model & ID

Model `backend/src/models/Prospect.js` → table `prospects`, PK `id` (UUID). Redeem Ops stores this
UUID **only** on `reward_entitlements.prospectId`.

### Minimum data Redeem Ops needs (and how it gets it)

| Need | Mechanism | Notes |
|---|---|---|
| Entitlement identity | `prospectId` FK (`ON DELETE SET NULL`) | Prospect bulk-delete exists (`prospectService` bulk ops) — entitlement rows survive with PII gone. |
| Staff display (fulfilment screens) | Server-side JOIN at read time → `{ firstName, lastName, phoneMasked }` | Full phone visible only under the `redemptions.verify` capability (needed to confirm identity at fulfilment); nothing persisted in Redeem Ops tables. |
| Eligibility inputs (Phase 6) | Read `prospect.campaignId`, `quarantinedAt`, `dncStatus`, consent flags at issuance time | Rules in `entitlementService`; consent interpretation mirrors `externalConsent.js` precedent. |

**No projection/copy tables.** Same-database joins make read-time access cheap and keep exactly one
PII location (privacy §35.8: no unnecessary personal-data duplication; PDPA erasure on `prospects`
automatically propagates because nothing is copied).

### How entitlement creation is triggered (Phase 6 design)

Chosen mechanism: **in-process post-commit hook + reconciliation sweep** (at-least-once with a
DB idempotency anchor). Rationale: same process, no broker, matches how CAPI/TikTok/webhooks
already hang off capture (`prospectService.js` post-commit block, ~lines 843–930; note the
assignment/confirmation *emails* are controller-level, `prospectController.js:58-72` — the hook
follows the service-level precedent, not the email one).

0. **Server-verified prospect precondition (anti-farming — Codex review finding, accepted)**:
   `POST /api/prospects` is public and OTP is SPA-orchestrated; the API accepts unverified
   submissions (`REPOSITORY_DISCOVERY.md` §9). `lead.created` alone is therefore a **forgeable
   signal that must never mint reward value**. Fix: at capture, the backend stamps durable
   verification evidence onto the prospect — `sourceMetadata.phoneVerifiedAt`, set server-side iff
   `verifiedPhoneStore.isPhoneVerified(phone)` at create time (the same short-lived marker the DNC
   consent gate already consumes, stamped by `verificationService.checkVerificationCode`,
   `verificationService.js:228-233`). This stamp ships in the same DI-seam change as the hook.
   Both the hook and the sweep issue entitlements **only** for prospects carrying the stamp.
   Unverified/forged submissions still capture as leads (capture behaviour unchanged); they simply
   never earn an entitlement — closing both the fake-reward vector and the
   inventory-exhaustion-DoS vector.
1. **Hook**: at the end of `createProspect`'s post-commit fan-out, one guarded call:
   `redeemOpsEntitlements.onLeadCaptured(prospect)` — flag-gated (`REDEEM_OPS_ENABLED` +
   `REDEEM_OPS_ENTITLEMENTS_ENABLED`), wrapped in try/catch, **fire-and-forget** (a Redeem Ops
   failure must never fail or slow lead capture). It checks: verification stamp present (§0),
   prospect not quarantined, DNC not blocking, campaign has an `active` activation with remaining
   allocation → creates the entitlement per the activation's `unlockPolicy`: `on_capture` →
   voucher live immediately; `agent_unlock` (**the default** for review-gated funnels) → a
   **locked reservation** (`status='eligible'`: inventory held, reservation-pass QR delivered to
   the consumer, no voucher token exists yet).
2. **Idempotency anchor**: partial unique index `reward_entitlements(activationId, prospectId)
   WHERE prospectId IS NOT NULL` — the hook and the sweep can both fire; exactly one row wins
   (house pattern: unique-constraint-as-dedup, cf. `retellCallId`; partial because deleted
   prospects SET-NULL and Postgres treats NULLs as distinct — see `ERD.md` §3.16).
3. **Reconciliation sweep**: in-process interval (bootstrap pattern) selecting recent prospects on
   activation-linked campaigns lacking an entitlement — catches hook failures, deploy gaps, and
   quarantine→release transitions. Also expires entitlements past `expiresAt`.
4. **Inventory coupling**: issuance decrements activation allocation via the guarded-counter +
   ledger transaction (`ERD.md` §Integrity); when allocation is exhausted the hook stops issuing
   (leads still capture normally — reward exhaustion must never block acquisition).

Rejected alternatives: registering Redeem Ops as a `WebhookSubscriber` pointed at our own API
(adds HMAC/HTTP/retry surface for an in-process call — the webhook engine exists for *external*
destinations); DB triggers (invisible to the codebase, against house style); queues (no broker
infra, explicitly discouraged).

### How the voucher unlocks at the physical meeting (agent-mediated, `unlockPolicy='agent_unlock'`)

The business rule: the consumer must complete the financial review with their consultant before
the reward becomes redeemable. The unlock is therefore an **explicit action by the lead's assigned
consultant during the meeting**, with two equivalent paths:

- **Scan (preferred — proves presence)**: the client opens their reservation link
  (`/r/:presentationToken`, delivered at signup) which shows a QR of the reservation-pass token;
  the consultant scans it in their app. Possession of the client's QR + an authenticated
  consultant is strong evidence the meeting actually happened.
- **Button (fallback)**: the consultant opens the lead in their app and taps "Unlock voucher"
  (client's phone dead, email lost, etc.). Same server checks, minus the presence proof — audited
  with `unlockedVia='agent_button'`.

**Where the endpoints live**: consultants are NOT Redeem Ops staff and their apps are external
(Lyfe mobile app; mktr-leads app), so the unlock does not go through `/api/redeem-ops/*`. It rides
the two authenticated server-to-server surfaces that already exist and are rate-limit-exempt:
`POST /api/external/entitlements/unlock` (mktr-leads app — `requireExternalHmac` precedent, cf.
`externalBillingController`) and `POST /api/integrations/lyfe/entitlement-unlock` (Lyfe app —
lead-outcome HMAC precedent). Payload: presentation token (scan) or prospect id (button) + the
acting agent reference; the backend resolves the agent through the existing provenance mapping
(`users.mktrLeadsId` / `users.lyfeId`).

**Server-side checks (single conditional-UPDATE state transition, idempotent)**: entitlement is
`eligible` and unexpired; the acting agent **is the lead's assigned consultant**
(`prospect.assignedAgentId` / `externalAgentId`; admin override audited); activation still live.
On success: status → `issued`, voucher token minted, `expiresAt` re-stamped to the redemption
window, ledger + `redemption_events('unlocked')` written, and the consumer is notified
immediately (SMS via the existing SNS sender + brand-aware email via `mailer.js`). The voucher
email carries the code in **three redundant forms**: (a) the voucher **QR as an inline-attached
PNG** (CID attachment, not a remote image URL — displays even when mail clients block remote
images, and keeps the token out of image-proxy/CDN logs; generated with the `qrcode` dependency
already used by `qrCodeService.js`), (b) the **short code as plain text** for manual entry when
scanning fails, and (c) the **live `/r/…` link**, which now renders the voucher. The email is a
static snapshot — it can never show "already redeemed" — which is fine because a QR is only a
picture of the token: the merchant-side verify call is the actual gate, so unlimited copies
(email, screenshot, printout) change nothing; the first server-confirmed redemption wins. A
replayed scan returns "already unlocked" (success shape), and salon verify rejects
reservation-pass tokens with a typed error, so the meeting QR can never be redeemed at the
partner.

**No-show handling**: if the reservation expires before any unlock, the sweep marks it `expired`
and returns the unit to the activation pool (ledger event) — no-shows never consume partner supply.

### The one MKTR-side code change (and how it respects the one-way rule)

Phase 6 makes exactly one edit to MKTR code (`prospectService.js`), with two parts: (a) stamp
`sourceMetadata.phoneVerifiedAt` when the verified-phone marker is present at create (§0), and
(b) invoke an injected `onLeadCaptured` callback post-commit. The one-way rule
(`RECOMMENDED_ARCHITECTURE.md` §1) is an **import/module rule, not a runtime-call rule**: MKTR
never imports Redeem Ops code — `makeProspectService` already takes injected collaborators
(`prospectService.js:107-121`), so the callback default is a no-op and bootstrap (the composition
root) injects the real Redeem Ops implementation. This is ordinary dependency inversion: the seam
stays extractable (delete the bootstrap wiring and MKTR is byte-identical to today).

## 3. Identity/user integration

- Staff: shared `users` table; new enum value + `redeemOpsRole` column (see
  `PERMISSION_MATRIX.md`). Redeem Ops reads `users` for assignee pickers (id, fullName, role,
  redeemOpsRole, isActive) — no writes outside invite/role-grant endpoints.
- Guardrail (verified): agent-sync sweeps operate on `role='agent'` rows with platform provenance
  (`agentSyncService.js:306,404,426-438`) — `redeem_ops` users are outside the sweep. A regression
  test pins this.

## 4. Consistency & privacy implications (summary)

- **Consistency**: FKs give hard integrity for campaign/lead references; the only eventual
  consistency introduced is entitlement issuance (hook + sweep), bounded by the sweep interval and
  made safe by the unique anchor. Inventory counters + append-only ledger reconcile exactly
  (transactional writes).
- **Privacy**: no PII copies; partner-facing projections exclude lead identity entirely
  (`entitlementService.partnerView()` contract); consent and DNC interpretation stay in MKTR
  semantics; masked-by-default display with capability-gated unmasking; every manual override
  audited.
- **Failure isolation**: Redeem Ops outage cannot break capture (hook is fire-and-forget), cannot
  break routing (no coupling), and flag-off returns the platform to today's behaviour byte-for-byte.
