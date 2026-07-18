# Redeem Ops — Repository Discovery

> Phase 0 deliverable. Everything below was verified against the working tree on branch
> `feat/campaign-store-catalog` (2026-07-08). File references are exact paths; line numbers are
> approximate anchors, not contracts.

## 1. Executive summary

- **This repository is a two-part monolith**: a single React 18 + Vite SPA (`src/`) and a single
  Express 5 + Sequelize backend (`backend/`), deployed as **three Render services** — two static
  sites built from the *same* SPA source (branched by `VITE_BRAND`) and one backend
  (`api.mktr.sg`). It is **not** a workspace monorepo (no pnpm/Nx/Turbo); root `package.json` is
  the SPA, `backend/package.json` is the API.
- **The canonical Campaign model is `backend/src/models/Campaign.js`** (`campaigns` table) and the
  **canonical Lead model is `backend/src/models/Prospect.js`** (`prospects` table). Both are UUID-keyed
  Sequelize models in one PostgreSQL database (Render-hosted).
- **"Redeem" today is a consumer brand skin, not a domain.** `redeem.sg` serves the same SPA with
  `VITE_BRAND=redeem` (lead-capture surfaces only). There is **no partner, reward, voucher,
  entitlement, or redemption model anywhere in the codebase** — searched broadly (`reward`,
  `voucher`, `redeem`, `gift`, `booking`, `appointment`); hits are marketing copy, the
  `RedeemPlaceholder` page, the Meta ad-exclusion sync (`redeemedAudienceService.js`), and the
  in-flight "campaign gift" store-catalog fields (migration 044 — an MKTR→agent gift purchase,
  unrelated to partner rewards).
- Auth is a **single JWT identity system** (httpOnly cookie `mktr_token` + Bearer fallback) with a
  flat 5-value role enum and per-route `requireRole(...)` middleware. There is **no generic audit
  log**; per-domain history tables (`prospect_activities`, `webhook_deliveries`, `payments`) are the
  existing pattern.
- The repo has strong, reusable house patterns Redeem Ops should adopt: route auto-loading with
  env-flag gating, DI-factory services, Joi validation middleware, atomic conditional-UPDATE
  concurrency (`FOR UPDATE SKIP LOCKED`, `UPDATE … WHERE … RETURNING`), in-process schedulers, and
  host-aware multi-surface serving.

## 2. Repository structure (as it actually is)

```text
mktr-platform/
├── src/                          # React 18 + Vite SPA (both mktr.sg and redeem.sg builds)
│   ├── pages/                    # Route components (flat; subdirs: preview/, public/, __tests__)
│   │   └── index.jsx             # THE route table (react-router-dom v7, declarative)
│   ├── components/               # ui/ (shadcn/radix), auth/, layout/, campaigns/, prospects/, …
│   ├── api/                      # client.js (API client + entity classes), entities.js re-exports
│   ├── stores/                   # zustand: authStore.js (the only store)
│   ├── hooks/queries/            # TanStack Query hooks (useCampaignsQuery, useProspectsQuery, …)
│   ├── lib/                      # brand.js + brandConfigs/, metaPixel.js, tiktokPixel.js, utils.js
│   ├── design/                   # design tokens (tropic.css, colors.ts, typography.ts) — in-flight refactor on this branch
│   └── schemas/, services/, utils/, constants/, config/, data/, dev/, test/
├── backend/
│   ├── src/
│   │   ├── server.js             # "shell" that listens immediately, then imports server_internal.js
│   │   ├── server_internal.js    # middleware chain + route auto-load + bootstrap
│   │   ├── routes/               # 44 route files; auto-mounted via `export const meta`
│   │   ├── controllers/          # 38 controllers (thin; res.json envelopes)
│   │   ├── services/             # 60+ services (business logic; DI-factory pattern)
│   │   ├── models/               # 38 Sequelize models + index.js (auto-load + explicit associations)
│   │   ├── middleware/            # auth.js, validation.js (Joi), internalRouteHostGuard.js, …
│   │   ├── database/             # connection.js, bootstrap.js, runMigrations.js, migrations/ (002–044)
│   │   ├── integrations/         # AdapterRegistry + platform adapters (lyfe, mktr_leads)
│   │   ├── utils/                # publicHost.js, authCookie.js, customerHost.js, piiHashing.js, …
│   │   └── config/               # envValidation, swagger
│   ├── test/                     # Jest unit suites (~40) + test/integration/ (7 suites)
│   ├── scripts/, load/, uploads/
├── services/                     # DORMANT microservices spike: auth-service, gateway, leadgen-service
│   └── …                        #   (own Dockerfiles; run via infra/docker-compose.yml; NOT deployed)
├── infra/docker-compose.yml      # local compose for the spike above
├── tablet-app/                   # Android (Kotlin) in-car tablet ad player — separate surface, out of scope
├── e2e/                          # Playwright specs (admin dashboard, campaigns, prospects, auth, …)
├── docs/                         # plans/ (design docs), audit/, dnc/, + this directory (redeem-ops/)
├── public/                       # static assets for the SPA builds
├── .github/workflows/ci.yml      # CI: backend Jest against postgres:15 service container
├── vite.config.js                # VITE_BRAND resolved at config time → aliases @brand-config
└── package.json                  # SPA deps/scripts (backend has its own package.json)
```

