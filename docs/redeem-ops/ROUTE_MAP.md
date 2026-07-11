# Redeem Ops — Route Map

> Phase 0 deliverable. Backend routes mount via the auto-loader
> (`export const meta = { path, flag: 'REDEEM_OPS_ENABLED', flagDefault: 'false' }`) and each names
> its capability from `PERMISSION_MATRIX.md`. `/api/redeem-ops` is added to
> `internalRouteHostGuard.BLOCKED_PATH_PREFIXES` (unreachable from consumer redeem.sg). Phases
> refer to `IMPLEMENTATION_PLAN.md`.

## 1. Backend API (`/api/redeem-ops/*`)

### Partners — `routes/redeemOpsPartners.js` (Phase 2)

| Method & path | Capability | Purpose |
|---|---|---|
| GET `/partners` | partners.view | Paginated list; server-side filters: search (name/phone/uen/handle), stage, owner, category, availability, flags. Sort: lastActivityAt, createdAt. |
| POST `/partners` | partners.create | Create; runs dedupe; `409`-style structured response with matches unless `overrideReason` supplied (exact matches always require it). |
| GET `/partners/check-duplicates` | partners.create | Pre-save duplicate probe (name/uen/phone/domain/socials/postal) → matches with owner, stage, reason, last activity. |
| GET `/partners/:id` | partners.view | Detail incl. contacts, locations, open tasks, stage, owner. |
| PUT `/partners/:id` | partners.edit (own) / ops_admin+ | Update display fields; recomputes normalized keys. |
| POST `/partners/:id/claim` | partners.claim | **Atomic claim** (conditional UPDATE); `409 { claimedBy }` on loss. |
| POST `/partners/:id/release` | partners.release (own) | Release back to available. |
| POST `/partners/:id/assign` | partners.reassign | Manager assign/reassign `{ toUserId, reason }`. |
| PATCH `/partners/:id/stage` | pipeline.move | Validated transition; writes stage event. |
| POST `/partners/:id/merge` | partners.merge | `{ duplicateId, reason }` — re-points children, audits. |
| GET `/partners/:id/timeline` | partners.view | Activities + stage events + assignment events, chronological, paginated (lazy-load). |
| POST `/partners/:id/activities` | activities.log | Log outreach activity (type/direction/summary/outcome/occurredAt/contactId). |
| PATCH `/activities/:id` | activities.edit (own) | Correction (audited before/after); DELETE not exposed — `POST /activities/:id/void`. |
| GET/POST `/partners/:id/contacts`, PATCH/`archive` `/contacts/:id` | contacts.manage | |
| GET/POST `/partners/:id/locations`, PATCH `/locations/:id` | locations.manage | |
| GET/PATCH `/partners/:id/onboarding` | onboarding.manage | Checklist read/update (Phase 4). |

### Work queue, tasks, pools — `routes/redeemOpsWork.js` (Phase 3)

| Method & path | Capability | Purpose |
|---|---|---|
| GET `/queue` | analytics.view_own | **My Outreach Queue**: overdue, due-today, newly assigned, awaiting-first-outreach, recently replied, follow-ups soon, stale — one aggregated endpoint. |
| GET `/tasks` | tasks.manage (own scope) | Filters: assignee (bdm+ may query others), status, due window (`today|overdue|upcoming`), partner. |
| POST `/tasks` | tasks.manage | Create (title, partnerId, contactId?, assignee, dueAt, priority, type). |
| PATCH `/tasks/:id` | tasks.manage (own/team) | Edit / status transitions; completion stamps completedAt/By. |
| GET `/pools` · POST `/pools` · PATCH `/pools/:id` | pools.manage (GET: claim_next) | Pool CRUD. |
| POST `/pools/:id/members` | pools.manage | Add partners (bulk ids). |
| POST `/pools/:id/claim-next` | pools.claim_next | **SKIP LOCKED** next eligible prospect → atomic claim; `204` when pool exhausted. |
| GET `/team/pipeline` | pipeline.view_team | Manager board: stage × owner counts + drill-down list. |

