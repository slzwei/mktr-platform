# Redeem Ops — Implementation Plan

> Phase 0 deliverable. Sequencing for Phases 1–7 (brief §38) against this repo's realities.
> Phase 0 (this document set) is complete when these docs are accepted. **No application code
> before that.** Every phase ships dark behind `REDEEM_OPS_ENABLED` /
> `VITE_REDEEM_OPS_ENABLED`; production MKTR behaviour is unchanged until flags flip.

## Ground rules (from discovery)

- Migrations: start at **045**; coordinate with uncommitted `044-…` on
  `feat/campaign-store-catalog` (merge that branch first or renumber at rebase). Runner is
  up-only — every migration must be additive and idempotent-safe.
- Route/model files flat (auto-loader); controllers/services nested under `redeemOps/`.
- Work in small vertical slices: migration → model+associations → service (DI factory) →
  route+controller → SPA page → tests, per slice. Run `cd backend && npm test` (needs local
  Postgres + `JWT_SECRET`) and targeted Vitest after each slice; CI has 5 chronically-red
  pre-existing suites — regressions are judged against that baseline.
- Dependency direction: `redeemOps → MKTR` only. The single MKTR-side edit (Phase 6 hook) goes
  through the `makeProspectService` DI seam.

## Phase 1 — Foundation (boundary, auth, audit, shell)

**Backend**
1. Migration 045: `ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'redeem_ops'` +
   `users.redeemOpsRole` column + `redeem_ops_audit_events` table — landed in the SAME change as
   every code-side enum touchpoint (else the value is dead): `User.js:47` ENUM list,
   `userService.inviteUser` `allowedRoles` (`userService.js:146`), `invitationService` roleLabel,
   Joi user/invite schemas, `getDefaultRouteForRole` (`src/lib/utils.js:8`).
2. `services/redeemOps/permissions.js` (capability map) +
   `middleware/redeemOpsAuth.js` (`requireRedeemOps`) + `services/redeemOps/auditService.js`.
3. `routes/redeemOpsAdmin.js` (flag-mounted): `/team`, `/team/invite` (extend
   `invitationService.sendRoleInvitation` role allowlist + label), `/team/:userId/role`,
   `/audit`, `/meta/constants`.
4. Plumbing edits: add `/api/redeem-ops` to `internalRouteHostGuard` **and implement the ops-host
   allow-policy** (`isOpsHost()` → only `/api/auth`, `/api/redeem-ops`, `/api/notifications`
   pass; other internal prefixes 403 — see `RECOMMENDED_ARCHITECTURE.md` §5); add `ops.redeem.sg`
   to `publicHost.js` allowlist + CORS defaults (inert until the site exists).
**Frontend**
5. `VITE_REDEEM_OPS_ENABLED` route group `/redeem-ops/*` + `RedeemOpsRoute` guard +
   `DashboardLayout` nav branch; Team page; shared data-table + filter components; query hooks
   scaffold (`src/hooks/queries/redeemops/`).
**Tests (gate to merge)**
- requireRedeemOps: admin bypass; sub-role capability grant/deny; `redeem_ops` user 403 on
  `/api/admin/*`; flag-off → 404 on every redeem-ops route.
- Host guard: consumer redeem.sg → 403 on `/api/redeem-ops/*`; ops.redeem.sg host → `/api/auth`
  and `/api/redeem-ops` reachable but `/api/admin/*` / `/api/users/*` etc. → 403 (ops-host
  allow-policy).
- Agent-sync regression: a `role='redeem_ops'` user survives `syncAgentsFromLyfe` sweeps.
**Exit**: an invited outreach user logs in on the flagged surface, sees an empty shell, audit rows
write. MKTR untouched with flags off.

## Phase 2 — Partner CRM (most important milestone)

1. Migration 046: `partner_organisations`, `partner_locations`, `partner_contacts`,
   `partner_assignment_events`, `partner_stage_events`, `outreach_activities` (+ pg_trgm attempt).
2. `normalizers.js` + `dedupeService.js` (exact + potential tiers) — pure functions first, fully
   unit-tested.
3. `partnerService.js` (CRUD, stage machine, timeline), `claimService.js` (atomic claim/release/
   assign per `ERD.md` §4.1), activity logging with lastActivity/firstOutreach stamping.
4. `routes/redeemOpsPartners.js` + controller; Joi schemas (loud-fail, no stripUnknown — internal
   surface).