Historical `*_PLAN.md` / `CODEX_REVIEW_*.md` design documents live in `docs/plans/` and
`docs/codex-reviews/` (rehomed from the repo root 2026-07-18).

## 3. Frontend

| Concern | What exists | Where |
|---|---|---|
| Framework | React 18.2, Vite 6, JS + JSX (TS only in `src/design/`) | `package.json` |
| Routing | react-router-dom **7.2**, one declarative route table | `src/pages/index.jsx` |
| State | zustand 5 (`authStore` only) + TanStack Query 5 for server state | `src/stores/authStore.js`, `src/lib/queryClient.js`, `src/hooks/queries/` |
| API client | Hand-rolled `APIClient` (fetch, `credentials:'include'`, JSON envelope parsing) + Base44-style entity classes (`CampaignEntity`, `ProspectEntity`, …) | `src/api/client.js` (845 lines), `src/api/entities.js` |
| UI kit | shadcn/ui on Radix primitives + Tailwind 3.4; `components.json` present | `src/components/ui/` |
| Design tokens | `src/design/` (tropic.css, colors, typography, semantic) — being refactored on the current branch (uncommitted) | `src/design/` |
| Forms | react-hook-form + zod resolvers | e.g. `src/components/forms/` |
| Auth handling | `useAuthStore` (user + `'authenticated'` flag in localStorage; real JWT is httpOnly cookie) | `src/stores/authStore.js` |
| Authorization | `<ProtectedRoute requiredRole="admin">` — client-side single-role check, redirect via `getDefaultRouteForRole()` | `src/components/auth/ProtectedRoute.jsx`, `src/lib/utils.js:8` |
| Admin shell | `DashboardLayout` — role-switched sidebar nav (admin sections / agent / fleet_owner / driver_partner), CommandPalette (⌘K), NotificationBell, ThemeToggle | `src/components/layout/DashboardLayout.jsx:39` |
| Brand split | `vite.config.js` resolves `VITE_BRAND` (`mktr` default, `redeem`) at build time → aliases `@brand-config` to `src/lib/brandConfigs/{mktr,redeem}.js`; route gates `brand.show*`, `IS_REDEEM_BUILD` guards | `vite.config.js:6-9,118`, `src/lib/brand.js`, `src/components/auth/BrandRouteGuards.jsx` |
| Existing admin pages | AdminDashboard, AdminProspects, AdminCampaigns (+Form/Designer/Workspace), AdminQRCodes, AdminAgents(+Detail), AdminAgentGroups, AdminUsers, AdminLeadPackages, AdminCommissions, AdminShortLinks, AdminFleet/Vehicles/FleetMap/Devices, AdminApkManager | `src/pages/Admin*.jsx` |

Frontend tests: Vitest + Testing Library (`npm test` at root); Playwright e2e in `e2e/`.

## 4. Backend

### Boot & middleware chain (`backend/src/server_internal.js`)

Order matters and is load-bearing:
`requestId` → helmet → compression → CORS (allowlist: mktr.sg/www/redeem.sg/www + `CORS_ORIGIN` env) →
rate limiter on `/api` (prod: 200 req/15 min per IP; admins nominally 2000, `/api/integrations/lyfe/`
and `/api/external/` exempt — HMAC-authed. ⚠️ **Pre-existing bug found during this review**: the
admin bypass is dead for cookie sessions — `optionalAuth` is mounted *before* `cookieParser()`
(`server_internal.js:120` vs `:159`), so `req.cookies` is empty when the limiter's role check runs;
only Bearer-token admins are actually exempted, and the SPA sends no Bearer token
(`src/api/client.js:29`)) → `blockRedeemForInternalRoutes` (host guard, see below) →
pino-http → `express.json` with **rawBody capture** for HMAC paths (`/api/retell/`, `/api/meta/`,
`/api/integrations/lyfe/`, `/api/external/`) → cookieParser → `/uploads` static → health endpoints →
Swagger (non-prod) → `leadCaptureBind` (attribution cookies) → **route auto-loader** → 404 → Sentry →
`errorHandler`. Then `bootstrapDatabase()` (migrations + seeds + in-process schedulers).

