# MKTR Admin rebuild — combined implementation plan

**Date:** 2026-07-15 · **Status:** REVIEWED — Codex round 1 (gpt-5.6-sol
xhigh, 6 BLOCKER / 6 MAJOR / 2 MINOR) verified against code and folded in;
one Codex fix overruled with evidence (see review log at the bottom).
**Sources of truth:** final design (claude.ai/design project
`57e68763-9fd1-47ed-b5f9-14224a016ff4`: `MKTR Admin.dc.html`,
`Design System.dc.html`, `mock-api.js`), `docs/plans/
mktr-admin-redesign-reconciliation.md` (DESIGN FINAL + net-new inventory),
`docs/plans/agent-wallet-commitments.md` (wallet spec — the detailed contract;
this plan sequences it, it does not restate it).

**Sequencing (locked):** wallet backend → admin API extensions → Switchboard
UI rebuild (flagged) → fleet/commissions/APK teardown rides the flag flip.
Four phases ≈ six PRs. Everything ships dark or additive until the flip.

---

## Phase A — Wallet & commitments backend (PR1, dark)

Implements `agent-wallet-commitments.md` verbatim — **as revised by the Codex
round 1 resolutions in that doc** (hidden-package concrete shape + unique
partial index, `payments.kind` settlement branch, transactional
archive-refund, user-lifecycle closure policy, priced-only commit-ability
that never touches `campaign.externalEligible`) — plus the **admin surface
the redesign consumes** (the wallet plan sketched it; the design fixed its
contract):

### A1. Migrations `068`–`071` (guarded/idempotent, camelCase DDL, indexes
mirrored on models — the `sync({force:true})` clobber lesson)

| # | Change |
|---|---|
| 068 | `campaigns.leadPriceCents` INTEGER NULL (+ Joi `campaignCreate`/`campaignUpdate` schema entries + campaignService create/update persist, admin-only clamp — the current schemas strip it and the service ignores it) |
| 069 | `lead_package_assignments.source` STRING(16) NOT NULL DEFAULT `'package'` + `unitPriceCents` INTEGER NULL; `lead_packages.kind` STRING(16) NOT NULL DEFAULT `'catalog'` + UNIQUE partial index `(campaignId) WHERE kind='wallet'` |
| 070 | `wallet_ledger` table: id, agentId (users FK), type `topup\|commit\|takedown_refund\|adjustment`, amountCents (signed), balanceAfterCents, paymentId/assignmentId/campaignId (nullable refs), note, createdBy (null = system), createdAt; index (agentId, createdAt); UNIQUE partials `(assignmentId) WHERE type='takedown_refund'` and `(paymentId) WHERE type='topup'`; registered `WalletLedger` model with `timestamps:false` + explicit createdAt (global config defaults both timestamps on) |
| 071 | `users.walletBalanceCents` INTEGER NOT NULL DEFAULT 0; `payments.kind` STRING(24) NOT NULL DEFAULT `'package_purchase'` |

All columns/indexes mirrored on models so test `sync({force:true})`
reproduces prod constraints (bootstrap runs migrations after sync in tests).

Note: the migrations dir already has TWO `066-*` files — **verified harmless**:
`runMigrations.js` tracks applied migrations by FULL FILENAME in `_migrations`
(lexicographic sort, filename-keyed set), so both 066 files run and 068+ is
collision-safe.

### A2. `backend/src/services/walletService.js`
Per the wallet plan: atomic `credit`/`debit` (ledger insert + balance update in
one transaction, `balance + amount >= 0` guard, 409 `insufficient_balance`),
`commit(agentId, campaignId, quantity)` (active + priced + external-eligible
validation; find-or-create hidden wallet `LeadPackage` per campaign —
`type:'custom'`, `isPublic:false`; create assignment `source:'wallet'` with
`unitPriceCents` snapshot), `refundCampaignCommitments(campaignId)` (idempotent
takedown refund: remaining × unitPriceCents per open wallet assignment, zero +
complete each). Hook: **`campaignService.archiveCampaign` is the ONLY real
trigger** — verified: no code path ever sets `status:'completed'` (transitions
are draft↔active↔paused via `is_active`/launch-state + archive/restore; the
enum value exists but is unreachable). Wire the refund into archiveCampaign;
leave a guard comment that any future completed-transition must call it too.
**Pause does not refund** (decision 5).