5. SPA: PartnersList (server-side pagination/filter/debounced search), PartnerDetail
   (claim button with 409 conflict toast, timeline lazy-load, contacts/locations editors),
   duplicate-aware create dialog (open-existing / add-as-location / continue-with-reason / merge
   for authorized roles).
**Tests** (brief §37 Claiming + Dedupe): available→claimed; claimed→409 for second user;
**parallel simultaneous claims → exactly one winner** (integration, real Postgres — precedent
style: `test/integration/agentAssignment.test.js`); unauthorized reassign 403; same
UEN/phone/domain/handle exact-match behaviour; fuzzy name+postal potential match; legitimate
second outlet → add-as-location path; merge preserves contacts/activities/history/ownership.
**Exit**: staff can search, create-with-dedupe, claim, log activity, move stages; managers reassign;
history intact — brief §40 criteria 2–7, 10–13.

## Phase 3 — Outreach operations (V1 complete at exit)

1. Migration 047: `outreach_tasks`, `prospecting_pools`, `prospecting_pool_members`.
2. `taskService`, `poolService` (claim-next via SKIP LOCKED), `queueService` (aggregated My Queue);
   staleness sweep interval in `bootstrap.js` (flag-gated; sets atRisk/stale flags only).
3. Routes `redeemOpsWork.js`; SPA MyQueue, Tasks, Pools, TeamPipeline (Kanban with
   server-validated transitions), OpsOverview.
**Tests**: task ownership/authorization; due-state calc (today/overdue boundaries, SGT);
completion; claim-next concurrency (two parallel calls → different partners; exhausted pool →
204); stale sweep respects FOLLOW_UP_LATER-with-future-task exception.
**Exit = V1 acceptance (brief §11/§40)**: three outreach staff run their day entirely in the
system. → **Cut over surface: create `ops.redeem.sg` static site (`VITE_SURFACE=ops`, relative
`/api` + rewrite), DNS CNAME, flip `REDEEM_OPS_ENABLED=true`** per
`RECOMMENDED_ARCHITECTURE.md` §5.

## Phase 4 — Onboarding & rewards

1. Migration 048: `partner_onboarding_items`, `reward_offers`, `reward_terms_versions`,
   `reward_offer_locations`, `reward_inventory_events`.
2. `onboardingService` (template seed on PARTNERED), `rewardService`, `inventoryService`
   (guarded counters + ledger in one transaction).
3. Routes `redeemOpsRewards.js`; SPA Rewards pages + onboarding tab.
**Tests** (brief §37 Inventory): committed/adjust ledger entries; cannot allocate beyond
committed; **concurrent allocations cannot oversubscribe** (parallel guarded UPDATEs);
counter↔ledger reconciliation assertion.

## Phase 5 — Activations & MKTR linkage

1. Migration 049: `activations` (+ partial unique on live campaignId).
2. `activationService` (status machine, allocation via inventory service),
   `campaignProjection.js` (attribute-allowlisted read + `computeCampaignMetrics` reuse).
3. Routes `redeemOpsActivations.js`; SPA Activations pages (link picker, read-only campaign card,
   metrics, "Open in MKTR" deep link to `/admin/campaigns/:id/workspace`).
**Tests**: cannot link archived campaign; second live activation on same campaign → 409 (DB
enforced); allocation respects offer remaining; projection never leaks `design_config`.

## Phase 6 — Entitlements & redemptions

1. Migration 050: `reward_entitlements`, `redemptions`, `redemption_events`.
2. `entitlementService` (token mint SHA-256-at-rest, idempotent issue, expiry sweep,
   `partnerView()` projection), `redemptionService` (verify/complete/override — conditional-UPDATE
   state transitions).
3. Capture hook via `makeProspectService` DI (flag `REDEEM_OPS_ENTITLEMENTS_ENABLED`) **plus the
   server-side verification stamp** (`sourceMetadata.phoneVerifiedAt` from `verifiedPhoneStore` at
   create — same DI-seam change) + reconciliation sweep (`MKTR_INTEGRATION.md` §2). Default
   `unlockPolicy='agent_unlock'`: capture creates a locked reservation, not a live voucher. Routes
   `redeemOpsFulfilment.js`; SPA Redemptions console. (Consumer `redeem.sg/r/:token` page + public
   `/api/reward-claim` namespace: separate follow-on slice.)