### Route auto-loading + feature flags (`backend/src/routes/index.js`)

Every file in `backend/src/routes/` exporting `meta` **and** a default router is mounted
automatically. `meta` supports `path`, `priority`, multiple `mounts`, and — critically —
**env-flag gating**: `{ path: '/api/external/billing', flag: 'BILLING_ENABLED', flagDefault: 'false' }`
leaves a route **unmounted** until the env var is `"true"` (`backend/src/routes/externalBilling.js:28-32`
is the exemplar). This is the house mechanism for shipping features dark.

### Layering & conventions

- **routes → controllers → services → models.** Controllers are thin
  (`res.status(...).json({ success, message, data })`); services own logic.
- **DI-factory service pattern**: `makeProspectService(overrides)`, `makeLeadCreditsService(overrides)`,
  `makeBillingService(overrides)` — dependencies injected for unit tests, with backward-compatible
  named exports (`backend/src/services/leadCredits.js:10,260`).
- **Validation**: Joi via `validate(schema, options)` middleware; public lead-capture opts into
  `stripUnknown` so contract drift never 400s a lead; internal routes fail loudly
  (`backend/src/middleware/validation.js`).
- **Errors**: `AppError(message, statusCode)` + central `errorHandler`; `asyncHandler` wrapper.
- **Logging**: pino structured logger (`backend/src/utils/logger.js`); Sentry via shared
  `sentryInit.js` with PII scrubbing.
- **OpenAPI**: swagger-jsdoc annotations inline in route files, served at `/api-docs` (non-prod).

### AuthN middleware (`backend/src/middleware/auth.js`)

- `authenticateToken`: reads httpOnly cookie `mktr_token` first, then `Authorization: Bearer`.
  Verifies with local `JWT_SECRET` (24h expiry, `generateToken(userId)`); optional JWKS path
  (`AUTH_JWKS_URL`) exists for the dormant central-auth spike and falls through to legacy.
  Loads `req.user` from `users` and debounces `lastLogin` writes.
- `optionalAuth` (used before the rate limiter so admin bypass can see the role).

### AuthZ middleware

- `requireRole(...roles)` — flat string check against `users.role`
  (`backend/src/middleware/auth.js:142-160`); prebuilt `requireAdmin`, `requireAgentOrAdmin`,
  `requireFleetOwnerOrAdmin`. Roles are the ENUM
  `('admin','agent','fleet_owner','driver_partner','customer')` (`backend/src/models/User.js:47`).
  **There is no capability/permission layer** — authorization is role-list-per-route.
- `prospectScope.js` middleware scopes lead queries by role.
- Server-to-server surfaces use **HMAC**, not JWT: `requireExternalHmac`
  (`EXTERNAL_APP_SECRET`, raw-body signature) on `/api/external/*`; timestamp-signed HMAC on
  `/api/integrations/lyfe/*`; Retell/Meta webhook signatures on their paths.

### Host guard (three-layer brand isolation)

`backend/src/middleware/internalRouteHostGuard.js` returns 403 when the **validated** public host is
redeem.sg for prefixes: `/api/auth`, `/api/admin`, `/api/agents`, `/api/fleet`, `/api/devices`,
`/api/users`, `/api/lyfe`, `/api/mktr-leads`, `/api/webhooks`, `/api/integrations`. Host validation
is allowlist-based in `backend/src/utils/publicHost.js:12-17` (`mktr.sg`, `www.mktr.sg`, `redeem.sg`,
`www.redeem.sg`); unknown hosts (server-to-server) pass through. **Any new internal API namespace
must be added to this blocklist, and any new public subdomain to the allowlist.**

### Background jobs — in-process only (no queue infrastructure)

All recurring work runs inside the single backend instance via `setInterval` in
`backend/src/database/bootstrap.js`: webhook retry recovery (60s), idempotency-key purge (1h),
agent sync from Lyfe + mktr-leads (10m), lead-quota release sweep (2m), Meta redeemed-audience sync
(24h, flag-gated), DNC backfill (30m, flag-gated). Outbound events use the **DB-persisted webhook
engine** (`webhookService.js`: `WebhookSubscriber`/`WebhookDelivery`, HMAC-signed, 3 retries with
backoff, startup recovery, max 3 concurrent). There is no Kafka/RabbitMQ/pg-boss/BullMQ.