### A3. External endpoints — `/api/external/wallet` (HMAC POST, flag
`AGENT_WALLET_ENABLED` default false, rate-limiter exempt like the other
external routers): `/summary`, `/ledger`, `/catalog` (whitelisted fields;
hides unpriced campaigns), `/commit`. No cancel endpoint.

### A4. Top-up via the billing scaffold: `/api/external/billing` checkout
gains `kind:'wallet_topup'`; HitPay webhook settlement calls
`walletService.credit(type:'topup')`, idempotent by `providerPaymentId`.
Still gated by `BILLING_ENABLED` (HitPay provisioning is Shawn-side).

### A5. Admin wallet endpoints (NEW ROUTER `backend/src/routes/adminWallets.js`,
mount `/api/admin/wallets`, admin JWT auth, NOT flag-gated — read-only +
audited adjustment, safe to ship live):

| Endpoint | Returns / does |
|---|---|
| `GET /` | roster of EXTERNAL agents (**filter: `users.mktrLeadsId IS NOT NULL`**) with `walletBalanceCents`, `openCommitments[{campaignId, campaign, remaining, unitPriceCents}]` (wallet-source assignments only), derived `committedLeads`/`committedValueCents`, `lastActivityAt` (latest ledger row). Sort attention-first (S$0 top) is client-side |
| `GET /:agentId/ledger` | paginated ledger, newest first |
| `POST /:agentId/adjust` | body `{amountCents (signed, non-zero int), note (required, non-empty)}` → ledger `adjustment` with `createdBy = req.user.id`; 400 without note/amount; uses the same atomic credit/debit (negative adjustments obey the ≥0 guard) |

### A6. Campaign designer/form: `leadPriceCents` admin-only input;
`campaignService.updateCampaign` server-clamps it admin-only (same policy
pattern as `marketplaceListed`).

### A7. Tests (backend jest): everything in the wallet plan's matrix + admin
endpoints (auth, note-required 400, adjustment ledger shape, external-only
roster filter).

**mktr-leads app work (separate repo, parallel track after PR1):** wallet
screen + commit flow per the wallet plan; Shawn deploys/OTAs. Not in this
repo's PRs.

---

## Phase B — Admin API extensions (PR2, additive, unflagged)

The net-new inventory from the reconciliation, shaped to the mock's fetcher
contracts. All endpoints admin-JWT'd under existing routers unless noted.

### B1. Overview extension — `dashboardService.getAdminStats(startDate, endDate)`
ADD period-scoped `prospects.periodTotal`, `assigned` (**either assignee FK:
`assignedAgentId` OR `externalAgentId` non-null** — prospects carry two
mutually-exclusive assignee columns), `converted` (leadStatus = won, by
conversion in period), `conversionRate` (converted/periodTotal, 1dp). **Do
NOT change existing `total` (all-time) — the old dashboard consumes it during
coexistence.** New UI binds the new keys.

**Fix the cache while here (live bug):** `adminStatsCache` is a single global
with a 30s TTL, NOT keyed by date range (dashboardService.js:34–46) — a 7d
request right after a 90d request serves 90d numbers to the CURRENT dashboard
too. Key the cache by `period` (validated to `7d|30d|90d`) or drop it for
admin stats.

### B2. `GET /api/dashboard/attention` (new handler in `dashboard.js`) —
returns **structured aggregates**; the UI composes the queue rows/copy:

```json
{
  "webhooks": { "pending": n, "failedLast24h": n, "subscriberDisabled": bool },
  "held": { "total": n, "byReason": { "no_funded_agent": n, "no_funded_external_buyer": n, "dnc_pending": n, "dnc_registered": n, "returned_by_admin": n, "other": n } },
  "unassigned": n,
  "zeroCommitCampaigns": [{ "id", "name", "endsAt" }],
  "wallets": { "total": n, "zero": [{id,name}], "low": [{id,name,balanceCents}], "floatCents": n },
  "committed": { "leads": n, "valueCents": n, "campaigns": n },
  "drawsClosing": [{ "id", "name", "closesAt", "boostClosesAt", "multiplier", "winners" }],
  "endingCampaigns": [{ "id", "name", "endsAt" }]
}
```