4. **Agent-mediated unlock (cross-repo slice)**: unlock endpoints on the existing HMAC surfaces
   (`POST /api/external/entitlements/unlock`, `POST /api/integrations/lyfe/entitlement-unlock`) +
   a "scan client's QR / unlock voucher" screen in the mktr-leads app and the Lyfe app (separate
   repos — coordinate like the lead-outcome rollout); voucher SMS/email on unlock via the existing
   SNS sender + `mailer.js`.
**Tests** (brief §37 Entitlements): valid/expired/cancelled paths; duplicate issuance (hook+sweep
race) → single row; **double redemption → exactly one success, idempotent replay response**;
token validated server-side (garbage/foreign tokens rejected); **a raw unverified
`POST /api/prospects` (no OTP) creates a lead but never an entitlement** (anti-farming
precondition); unlock: only the lead's assigned consultant can unlock (wrong agent → 403;
admin override audited), scan and button paths idempotent (replay → "already unlocked"),
**a reservation-pass QR is rejected by salon verify**, expired reservations return inventory to
the pool; capture path unaffected when Redeem Ops errors (hook failure swallowed, lead still
created — regression test on `createProspect`).

## Phase 7 — Analytics & renewal

Aggregation endpoints (SQL over own tables + `computeCampaignMetrics` for acquisition numbers —
no fake metrics where instrumentation doesn't exist), Analytics SPA, renewal outcome on
Activation + auto follow-up task. CSV import (brief §32) slots here or earlier if prospect-list
loading becomes the bottleneck — batch tables are already designed (`ERD.md` §3.20).

## Risk register

| Risk | Mitigation |
|---|---|
| Migration 044 numbering collision (uncommitted branch) | Land/renumber before 045; `migrations.test.js` covers runner behaviour |
| Enum `ADD VALUE` forgotten code touchpoints (model ENUM list, invite allowlist, Joi, default routes) | Phase 1 step 1 checklist; the runner is non-transactional (`runMigrations.js:52`) so `IF NOT EXISTS` on PG12+ is the whole DB-side story — verify on CI's postgres:15 |
| Route flag misconfig exposes namespace early | Flag default `'false'` in `meta`; test asserts 404 when unset |
| Ops staff hit the 200 req/15 min public limiter | Monitor in Phase 3 dogfood. NOTE (Codex-verified): the existing admin bypass is **broken for cookie sessions** — `optionalAuth` mounts before `cookieParser()` (`server_internal.js:120` vs `:159`) so the limiter never sees a role; any `redeem_ops` bypass requires fixing that ordering first (pre-existing MKTR bug, worth fixing regardless) |
| Reward farming via the public, OTP-optional `POST /api/prospects` (Phase 6) | Issuance precondition: server-stamped `phoneVerifiedAt` + quarantine/DNC checks + finite activation allocation (`MKTR_INTEGRATION.md` §2.0); test pins it |
| Duplicate-signup race returns 400 not 409 (pre-existing: `errorHandler.js:48` unique-violation mapping) | Not a Redeem Ops blocker; optional MKTR fix — map `prospects_campaign_id_phone` violations to the 409 shape |
| SPA bundle growth on mktr build | All redeem-ops pages `lazy()` like existing routes; ops build excludes admin pages symmetrically |
| `users` sweep interactions (agent sync, two-phase delete) | Pinned by Phase 1 regression test; ops staff carry no `lyfeId`/`mktrLeadsId` |
| Backend restarts lose in-process sweep timing | Sweeps are stateless scans (house pattern); no persistent scheduler needed |
| Single-instance assumptions (in-process claim queue not needed — all claims are single-statement SQL) | Concurrency safety lives in SQL, correct even multi-instance (chargeLeadCredit precedent) |

## Definition of done — first major release (brief §40 mapping)

1–2. Staff login + central search → Phases 1–2. 3. Duplicate surfacing → Phase 2 dedupe.
4–5. Single active owner + concurrency-safe claim → Phase 2 (DB-enforced). 6–9. Locations,
contacts, activities, follow-ups, daily queue → Phases 2–3. 10. Pipeline moves → Phases 2–3.
11–12. Manager visibility + reassign → Phases 2–3. 13. History intact → append-only tables +
audit. 14. No second campaign builder → enforced by `RECOMMENDED_ARCHITECTURE.md` §10 +
projection-only campaign access. 15. No duplicate lead DB → entitlements reference `prospects.id`
only.
