# Redeem Ops — Recommended Architecture

> Phase 0 deliverable. This is the blueprint for the accepted option (Option A in
> `ARCHITECTURE_OPTIONS.md`): Redeem Ops as a namespaced module of the existing monolith, exposed
> as its own internal surface (target: `ops.redeem.sg`). Companion docs: `MKTR_INTEGRATION.md`
> (campaign/lead touchpoints), `ERD.md` (schema), `PERMISSION_MATRIX.md` (authz),
> `ROUTE_MAP.md` (surfaces), `USER_SURFACES_AND_DEPLOYMENT_BOUNDARIES.md` (who sees what, where),
> `IMPLEMENTATION_PLAN.md` (sequencing).

## 1. Shape of the system

```text
                 ┌────────────────────────────────────────────────────────────┐
                 │                 mktr-backend (api.mktr.sg)                 │
                 │                                                            │
   mktr.sg ────▶ │  /api/auth, /api/campaigns, /api/prospects, /api/admin, …  │
 (operators)     │                        │ (unchanged)                       │
                 │                        ▼                                   │
 ops.redeem.sg ▶ │  /api/redeem-ops/*  ──▶ services/redeemOps/* ──▶ new       │
 (Redeem staff)  │  (flag: REDEEM_OPS_ENABLED)         │           tables     │
                 │                                     │ one-way deps         │
                 │                 reads Campaign/Prospect/User via FK &      │
                 │                 existing services (never writes them)      │
                 │                                                            │
 redeem.sg ────▶ │  /api/prospects, /api/verify, /t/:slug   (unchanged)       │
 (consumers)     │  future: /api/redeem-ops/fulfilment/claim (Phase 6)        │
                 └────────────────────────────────────────────────────────────┘
                                    one PostgreSQL (Render)
```

One backend, one database, one SPA codebase. Redeem Ops is a **module with a hard one-way import
rule**: `redeemOps` code may import MKTR models/services (FKs, read-only calls); **no MKTR file
may import from `redeemOps/`**. The rule governs module imports, not runtime calls — the single
sanctioned reverse-direction touchpoint (the Phase 6 capture hook) is dependency-inverted:
`makeProspectService` already takes injected collaborators, so bootstrap (the composition root)
injects the entitlement callback and lead capture calls an injected function whose default is a
no-op (see `MKTR_INTEGRATION.md` §2). That rule is the future extraction seam: remove the
bootstrap wiring and MKTR is byte-identical to today.

## 2. Backend module layout

Constraints from the auto-loaders (`routes/index.js`, `models/index.js` read only their own
top-level directory) dictate flat placement for routes and models; everything else nests.

```text
backend/src/
├── routes/                      # FLAT (auto-loader) — all export meta.flag REDEEM_OPS_ENABLED
│   ├── redeemOpsPartners.js     #   /api/redeem-ops/partners (+contacts/locations/claim/stages/activities nested)
│   ├── redeemOpsWork.js         #   /api/redeem-ops/tasks, /queue, /pools
│   ├── redeemOpsRewards.js      #   /api/redeem-ops/rewards (+terms, inventory)
│   ├── redeemOpsActivations.js  #   /api/redeem-ops/activations (+campaign search projection)
│   ├── redeemOpsFulfilment.js   #   /api/redeem-ops/entitlements, /redemptions
│   └── redeemOpsAdmin.js        #   /api/redeem-ops/team, /audit, /settings
├── controllers/redeemOps/       # nested (imported by routes, not auto-discovered)
├── services/redeemOps/          # nested; DI-factory pattern (`makePartnerService(overrides)`)
│   ├── permissions.js           #   ROLE_CAPABILITIES map (single source of truth)
│   ├── auditService.js          #   append-only writer for redeem_ops_audit_events
│   ├── partnerService.js, dedupeService.js, claimService.js, taskService.js,
│   │   poolService.js, onboardingService.js, rewardService.js, inventoryService.js,
│   │   activationService.js, entitlementService.js, redemptionService.js,
│   │   campaignProjection.js    #   the ONLY file that reads MKTR campaign internals
│   └── normalizers.js           #   business-name/domain/social/postal normalization
├── middleware/redeemOpsAuth.js  # requireRedeemOps(...caps) — see PERMISSION_MATRIX.md
└── models/                      # FLAT (auto-loader) — PartnerOrganisation.js, PartnerLocation.js,
                                 # PartnerContact.js, PartnerAssignmentEvent.js, PartnerStageEvent.js,
                                 # OutreachActivity.js, OutreachTask.js, ProspectingPool.js,
                                 # ProspectingPoolMember.js, PartnerOnboardingItem.js, RewardOffer.js,
                                 # RewardTermsVersion.js, RewardInventoryEvent.js, Activation.js,
                                 # RewardEntitlement.js, Redemption.js, RedemptionEvent.js,
                                 # RedeemOpsAuditEvent.js
```