Definitions corrected to the REAL schema (Codex finding 10, verified): held =
`quarantinedAt` non-null, grouped over ALL five real reasons —
`no_funded_agent`, `no_funded_external_buyer`, `dnc_pending`,
`dnc_registered`, `returned_by_admin` — plus `other` so total always
reconciles with byReason; **unassigned = `assignedAgentId` IS NULL AND
`externalAgentId` IS NULL AND `quarantinedAt` IS NULL** (two assignee FKs);
zero-commit = ACTIVE campaign with non-null `leadPriceCents` and no open
funded assignment (wallet OR package — during drain-down a package-funded
campaign is covered); wallets = external agents only (`mktrLeadsId` non-null),
low threshold S$50 (constant, documented); draws/endings ≤ 7 days. Webhook
numbers aggregate `WebhookDelivery`/`WebhookSubscriber` (failed in 24h,
pending, any disabled subscriber). The UI's Release-hold bulk action applies
only to the RELEASABLE reasons (`no_funded_agent`, `returned_by_admin` — the
service's own whitelist); DNC/external holds are not releasable from the bar.

### B3. `GET /api/dashboard/series?period=7d|30d|90d` — daily lead counts,
SGT-midnight buckets, `{date, count, isToday}[]` + `{today, avgPerDay, total}`.
One grouped query (`date_trunc` at +08), not N per day.

### B4. `GET /api/dashboard/funnel?period=` — `{scans, submits, assigned, won}`;
scans = lifetime `qr_tags.scanCount` prorated to the period, flagged
`"estimated": true` in the payload (design assumption 3), floored at submits.

### B5. `listProspects` extensions (`prospectService.js` only — verified the
`GET /api/prospects` route has NO query-schema validation; `req.query` flows
straight to the service): `sort` param — whitelist
`firstName|leadStatus|createdAt` with `-` prefix for DESC, default
`-createdAt`, unknown values fall back to default (never 500); `leadStatus`/
`leadSource` accept comma-lists (`IN` filter), single value stays
backward-compatible. Comma-list handling: split, trim, dedupe, whitelist
every token against the enum and DROP invalid tokens (never let an unknown
string reach a Postgres enum cast → 500); all-invalid ⇒ ignore the filter.

### B6. Campaign aggregates:
- Extend the admin campaigns list payload with `leadsThisPeriod`,
  `leadsTotal`, `qrTagCount`, `committedRemaining`, `committedValueCents`
  (grouped COUNT/SUM subqueries — no N+1). The list gains a validated
  `period` query param (`7d|30d|90d`, default 30d) driving `leadsThisPeriod`
  — today it accepts none (campaignService.js:187). New keys are additive
  inside the existing `{campaigns, pagination}` envelope.
- `GET /api/campaigns/:id/summary` (new, admin): campaign row + 30d daily
  series + open commitments (agent, remaining, unitPriceCents, valueCents) +
  latest 6 leads + its QR tags. One composite endpoint = one round-trip for
  the detail screen.

### B7. Agents roster aggregates: extend the admin agents listing with
`assignedThisPeriod` and `lastAssignedAt` (from prospects), plus wallet
columns joined for external agents (null for internal → UI renders "—").
Same period contract as B6: the agents list gains a validated `period` param
(it accepts none today — agentService.js:60); keys additive.

### B8. Tests: unit per aggregate (held/unassigned/zero-commit definitions,
SGT bucketing, comma-list + sort whitelist, funnel floor).

---

## Phase C — Switchboard UI rebuild (PR3–PR5, flag `VITE_ADMIN_V2_ENABLED`)

### C1. Theme + shell (PR3)
- `src/styles/adminV2.css`: the Switchboard tokens verbatim from the Design
  System (`:root/[data-theme="light"]` + `[data-theme="dark"]`), scoped under
  a `.admin-v2` wrapper class so legacy pages are untouched. Fonts follow the
  existing idiom (Google Fonts CSS `@import`): Schibsted Grotesk
  400/500/700/800 + IBM Plex Mono 400/500/600.
- Tailwind: extend `theme.colors` with a var-backed `sb` namespace
  (`sb-canvas`, `sb-surface`, `sb-ink`, `sb-accent`, `sb-ok`, `sb-warn`,
  `sb-bad`, `sb-hold`, soft variants…) so screens use utility classes, not
  inline styles. Radii/shadow per the DS (chip 6 / control 10 / card 14, one
  shadow token).