### Integrations

`backend/src/integrations/AdapterRegistry.js` + `adapters/` — platform adapters (`lyfe`,
`mktr_leads`) abstract agent sources and webhook destinations. Meta CAPI
(`metaCapiService.js`) and TikTok Events (`tiktokEventsService.js`) fire post-commit,
fire-and-forget from `prospectService`.

## 5. Authentication & sessions — multi-subdomain deep-dive

(Requested explicitly in the Phase 0 addendum.)

- **Login methods** (`backend/src/controllers/authController.js`): email+password (`/api/auth/login`),
  Google Identity Services (`/api/auth/google`, `googleLogin` at line 16, plus OAuth-callback flow),
  registration, and **role-based invites** — `invitationService.sendRoleInvitation` supports
  `agent | fleet_owner | driver_partner` with a token link to `/auth/accept-invite`
  (`backend/src/services/invitationService.js:12`, admin-only `POST /api/users/invite`).
  New users default `approvalStatus='pending'` → frontend routes them to `/PendingApproval`.
- **Session storage**: the JWT is set as **httpOnly cookie `mktr_token`** —
  `secure` (prod), **`SameSite=strict`**, `path=/`, 24h, and **no `Domain` attribute → host-only**
  (`backend/src/utils/authCookie.js:1-9`). The SPA additionally keeps a UI-only
  `'authenticated'` flag + cached user JSON in localStorage (`src/stores/authStore.js:12-16`).
  Bearer-token fallback exists for legacy/localStorage JWTs.
- **How it works per surface today**:
  - **mktr.sg** calls `https://api.mktr.sg/api` **cross-origin** (`VITE_API_URL` absolute) with
    `credentials:'include'`. `api.mktr.sg` and `mktr.sg` share eTLD+1 → SameSite=strict still sends
    the cookie (same-*site*, cross-*origin*), and CORS allows the origin with credentials.
    The cookie itself lives host-only on `api.mktr.sg`.
  - **redeem.sg** uses a **relative `/api`** with a Render edge rewrite to the backend, so requests
    are same-origin in the browser and the cookie is host-only on `redeem.sg`. (Auth routes are
    blocked for redeem.sg by the host guard anyway.)
- **Consequences for new subdomains** (e.g. `ops.redeem.sg`):
  1. Sessions are **naturally per-host** (no shared parent-domain auth cookie) — an ops.redeem.sg
     session cannot leak to redeem.sg or mktr.sg. Staff working across surfaces log in per surface.
  2. The Render-proxy (relative `/api`) pattern gives same-origin auth with zero CORS work; the
     absolute-URL pattern requires adding the origin to the CORS allowlist
     (`backend/src/server_internal.js:70-79`).
  3. `publicHostFromRequest` returns `undefined` for hosts not in the allowlist — host-aware
     branching (cookie domain for *attribution* cookies, email links, host guard) silently falls to
     defaults. **A new public subdomain must be added to `ALLOWED_PUBLIC_HOSTS`** and classified
     (internal vs consumer) in `isRedeemHost`/guard logic deliberately.
  4. `cookieDomainForPublicHost` (parent-domain `.mktr.sg`/`.redeem.sg`) is used only for
     **attribution/session cookies** (`sid`/`atk` via `trackerController.js`/`leadCaptureBind.js`),
     not the auth cookie.
- **Reuse verdict**: the existing identity system supports internal Redeem Ops staff without
  modification to token mechanics. What it lacks is (a) role values for ops staff, (b) any
  fine-grained permission layer, and (c) a separation story for future **external** partner users —
  all addressed in `PERMISSION_MATRIX.md` and `RECOMMENDED_ARCHITECTURE.md`.

## 6. Database

- **Engine**: PostgreSQL on Render (`mktr-db`, `dpg-d2s2h7nfte5s739gnl7g-a`); `pg` + **Sequelize 6**
  (`backend/src/database/connection.js`). One database for everything.
- **Migrations**: custom, minimal runner (`backend/src/database/runMigrations.js`) — tracks applied
  files by name in a `_migrations` table; files run in filename sort order; **up-only** (no down);
  run automatically on boot (`bootstrapDatabase()`) and via `npm run migrate`. Files live in
  `backend/src/database/migrations/` named `NNN-description.js` (**002–044**; the runner discovers
  only `.js` files, so the two stray legacy `.sql` files are ignored). ⚠️
  `044-add-campaign-gift-and-package-recommended.js` is **uncommitted on the current branch** —
  new work must start at 045 and coordinate merge order. Note: the runner does **not** wrap
  migrations in a transaction (`runMigrations.js:52-63` — plain `mod.up()` then a tracking INSERT);
  migration 029's comment claiming an "implicit transaction" is inaccurate.