Association wiring goes in `models/index.js` alongside the existing explicit block, grouped under a
`// Redeem Ops` banner, with the same deliberate `onDelete` discipline (see `ERD.md`).

**Dark launch**: every route file exports
`meta = { path: '/api/redeem-ops/…', flag: 'REDEEM_OPS_ENABLED', flagDefault: 'false' }` — the
namespace does not exist in production until the env var flips (house precedent:
`BILLING_ENABLED` on `routes/externalBilling.js`).

## 3. Authentication — reuse, no changes to mechanics

- Redeem Ops staff are rows in the existing `users` table and log in through the existing
  `/api/auth/*` (email+password or Google) with the same httpOnly `mktr_token` cookie.
- Staff onboarding reuses `invitationService.sendRoleInvitation` extended to the new role (Phase 1).
- Sessions are per-host (host-only cookie, SameSite=strict) — an ops.redeem.sg login is isolated
  from mktr.sg and redeem.sg. No SSO work needed or wanted for V1.
- **Do not** revive the `services/auth-service` JWKS spike for this.

## 4. Authorization — additive two-level model

Existing `requireRole` stays untouched. Redeem Ops adds:

1. **Platform role value** `redeem_ops` appended to the `users.role` enum (migration 045;
   precedent: enum extension in migration 029). Dedicated outreach staff get this role; it is
   invisible to every existing `requireRole('admin'|'agent'|…)` gate, to agent-sync (scoped to
   `role='agent'`), and to lead routing.
2. **Sub-role column** `users.redeemOpsRole` (STRING(32), nullable):
   `super_admin | ops_admin | bdm | outreach_exec | campaign_ops | redemption_ops | analyst`.
   Nullable so an existing MKTR `admin` can also be granted a Redeem Ops sub-role; users with
   `role='admin'` are implicitly `super_admin` (override in middleware).
3. **Capability map + middleware**: `services/redeemOps/permissions.js` defines
   `ROLE_CAPABILITIES`; `middleware/redeemOpsAuth.js` exports
   `requireRedeemOps(...capabilities)` = `authenticateToken` + (admin bypass ∨ capability check).
   All enforcement server-side; the SPA only *hides* what the API already forbids.
   Full matrix in `PERMISSION_MATRIX.md`.

**Campaign Ops clarification** (per addendum §4): the `campaign_ops` sub-role manages
*Activations* — search/link an existing MKTR campaign, allocate reward inventory, monitor
availability, view read-only campaign metrics. It grants **zero** MKTR campaign-builder access;
campaign creation/edit remains `requireRole('admin')` on the existing `/api/campaigns` +
`/api/admin/campaigns` surfaces on mktr.sg.

## 5. Surface & host plumbing (what actually changes)