### Rewards & inventory — `routes/redeemOpsRewards.js` (Phase 4)

| Method & path | Capability |
|---|---|
| GET `/rewards` · GET `/rewards/:id` | rewards.view |
| POST `/rewards` · PUT `/rewards/:id` · PATCH `/rewards/:id/status` | rewards.manage |
| POST `/rewards/:id/terms` (new version) · GET `/rewards/:id/terms` | rewards.manage / rewards.view |
| POST `/rewards/:id/inventory` (`{type: committed_increase|decrease|manual_adjustment, quantity, reason}`) | inventory.adjust |
| GET `/rewards/:id/ledger` | rewards.view |

### Activations & campaign reference — `routes/redeemOpsActivations.js` (Phase 5)

| Method & path | Capability |
|---|---|
| GET `/campaigns` (read-only MKTR projection; search for link picker) | campaigns.read_reference |
| GET `/activations` · GET `/activations/:id` | activations.view |
| POST `/activations` · PATCH `/activations/:id` | activations.manage |
| PATCH `/activations/:id/campaign` (link/unlink) | activations.link_campaign |
| PATCH `/activations/:id/allocation` (guarded ± via ledger) | activations.allocate_inventory |
| PATCH `/activations/:id/status` | activations.manage |
| GET `/activations/:id/campaign-metrics` (read-only, via `computeCampaignMetrics`) | campaigns.read_reference |

### Entitlements & redemptions — `routes/redeemOpsFulfilment.js` (Phase 6)

| Method & path | Capability |
|---|---|
| GET `/entitlements` (filters: activation, status, expiring) | entitlements.view |
| POST `/entitlements` (manual issue `{activationId, prospectId}`) | entitlements.issue_manual |
| PATCH `/entitlements/:id/cancel` | entitlements.issue_manual |
| POST `/redemptions/verify` (`{token}` → entitlement summary + validity; idempotent) | redemptions.verify |
| POST `/redemptions/complete` (`{token, locationId?, method}` → atomic issued→redeemed) | redemptions.verify |
| POST `/redemptions/:id/override` (`{action, reason}` — manual exception) | redemptions.override |
| GET `/redemptions` | entitlements.view |