- `src/components/adminv2/AdminV2Shell.jsx`: fixed 228px sidebar with the
  final IA — **Overview** (Dashboard) · **Lead Generation** (Prospects,
  Campaigns, Agents, Agent Groups, Wallets & Commitments, QR Codes, Short
  Links) · **System** (Users, AI Settings) — plus 64px sticky topbar (period
  segmented control in page headers, theme toggle via the existing
  `next-themes` + `data-theme` stamp, sign-out). No fleet/finance/APK slots.
- Routing: in `src/pages/index.jsx`, when `import.meta.env
  .VITE_ADMIN_V2_ENABLED === 'true'`, the existing admin paths
  (`/AdminDashboard`, `/AdminProspects`, `/AdminCampaigns`, `/AdminAgents`,
  `/AdminAgentGroups`, `/AdminQRCodes`, `/AdminShortLinks`, `/AdminUsers`,
  `/AdminAISettings`, + new `/AdminWallets`, `/admin/campaigns/:id`) render
  the v2 screens inside `AdminV2Shell`; flag off → legacy pages unchanged.
  Same URLs = bookmarks/deep links survive.
- **Kept on the legacy shell, reachable from v2** (not rebuilt now):
  AdminCampaignDesigner / AdminCampaignForm / AdminCampaignWorkspace
  (campaign detail links out to them), AdminLeadPackages (linked from the
  Wallets screen header as "Legacy packages →" during drain-down).

### C2. Screens (PR3: Dashboard + Prospects; PR4: Campaigns list/detail,
Agents, Agent Groups, Wallets & Commitments; PR5: QR Codes, Short Links,
Users, AI Settings)

Mock fetcher → real endpoint mapping (the design consumed these shapes):

| Mock fetcher | Real call |
|---|---|
| `fetchOverview(period)` | `GET /api/dashboard/overview?period=` (extended B1; bind periodTotal/assigned/converted/conversionRate) |
| `fetchAttention()` | `GET /api/dashboard/attention` (B2; UI composes severity rows: incident → held → warning → watch) |
| `fetchLeadSeries(period)` | `GET /api/dashboard/series` (B3) |
| `fetchFunnel(period)` | `GET /api/dashboard/funnel` (B4) |
| `fetchRecentLeads(8)` | `GET /api/prospects?limit=8&sort=-createdAt` |
| `fetchCampaignLeaderboard(period)` | extended campaigns list (B6), client top-6 by period leads |
| `fetchProspects(opts)` | `GET /api/prospects` with `assignment=held\|unassigned`, comma-list `leadStatus`/`leadSource`, `search`, `campaignId`, `sort`, `page`/`limit` (B5) |
| `fetchProspectById` | existing prospect detail (drawer: priority, score, utm, qrTag label, consent flags, lastContactDate, conversionDate; heldReason ← DTO alias of `quarantineReason`) |
| `fetchCampaign(id)` | `GET /api/campaigns/:id/summary` (B6) |
| `fetchCampaignsList()` | extended campaigns list (B6) |
| `fetchAgents()` | extended agents listing (B7) |
| `fetchAgentGroups()` | `GET /api/admin/agent-groups` + members; `funded` derived client-side against wallet roster |
| `fetchWallets()` / ledger / `applyAdjustment` | `GET /api/admin/wallets`, `GET /:id/ledger`, `POST /:id/adjust` (A5) |
| `fetchQrTags()` | existing QR admin listing |
| `fetchShortLinks()` | `GET /api/shortlinks` (`active` derived from `expiresAt`) |
| `fetchUsers()` | `GET /api/users` (staff filter; `lastActiveAt` ← `lastLogin`; `invited` ← invitationToken set + never logged in) |
| `fetchAiSettings()` | `GET /api/admin/ai/settings` + `PUT` (existing; key hints + replace-key + guardrails/workstyle) |