- **Naming conventions**: snake_case plural table names (`lead_packages`, `qr_tags`,
  `external_agents`); **camelCase column names by default** (Sequelize default, quoted —
  `"createdAt"`, `"leadsRemaining"`); newer columns sometimes snake_case via explicit
  `field:` mapping (`meta_pixel_id`, `gift_name`). UUID v4 primary keys everywhere; timestamps on.
- **Enum strategy drift**: older models use `DataTypes.ENUM`; newer columns deliberately use
  `STRING(n)` + comments/app-level validation (e.g. `Prospect.dncStatus STRING(16)`,
  `quarantineReason STRING(64)`) because enum migrations are painful with the custom runner.
- **Soft deletion**: no `paranoid` mode. Conventions are per-domain: status enums with
  `'archived'` + explicit `permanentDelete` endpoints (campaigns), `isActive` flags (users, QR),
  timestamp markers (`quarantinedAt`, `pending_deletion_at`), and immutable financial rows with
  `ON DELETE SET NULL` + display snapshots (`Payment` — `backend/src/models/Payment.js:4-15`).
- **Auditing**: **no generic audit table.** Existing trails: `prospect_activities`
  (enum `created|assigned|updated|viewed`, actor, metadata JSON), `webhook_deliveries`,
  `payments` (immutable), `qr_scans`/`attributions`/`session_visits` (attribution evidence).
- **Concurrency patterns already proven here** (reuse for claiming/inventory):
  - Atomic counter: `RoundRobinCursor.update({ cursor: literal('"cursor"+1') }, { returning: true })`
    (`backend/src/services/systemAgent.js:153-165`).
  - Single-winner conditional update: `UPDATE external_agents SET "leadBalance"="leadBalance"-:n
    WHERE id=:id AND "leadBalance">=:n RETURNING id` (`backend/src/services/leadCredits.js:156-161`).
  - `FOR UPDATE SKIP LOCKED` CTE pick-and-decrement (`chargeLeadCredit`,
    `backend/src/services/leadCredits.js:206-227`).
  - Idempotency: `IdempotencyKey` table (Retell), unique partial indexes, payment row
    `pending→paid` conditional flip (`billingService.js`).
- **Model inventory** (38): User, Campaign, CampaignAgentAssignment, CampaignMediaItem,
  CampaignPreview, Prospect, ProspectActivity, QrTag, QrScan, Attribution, SessionVisit, ShortLink,
  ShortLinkClick, LeadPackage, LeadPackageAssignment, Payment, Commission, UserPayout, AgentGroup,
  AgentGroupMember, ExternalAgent, ExternalCampaignAgent, RoundRobinCursor, IdempotencyKey,
  Verification, WebhookSubscriber, WebhookDelivery, WaitlistSignup, Car, FleetOwner, Driver,
  Vehicle, Device, DeviceCampaignAssignment, VehicleCampaignAssignment, BeaconEvent, Impression,
  ProvisioningSession, + `index.js` association hub (associations are explicit, with deliberate
  `onDelete` rules — `backend/src/models/index.js:23-166`).

## 7. Deployment

| Service (Render) | Domain | Source | Notes |
|---|---|---|---|
| `mktr-platform` static site (`srv-d2s3che3jp1c738qlgjg`) | mktr.sg | `vite build` with `VITE_BRAND=mktr` (default) | Operator/admin brand; absolute `VITE_API_URL=https://api.mktr.sg/api` |
| `redeem-frontend` static site (`srv-d88qhph9rddc738nk0d0`) | redeem.sg | same commit, `VITE_BRAND=redeem` | Consumer brand; relative `VITE_API_URL=/api` + Render rewrite to backend; 16 edge redirect rules bounce internal paths to mktr.sg |
| `mktr-backend-jo6r` (`srv-d2s9p0emcj7s73acd9lg`) | api.mktr.sg | `node src/server.js` | Single instance; runs migrations on boot; in-process schedulers |

- ⚠️ Provenance: the Render topology above (service names/ids, per-site env, proxy rewrites) is
  **operational knowledge** (Render dashboard/MCP + `CLAUDE.md`), not derivable from source — there
  is no `render.yaml` in the repo. Source evidence covers only the CORS defaults and middleware
  behaviour (`backend/src/server_internal.js:70-128`).