| Change | File | Detail |
|---|---|---|
| Allowlist the ops host | `backend/src/utils/publicHost.js:12-17` | Add `ops.redeem.sg` to `ALLOWED_PUBLIC_HOSTS`; add `isOpsHost()`; **do not** widen `isRedeemHost` (that predicate means "consumer redeem brand" and drives the D13 block + email/CAPI branching). |
| Protect the new namespace | `backend/src/middleware/internalRouteHostGuard.js:13-24` | Add `/api/redeem-ops` to `BLOCKED_PATH_PREFIXES` (blocks consumer redeem.sg/www). ops.redeem.sg passes because it is not a redeem-consumer host. Also block the internal namespace from any *future* partner host. |
| **Ops-host allow-policy (Codex finding, accepted)** | same guard | Today the guard only *blocks redeem hosts* (`isRedeemHost` check at `internalRouteHostGuard.js:40`), so an allowlisted ops.redeem.sg would reach `/api/admin/*` etc. at the host layer, leaving role checks as the only gate. Extend the guard with a per-surface policy: for `isOpsHost()` requests, **allow only** `/api/auth`, `/api/redeem-ops`, `/api/notifications` and 403 the other internal prefixes. Host policy is defence-in-depth; capabilities remain the primary gate. |
| CORS | `backend/src/server_internal.js:70-79` | Add `https://ops.redeem.sg` to default origins (defence-in-depth; the surface uses the same-origin proxy anyway). |
| Auth-route guard nuance | same guard | `/api/auth` stays blocked for redeem.sg but must be reachable from ops.redeem.sg — satisfied automatically because the block tests `isRedeemHost(publicHost)` only. Add a regression test. |
| Rate limiter | `backend/src/server_internal.js:99-116` | Outreach staff are normal IP-limited users (200 req/15 min prod). Extend the admin bypass to `role='redeem_ops'` **or** raise via `RATE_LIMIT_MAX_REQUESTS` if queue polling gets throttled — decide with real usage in Phase 3, not preemptively. |

**Frontend surface**: introduce a **new** `VITE_SURFACE=ops` build flag (to be built in Phase 1 —
`vite.config.js:6-9` currently resolves only `VITE_BRAND`; that mechanism is the proven precedent
this replicates, not something that exists today):

- `ops` build: mounts ONLY `/redeem-ops/*` routes + login + minimal chrome (everything else →
  redirect to mktr.sg), analogous to how the redeem build swaps `ProtectedRoute` wholesale.
- `mktr` build: additionally mounts `/redeem-ops/*` behind `VITE_REDEEM_OPS_ENABLED`
  (dogfood path; precedent: `VITE_CAMPAIGN_WORKSPACE_ENABLED`).
- `redeem` (consumer) build: never contains ops routes.

Render deployment for cutover (mirrors `redeem-frontend` exactly): new static site from the same
repo, `VITE_SURFACE=ops`, `VITE_API_URL=/api` + rewrite `/api/* → https://api.mktr.sg/api/*`,
custom domain `ops.redeem.sg` (Cloudflare CNAME), backend env `REDEEM_OPS_ENABLED=true`.

## 6. Data layer standards (details in `ERD.md`)

- New tables only; **no ALTERs to MKTR tables** except the two `users` columns above.
  Migrations start at **045** (044 is uncommitted on `feat/campaign-store-catalog` — merge-order
  coordination required).
- Conventions: UUID v4 PKs, snake_case plural table names, Sequelize-default camelCase columns,
  explicit associations in `models/index.js`, `STRING(n)` + app-level constants for evolving
  states (house drift away from `DataTypes.ENUM`), display values preserved separately from
  normalized matching columns.
- Delete discipline: append-only history/ledger tables never cascade from their subject
  (`RESTRICT` or `SET NULL` + snapshots — the `Payment` precedent); operational children
  (contacts/locations) cascade with their partner; MKTR references are `SET NULL` + name snapshot.
- Concurrency: claim = single conditional `UPDATE … WHERE "ownerUserId" IS NULL … RETURNING`;
  pool-next = `FOR UPDATE SKIP LOCKED`; inventory = guarded counter UPDATE + ledger insert in one
  transaction. All three have existing exemplars cited in `ERD.md` §Integrity.

## 7. Future Partner Portal (`partners.redeem.sg`) — designed now, built later

Decisions made now so the portal needs **no data-model rewrite**:

1. **Row-level partner scoping is structural**: every reward/activation/entitlement/redemption row
   carries `partnerOrganisationId` (and `locationId` where relevant) — partner scoping is a WHERE
   clause, not a refactor.