Interaction parity with the prototype: period recompute on every dashboard
widget, filters-as-removable-chips synced to the URL query, server
pagination 25/page, bulk-select bar — **wired LIVE, not stubbed**: the repo
already has `PATCH /api/prospects/bulk/assign`, `PATCH /bulk/return-to-held`
and `POST /bulk/delete` (agent-or-admin auth, Joi'd), so the v1 bulk bar ships
Assign-to-agent (picker), Return to held, Delete (destructive confirm) plus
client-side Export CSV of the selection, 432px right drawer (Radix
Dialog/Sheet), client-side CSV export, skeletons mirroring final geometry,
error states with retry, sonner toasts. Charts are token-driven div bars per
the prototype (recharts stays out of the new screens — fewer moving parts,
exact design fidelity).

### C3. Data layer: `src/api/adminV2.js` (thin fetch wrappers over the
existing authed api client) + react-query hooks (`useOverview(period)`,
`useAttention()`, …) with query keys carrying period/filters. **Adapters
unwrap each endpoint's REAL envelope** (verified: campaigns →
`{campaigns, pagination}`, shortlinks → `{items, total}`, users →
`{users, pagination}` with default `limit=10`): every list hook sends
explicit `limit=25` (users additionally `role=admin` server-side — never
client-filter the default first page) and normalizes to `{rows, total}` for
the table components. The five held-reason chips (+ `other`) get copy in one
`HELD_REASON_LABELS` map shared by queue, table chips, and drawer.

### C4. Frontend tests (vitest): filter-chip ↔ query-param round-trip, CSV
serializer, severity ordering, currency/date formatters (SGT, S$),
held/unassigned param mapping. Playwright smoke (existing setup): flag-on
boot → dashboard renders → navigate all 10 routes → drawer opens.

---

## Phase D — Teardown (PR6, after flag flip + soak)

**Scope statement (Codex finding 13, verified): PR6 is HTTP-surface + UI
darkening, NOT a subsystem retirement.** The route loader imports every
module before checking mount flags, so import-time side effects keep running
(e.g. `pushService` starts its heartbeat/cleanup `setInterval`s in the
constructor at import — pushService.js:14–15), and unflagged domain behavior
stays live: commission creation on lead conversion (prospectService.js:1225),
commission checks in campaign deletion, device notify fan-out in
campaignService, car references in qrCodeService. That code is harmless with
zero fleet/device rows and gets deleted in the LATER code-removal pass, not
flagged now. What PR6 actually does:

Phased per the standing direction (hide → dark-flag → drop models later):

1. **Already hidden by the flip** — the v2 shell has no fleet/finance/APK
   nav. PR6 then removes: legacy pages `AdminFleet`, `AdminVehicles`,
   `AdminFleetMap`, `AdminDevices`, `AdminDeviceLogs`, `AdminCommissions`,
   `AdminApkManager`, `ProvisionDevice`, `FleetOwnerDashboard`,
   `DriverDashboard`/`DriverPayoutHistory`/`DriverPayslip`/`DriverProfile` +
   their routes/lazy imports + legacy `DashboardLayout` nav entries.
2. **Backend dark-flag** — mount `fleet.js`, `vehicles.js`, `devices.js`,
   `deviceEvents.js`, `provisioning.js`, `commissions.js`, `apk.js`,
   `adtechBeacons.js`, `adtechManifest.js` only when `FLEET_ROUTES_ENABLED
   === 'true'` (default off in prod) — flagging EVERY existing mount entry
   (fleet.js declares two, one already behind `ENABLE_DOMAIN_PREFIXES`).
   Reversible; code deletion is a later pass.
3. **`getAdminStats`** — strip fleet/impressions/commissions blocks (old
   dashboard is gone by then). Keep response keys additive-compatible until
   the legacy dashboard file is deleted in the same PR.
4. **Models/tables stay** (Car/Vehicle/Device/Commission/…): no destructive
   DB work without an explicit ask — DB safety rules.
5. Driver/fleet_owner **roles** remain in the enum (users may exist);
   login routing for those roles points at a "retired" notice page.

---

## Rollout

1. **PR1** (wallet, dark) → deploy → migrations auto-run → `AGENT_WALLET_
   ENABLED` stays unset. Verify: admin wallets endpoints return zeros;
   routing regression suite green.
2. **PR2** (API extensions) → deploy → curl-verify the five new/extended
   endpoints against prod data.
3. **PR3–5** (UI) → merge dark (`VITE_ADMIN_V2_ENABLED` unset on the static
   site) → verify locally with the flag on against prod API → set the env
   var on `mktr-platform` static site (srv-d2s3che3jp1c738qlgjg) → redeploy
   → deploy-verify (bundle hash + `curl` for a v2-only string, per the
   push≠live rules).