- All three auto-deploy from `main`. Cloudflare fronts both apex domains (`index.html` edge-cached
  ~5 min). Env conventions: `VITE_*` baked at build; backend flags are string `"true"`/`"false"`
  master switches (`WEBHOOK_ENABLED`, `META_CAPI_ENABLED`, `BILLING_ENABLED`, `DNC_API_ENABLED`, …)
  documented in `.env.example`.
- **CI** (`.github/workflows/ci.yml`): backend Jest (unit + integration) against a
  `postgres:15-alpine` service container; npm audit (non-blocking). Known chronically-red suites
  pre-exist on main.
- The `services/` microservices (auth-service, gateway, leadgen-service) and
  `infra/docker-compose.yml` are a **dormant spike** — not deployed; the JWKS branch in
  `middleware/auth.js` is their only production trace. Do not build on them.
- `tablet-app/` is the Android ad-player for in-car tablets (deviceEvents/adtech routes serve it).

## 8. MKTR Campaign System (canonical)

- **Model**: `backend/src/models/Campaign.js` — `campaigns` table. Key fields: `name`, `status`
  ENUM(`draft|active|paused|completed|archived`), `type` ENUM(includes `quiz`), `is_active`,
  `design_config` **JSON blob** (the entire landing-page/designer configuration incl.
  `customerHost` (`redeem|mktr`), `otpChannel`, `sgPrOnly`, quiz config, referral gate),
  `metaPixelId`, `tiktokPixelId`, `externalEligible`, `enforceLeadQuota`, commission amounts, and
  the in-flight gift fields (`giftName`, `giftPriceFromMktr`, `giftNote`, `agentNotes` — migration 044).
- **Service**: `backend/src/services/campaignService.js` — `createCampaign` (line 171),
  `updateCampaign` (236; clamps `design_config.customerHost` via
  `backend/src/utils/customerHost.js`), `setCampaignLaunchState` (311; readiness-gated
  activate/pause), archive/restore/permanentDelete, `duplicateCampaign`,
  `computeCampaignMetrics` (12) and `getCampaignAnalytics` (456) — metrics are **computed, not
  stored**. `campaignReadinessService.js` gates launch.
- **Routes**: `backend/src/routes/campaigns.js` (`/api/campaigns`, role-scoped) and
  `backend/src/routes/adminCampaigns.js` (`/api/admin/campaigns` — launch workspace: delivery pool,
  bulk assign, launch state). Controller: `backend/src/controllers/campaignController.js`.
- **Builder UI**: `src/pages/AdminCampaignForm.jsx` (create/edit),
  `src/pages/AdminCampaignDesigner.jsx` (landing-page designer writing `design_config`),
  `src/pages/AdminCampaignWorkspace.jsx` (unified launch workspace), listing in
  `src/pages/AdminCampaigns.jsx`; designer components under `src/components/campaigns/`.
- **Public URL generation**: customer links are host-aware helpers in `src/lib/brand.js:37-81`
  (`resolveCustomerHost`, `customerLeadCaptureUrl`, `customerPreviewUrl`, `publicTrackingUrl`,
  `publicShareUrl`); QR images bake the host at generation
  (`backend/src/services/qrCodeService.js:128-134` + `QrTag.targetHost`); short links + `/t/:slug`
  tracker redirects (`trackerController.js`, `shortlinkService.js`).
- **Landing page rendering**: `src/pages/LeadCapture.jsx` (+ `src/components/campaigns/…`,
  quiz components) reads the campaign's `design_config` client-side; preview via
  `/p/:slug` (`campaignPreviewService.js`).
- **Tracking**: browser pixels `src/lib/metaPixel.js` / `src/lib/tiktokPixel.js`
  (suppression in `src/lib/pixelSuppression.js`); server CAPI `backend/src/services/metaCapiService.js`
  and `tiktokEventsService.js`; down-funnel outcomes via `/api/integrations/lyfe/lead-outcome`
  (`leadOutcomeService.js`) and the external buyer path (`externalLeadOutcomeService.js`).
- **Reporting**: `dashboardService.js`, `analyticsService.js`, `quizAnalyticsService.js`,
  `agentLeaderboardService.js`; frontend `src/hooks/queries/useDashboardQuery.js`.

## 9. MKTR Lead System (canonical)