2. **Separate principal table** for external users: future `partner_users`
   (email, credential/OTP, `partnerOrganisationId`, portal role) — external identities never enter
   `users` (keeps them out of staff RBAC, agent-sync sweeps, and admin UIs). They authenticate via
   the same jsonwebtoken infra but with a **distinct token audience/claim**
   (`scope:'partner'`, `partnerOrgId`) verified by a dedicated `partnerPortalAuth` middleware on a
   dedicated `/api/partner-portal/*` namespace. Internal staff tokens are never valid there and
   vice versa.
3. **Actor polymorphism in histories now**: `redemption_events` and `redeem_ops_audit_events`
   record `actorType` (`staff | agent | partner_user | consumer | system`) + `actorUserId`
   (nullable) so both a consultant-performed unlock and a future partner-performed verification
   are representable without schema change.
4. **Verification endpoints designed dual-audience**: redemption verify/complete logic lives in
   `redemptionService` with the acting principal passed in — Phase 6 exposes it to staff; the
   portal later exposes the same service under partner auth with location scoping.
5. **Data minimisation contract** (privacy §35): the partner-visible projection of an entitlement
   is `{ tokenHint, status, rewardTitle, expiry }` — never lead PII, never campaign/lead
   management data, never financial-planning signals. Encoded as a projection function from day
   one (`entitlementService.partnerView()`), even though only staff call it in V1.

## 8. Consumer surface (redeem.sg) — Phase 6 touchpoint only

The consumer claim/redemption journey (e.g. `redeem.sg/r/:token` showing a reward voucher +
partner instructions) is a **new consumer-build route** rendered from Redeem Ops fulfilment APIs.
It is deliberately out of V1; the path and API are reserved in `ROUTE_MAP.md`. Nothing existing on
redeem.sg moves.

## 9. Observability, audit, jobs

- **Audit**: `redeem_ops_audit_events` (append-only, actor + action + entity + before/after JSONB +
  `requestId` from the existing `requestId` middleware). Written by `auditService` inside the same
  transaction as the mutation for the actions listed in `PERMISSION_MATRIX.md` §Audited actions.
- **Jobs**: staleness sweeps (first-outreach 48h flag, 14-day stale flag) run as an in-process
  interval in `bootstrap.js` gated by `REDEEM_OPS_ENABLED`, following the release-sweep pattern —
  flags set on rows; **no auto-release** of claims in V1 (matches brief §16).
- **Logging/Sentry**: pino + existing Sentry init; log keys prefixed `redeem_ops.` (house style:
  `redeemed_audience.sync.done`).

## 10. What Redeem Ops will NOT do (enforced review checklist)

1. No second Campaign model, builder, landing-page config, form config, pixel config, or campaign
   URL generation — campaign work happens on mktr.sg.
2. No writes to `campaigns`, `prospects`, `qr_tags`, `lead_packages`, or routing/quota state.
3. No copies of lead PII into Redeem Ops tables (FK + server-side join only).
4. No second auth system, no JWKS revival, no workspace tooling, no message broker.
5. No repository restructuring; no moving existing directories.
6. No MKTR code importing from `services/redeemOps/` (one-way **import** rule; the Phase 6 hook is
   injected at the bootstrap composition root — a no-op-by-default callback, never an import).
7. No consumer-facing exposure of internal ops APIs (host guard + capability checks are both
   mandatory on every route).

## 11. Open decisions (tracked, non-blocking)

| # | Decision | Default until decided |
|---|---|---|
| 1 | Ship dogfood on mktr.sg `/redeem-ops` first vs. straight to ops.redeem.sg | Dogfood first (zero DNS/Render work; flag-gated) |
| 2 | `pg_trgm` for fuzzy-name duplicate detection | Attempt `CREATE EXTENSION IF NOT EXISTS pg_trgm` in migration with graceful fallback to normalized-prefix matching (see `ERD.md`) |
| 3 | Rate-limiter treatment for ops staff | Leave default; revisit with Phase 3 usage data |
| 4 | Email notifications for task assignment | Defer past V1 (reuse `mailer.js` when added) |