4. Soak a few days. Rollback = unset `VITE_ADMIN_V2_ENABLED` **and rebuild/
   redeploy the static site** — VITE_* flags are baked into the bundle at
   build time, so rollback is a ~3-minute redeploy, not instantaneous. (If
   instant rollback ever matters, that's a runtime-config change out of
   scope here.)
5. **PR6** teardown.
6. Wallet go-live is independent of the UI: HitPay provisioning →
   `BILLING_ENABLED` → $1 top-up e2e → `AGENT_WALLET_ENABLED` → app OTA
   (mktr-leads repo) → stop external package sales; drain-down continues.

## Risks / gotchas

- **Two 066 migrations exist** — verify runner collision behavior before 068.
- **Overview `total` semantics** — solved additively (B1); never mutate the
  key the legacy dashboard reads while both UIs are alive.
- **sync({force:true}) clobbers migration-created indexes** — mirror every
  new index/unique on the model definitions (lucky-draw lesson).
- **Committed-demand widgets before any commitments exist** — all wallet
  aggregates must render honest zeros (design has empty states), not error.
- **External-only wallets** (design assumption 16) — Agents roster joins
  wallet data as nullable; internal agents show "—" and never block.
- **CI is chronically red on main** (5 pre-existing suites + npm audit) —
  baseline against a clean worktree before attributing failures.
- **Meta CAPI untouched** — none of this touches prospect intake paths;
  Phase B is read-only aggregation, Phase A adds routing-pool rows through
  the existing package join (regression-tested).

---

## Codex review log (round 1 — 2026-07-15, gpt-5.6-sol xhigh)

Raw verdict: "not implementation-ready" on 6 BLOCKERs / 6 MAJORs / 2 MINORs.
Every finding was verified against the code before folding in:

| # | Finding | Disposition |
|---|---|---|
| 1 | Wallet trick bypasses consent boundary | **Overruled as stated, kept as documented stance** — mktr-leads agents are `users` rows routed through the internal package pool TODAY (2026-06 pivot design); the consent gate guards the INERT ExternalAgent buyer pool. Codex's fix (exclude mktrLeadsId from resolveLeadRouting) would break live delivery. Real fix folded: commit-ability = priced-only, never touches `campaign.externalEligible`; product question (consent_third_party vs mktr-leads delivery) flagged to Shawn separately |
| 2 | Parallel ExternalAgent pool | Verified inert (hasValidExternalConsent false for all data). Folded: stays inert + out of scope; roster filters `mktrLeadsId IS NOT NULL` |
| 3 | Hidden package NOT NULLs + findOrCreate race | **Confirmed** — folded (concrete row shape, `lead_packages.kind`, unique partial index) |
| 4 | wallet_topup doesn't fit Payment path | **Confirmed** — folded (`payments.kind` branch inside the existing locked settlement tx + unique topup ledger index) |
| 5 | Archive/refund not transactional | **Confirmed** (archiveCampaign has no tx) — folded (transactional archive + per-assignment unique takedown_refund index) |
| 6 | User lifecycle erases paid commitments | **Confirmed** (deactivate/bulk-delete destroy assignments; sync hard-delete ignores wallet rows) — folded (lifecycle policy in the wallet doc) |
| 7 | WalletLedger model/timestamps parity | Confirmed — folded into migration table |
| 8 | leadPriceCents stripped by Joi + ignored by service | Confirmed — folded into 068 row |
| 9 | Global 30s admin-stats cache ignores period (live bug today) | Confirmed — folded into B1 |
| 10 | externalAgentId second assignee FK + 5 real held reasons | Confirmed — folded into B1/B2 + C3 label map |
| 11 | Comma-list enum-cast safety | Confirmed — folded into B5 |
| 12 | Period contracts + payload envelopes ({campaigns,pagination} / {items,total} / {users,pagination} limit 10) | Confirmed — folded into B6/B7/C3 |
| 13 | Route flags don't retire the fleet subsystem (import-time timers, commission-on-conversion) | Confirmed — folded as Phase D scope statement |
| 14 | VITE flag rollback needs rebuild | Confirmed — folded into rollout step 4 |