- **Model**: `backend/src/models/Prospect.js` — `prospects` table. Identity (name/email/phone
  E.164), `leadSource` ENUM(`qr_code|website|referral|social_media|advertisement|direct|call_bot|other`),
  `leadStatus` ENUM(`new|contacted|qualified|proposal_sent|negotiating|won|lost|nurturing`),
  `priority`, `campaignId` FK, `assignedAgentId` FK (users), `externalAgentId` FK (external_agents,
  mutually exclusive), `qrTagId`/`attributionId`/`sessionId` (attribution),
  `sourceMetadata` JSON (utm/fbclid/ttclid/referral evidence), `consentMetadata` JSONB
  (third-party-disclosure consent; `.external` gates buyer delivery), quarantine
  (`quarantinedAt`/`quarantineReason`), DNC columns (`dncStatus`, register flags, `dncMetadata`).
- **Creation flow**: `POST /api/prospects` (public, Joi `stripUnknown`) →
  `backend/src/controllers/prospectController.js` → `makeProspectService().createProspect`
  (`backend/src/services/prospectService.js:127` — 2,489 lines). In order: consent flags captured →
  per-campaign duplicate gate (pre-check on `(campaignId, phone)` → **409** with canonical share
  link; nuance: a request that loses a concurrent-insert race instead hits the DB unique index —
  migration 010 — and surfaces as a generic **400** via the global unique-violation mapping,
  `errorHandler.js:48-55`) → quiz scoring (server-verified) → routing
  (`systemAgent.js:resolveLeadRouting` / cross-pool `resolveLeadAssignment`: self → admin-explicit →
  QR-assigned → package round-robin → external buyer ring → System-Agent fallback or **quarantine**
  under `enforceLeadQuota`/no-funded-buyer/DNC-pending) → credit charge (`leadCredits.js`) → single
  transaction commit → **service-level post-commit fan-out**: `dispatchEvent('lead.created'|'lead.held')`
  webhooks, Meta CAPI + TikTok events (`prospectService.js` ~843–930). Assignment + lead
  confirmation emails fire afterwards from the **controller**, not the service
  (`prospectController.js:58-72`; `mailer.js` brand-aware by campaign `customerHost`).
- **OTP**: `POST /api/verify/send` / `/check` (`backend/src/routes/verify.js`, rate-limited 10/15min)
  → `backend/src/services/verificationService.js` — AWS SNS SMS (SSIR sender "MKTR") or WhatsApp
  (Meta Graph, per-campaign `design_config.otpChannel`), 6-digit code in `verifications` table
  (PK=phone, 10-min TTL, max 5 attempts, single-use). ⚠️ **Finding**: OTP is orchestrated by the
  SPA *before* submit; `POST /api/prospects` does **not** itself demand proof of verification —
  only the DNC consent-gate flow consumes the short-lived verified-phone marker
  (`verifiedPhoneStore.js`). Server-side phone possession is therefore a UX gate, not an API
  invariant.
- **Consent storage**: `consent_contact`/`consent_terms`/`consent_third_party`/`consent_dnc` from the
  form → `sourceMetadata` + `consentMetadata` (server-controlled; client cannot inject —
  stripUnknown). External-delivery consent logic in `backend/src/services/externalConsent.js`;
  DNC gate in `dncGate.js`/`dncConsent.js`.
- **Attribution**: QR scan → `/t/:slug` (`trackerController.js`) sets `sid`/`atk` cookies
  (host-aware domains) → `leadCaptureBind.js` binds session → `attributions` row (first/last touch,
  `qr_scans`, `session_visits`) → `prospect.attributionId`; ad-click ids (`fbclid`→`_fbc`,
  `ttclid`) captured client-side and threaded through; source labeling in
  `backend/src/utils/sourceLabel.js` + `src/lib/agentSource.js`.
- **Duplicate prevention**: per-campaign unique partial index on `(campaignId, phone)` (409 at
  capture); Retell idempotency via `idempotency_keys` + unique `retellCallId`; cross-campaign
  repeat-signup **detection** (read-time admin flag, never blocks) in
  `backend/src/services/repeatSignup.js` backed by migration 039 indexes.
- **Assignment/routing**: `backend/src/services/systemAgent.js` (round-robin cursor, per-campaign
  in-process queue), lead packages (`lead_packages` + `lead_package_assignments.leadsRemaining`
  credits), quota gate `leadQuota.js` + `chargeLeadCredit`, held-queue release sweep
  (`releaseSweep.js`), bulk ops (`prospectService` bulk assign/return-to-held/delete).
- **Delivery**: webhook engine → Lyfe Supabase edge function and/or mktr-leads app (destination-aware
  subscribers, `bootstrap.js:195-298`); `lead.deleted` propagation.
- **Reporting**: `prospects/stats/overview`, dashboard queries, `webLeadTimelineService.js`
  (per-lead timeline merging app + web activities).