**Agent-mediated unlock (Phase 6, `unlockPolicy='agent_unlock'`)**: the consultant's unlock action
does NOT go through `/api/redeem-ops/*` (consultants aren't ops staff; their apps are external).
It rides the existing HMAC server-to-server surfaces: `POST /api/external/entitlements/unlock`
(mktr-leads app) and `POST /api/integrations/lyfe/entitlement-unlock` (Lyfe app) — payload =
scanned presentation token (QR path) or prospect id (button path); the resolved agent must be the
lead's assigned consultant; idempotent; audited as `redemption_events('unlocked')`. See
`MKTR_INTEGRATION.md` §2.

Future (not V1): the consumer claim endpoint lives in a **separate public namespace** —
`POST /api/reward-claim` (public; entitlement token + phone-OTP validated; rate-limited) backing
`redeem.sg/r/:token`. It must NOT sit under `/api/redeem-ops/*`, which is host-blocked from
consumer redeem.sg (Codex finding, accepted — a claim route inside the internal namespace would
contradict the guard). Also future: `/api/partner-portal/*` namespace (separate auth — see
`RECOMMENDED_ARCHITECTURE.md` §7).

### Team, audit, meta — `routes/redeemOpsAdmin.js` (Phase 1)

| Method & path | Capability |
|---|---|
| GET `/team` (staff with sub-roles) | team.manage_access (list: analytics.view_team) |
| POST `/team/invite` · PATCH `/team/:userId/role` | team.manage_access |
| GET `/audit` (filter by entity/actor/action/date) | audit.view |
| GET `/meta/constants` (stages, activity types, reward types — the constants module, so SPA and API can't drift) | any authenticated redeem-ops user |
| GET `/categories` (`?includeInactive=true` for Settings) — admin-managed taxonomy; feeds partner/pool/reward pickers | any authenticated redeem-ops user |
| POST `/categories` · PATCH `/categories/:id` (rename cascades onto rows; retire via `isActive`) | settings.manage |
| POST `/categories/:id/merge` (consolidate a variant into another; cascade + delete source) · DELETE `/categories/:id` (unreferenced only) | settings.manage |

## 2. SPA pages (`src/pages/redeemops/`, routes in `src/pages/index.jsx`)

Included in `mktr` build behind `VITE_REDEEM_OPS_ENABLED` (dogfood) and in the `VITE_SURFACE=ops`
build as the whole app; never in the consumer `redeem` build. All wrapped in
`<RedeemOpsRoute capability="…">` (ProtectedRoute variant checking sub-role/capability client-side
— server remains the real gate).

| Route | Page | Phase | Nav section |
|---|---|---|---|
| `/redeem-ops` | OpsOverview (my queue summary + team snapshot for managers) | 3 | Overview |
| `/redeem-ops/partners` | PartnersList (table, filters, saved views; duplicate-aware create dialog) | 2 | Partners |
| `/redeem-ops/partners/:id` | PartnerDetail (header w/ owner+stage+claim button; tabs: Timeline, Contacts, Locations, Tasks, Onboarding, Rewards) | 2 | Partners |
| `/redeem-ops/pipeline` | TeamPipeline (table + Kanban; dnd via existing `@dnd-kit`, server-validated) | 3 | Outreach |
| `/redeem-ops/queue` | MyQueue (start-of-day worklist) | 3 | Outreach |
| `/redeem-ops/tasks` | Tasks (My/Due Today/Overdue/Upcoming/Team) | 3 | Outreach |
| `/redeem-ops/pools` (+`/:id`) | ProspectingPools (+ Claim Next) | 3 | Outreach |
| `/redeem-ops/rewards` (+`/:id`) | Rewards (offer editor, terms versions, inventory ledger) | 4 | Rewards |
| `/redeem-ops/activations` (+`/:id`) | Activations (campaign link picker, allocation, read-only campaign card + "Open in MKTR") | 5 | Rewards |
| `/redeem-ops/redemptions` | Redemptions (verify console + history) | 6 | Fulfilment |
| `/redeem-ops/analytics` | Analytics (outreach/category/reward/activation) | 7 | Insights |
| `/redeem-ops/team` | Team & access | 1 | Admin |
| `/redeem-ops/audit` | Audit log | 1 (write) / 2 (UI) | Admin |
| `/redeem-ops/settings` | Settings (category taxonomy: add/rename/merge/retire; more config later) | 8 | Admin |

Not-yet-built modules stay **out of the nav** (brief §30) rather than shipping as placeholders.

Shell: reuse `DashboardLayout` with a `redeem_ops` nav branch
(`src/components/layout/DashboardLayout.jsx:39` `getNavigationItems`) + an admin-visible
"Redeem Ops" section when the flag is on; shared table/filters built on the existing shadcn
`ui/` kit + TanStack Query hooks under `src/hooks/queries/redeemops/`.

## 3. Surface exposure matrix

| Namespace / route group | mktr.sg | ops.redeem.sg | redeem.sg (consumer) | partners.redeem.sg (future) |
|---|---|---|---|---|
| `/api/redeem-ops/*` | ✓ (flagged) | ✓ | ✗ 403 (host guard) | ✗ 403 |
| `/redeem-ops/*` SPA | ✓ (flag, dogfood) | ✓ (whole app) | ✗ (not in bundle + guard) | ✗ |
| Existing admin (`/Admin*`, `/api/admin/*`) | ✓ | ✗ (not in ops bundle; 403 via ops-host allow-policy; role-gated on top) | ✗ | ✗ |
| Lead capture (`/LeadCapture`, `/t/:slug`, `/api/prospects`, `/api/verify`) | ✓ (per-campaign) | ✗ | ✓ | ✗ |
| Future `/r/:token` claim page + public `/api/reward-claim` | — | — | ✓ (Phase 6+) | — |
| Future `/api/partner-portal/*` | ✗ | ✗ | ✗ | ✓ |