## 10. Existing "Redeem" implementation (what the word means in this repo today)

| Artifact | What it is | Where |
|---|---|---|
| `redeem` brand build | Consumer skin of the same SPA (lead-capture only), served at redeem.sg | `src/lib/brandConfigs/redeem.js`, `vite.config.js` |
| `RedeemPlaceholder.jsx` | Minimal apex `/` page on the redeem build | `src/pages/RedeemPlaceholder.jsx` |
| Per-campaign customer host | Campaign chooses redeem.sg vs mktr.sg for its public links (`design_config.customerHost`, QR `targetHost`) | `src/lib/brand.js`, `backend/src/utils/customerHost.js`, migration 037 |
| Host guard / brand isolation | redeem.sg cannot reach internal APIs/routes | `backend/src/middleware/internalRouteHostGuard.js`, `src/components/auth/BrandRouteGuards.jsx` |
| `redeemedAudienceService.js` | Meta customer-list **ad exclusion** sync ("already redeemed" = already submitted a lead) | `backend/src/services/redeemedAudienceService.js` |
| Campaign "gift" (migration 044, uncommitted) | Store-catalog fields: a physical gift the **buying agent purchases from MKTR** to hand to the prospect. Not a partner reward, no inventory, no entitlement, no redemption | `backend/src/models/Campaign.js:186-211`, `backend/src/services/billingService.js:49-61` |
| "$20 voucher" et al. | Marketing copy in campaign content and consent dialog | `src/components/legal/MarketingConsentDialog.jsx`, `src/pages/LeadCaptureDemo.jsx` |

**Conclusion**: partner organisations, partner CRM, reward offers, reward inventory, activations,
entitlements, and redemptions are **greenfield domains**. Nothing needs migrating; nothing risks
duplication except the *concepts* around campaigns/leads, which stay canonical in MKTR.

## 11. Test infrastructure

- **Backend**: Jest 29 (`backend/jest.config.js` — `maxWorkers: 1` against a real Postgres,
  `test/setup.js` env). ~40 unit suites in `backend/test/`, 7 integration suites in
  `backend/test/integration/` (incl. `pipelineE2E.test.js`, `agentAssignment.test.js`,
  `leadCreditScoping.test.js` — concurrency-style tests exist as precedent). Route tests use
  supertest; services tested via DI factories.
- **Frontend**: Vitest + Testing Library (`src/**/__tests__/`); Playwright e2e in `e2e/`.
- **Local note**: running backend tests needs a local Postgres + `JWT_SECRET`; ~5 suites are
  chronically red on main (documented, inherited).

## 12. Key findings & constraints that shape Redeem Ops

1. **One backend, one DB, one SPA, three deploys** — the cheapest correct integration is inside
   this monolith, exposed as a new surface, not a new system.
2. **Route flags are the house dark-launch mechanism** — Redeem Ops can mount everything behind
   `REDEEM_OPS_ENABLED` with zero risk to production.
3. **Auto-loader constraints**: route files must sit flat in `backend/src/routes/`; model files flat
   in `backend/src/models/`. Services/controllers may nest (`services/email-templates/` precedent).
4. **RBAC is coarse** (role-list per route). Redeem Ops needs sub-roles/capabilities — additive,
   without touching the shared `users.role` semantics that agent-sync, routing, and billing rely on
   (`role='agent'` is load-bearing in `systemAgent.js`, `agentSyncService.js`, `billingService.js`).
5. **No generic audit infrastructure** — Redeem Ops must bring its own append-only audit table
   (pattern precedent: `prospect_activities` + immutable `payments`).
6. **Concurrency-safe primitives already exist and are tested** — claiming, pool-next, and
   inventory must use the conditional-UPDATE / SKIP LOCKED patterns, not app-level checks.
7. **No queue infra; in-process schedulers are the norm** — stale-claim sweeps etc. follow
   `bootstrap.js` patterns; do not introduce brokers.
8. **Auth cookie is host-only, SameSite=strict** — new subdomains get isolated sessions for free;
   the Render-proxy relative-`/api` pattern avoids CORS entirely. New public hosts must be added to
   `ALLOWED_PUBLIC_HOSTS` and the host guard deliberately.
9. **Migration numbering starts at 045** (044 is uncommitted on `feat/campaign-store-catalog`).
10. **users table is synced/swept by external sources** — Lyfe + mktr-leads agent sync
    creates/deactivates/deletes `role='agent'` rows on timers. New staff roles must be outside that
    blast radius (they are, as long as their `role` ≠ `agent` and they carry no `lyfeId`/`mktrLeadsId`).
