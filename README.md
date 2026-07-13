# MKTR Platform — Lead-Generation Pipeline

**MKTR captures qualified insurance leads across Singapore (QR codes, web forms, Retell AI voice calls, Meta/TikTok lead ads), assigns each lead to an agent via package-funded round-robin, and delivers it in seconds to the agent's app through HMAC-signed webhooks.**

The platform is a single Express/Node.js backend (PostgreSQL + Sequelize) plus a React/Vite SPA that builds into **two brands from one codebase** — `mktr.sg` (the operator/admin console) and `redeem.sg` (the customer-facing lead-capture site). Leads flow outward to two downstream agent apps — **Lyfe** (the insurance agency's mobile app) and **mktr-leads** (a second, external agent team) — selected per-agent at delivery time.

> ℹ️ **Scope note.** This repository also contains a **DOOH (Digital-Out-Of-Home) tablet/fleet subsystem** — an Android player app, device provisioning, OTA APK hosting, and ad-beacon/manifest APIs. That subsystem is **paused as of 2026-05-09** (see [`tablet-app/PAUSED.md`](tablet-app/PAUSED.md)). Its backend routes still exist behind feature flags but receive no new development. The lead-generation pipeline is the active product. See [Paused subsystems](#-paused-subsystems) below.

For the authoritative, deep architecture reference (table ownership, the Lyfe/Supabase contract, Meta Ads account topology, env matrix), read [`CLAUDE.md`](CLAUDE.md). This README is the orientation entry point.

---

## 📋 Table of contents

- [What the platform does](#-what-the-platform-does)
- [System topology](#-system-topology)
- [The two-brand frontend](#-the-two-brand-frontend-mktrsg--redeemsg)
- [The lead pipeline](#-the-lead-pipeline)
- [Integrations](#-integrations)
- [Tech stack](#-tech-stack)
- [Repository layout](#-repository-layout)
- [Data model](#-data-model)
- [Backend API surface](#-backend-api-surface)
- [Roles & access control](#-roles--access-control)
- [Local development](#-local-development)
- [Environment variables](#-environment-variables)
- [Scripts](#-scripts)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [How the server boots](#-how-the-server-boots)
- [Paused subsystems](#-paused-subsystems)
- [Further documentation](#-further-documentation)

---

## 🎯 What the platform does

1. **Capture** a lead from any of several sources:
   - A prospect scans a **QR code** (`redeem.sg/t/{slug}`) → redirected to a campaign's lead-capture form.
   - A prospect submits the **web lead-capture form** on `redeem.sg/LeadCapture?campaign_id={id}` (optionally gated by a **quiz** funnel and a self-declared **SG Citizen/PR** screening card).
   - A **Retell AI voice bot** finishes a call → posts a signed webhook → MKTR creates the lead.
   - A **Meta (Facebook/Instagram) Lead Ad** form is submitted → Meta webhook → MKTR ingests it.

2. **Assign** the lead to an agent using a deterministic priority ladder (self → admin-pick → QR owner → lead-package round-robin → System Agent fallback), gated by a **lead-quota / prepaid-credit** system so agents only receive leads they have funded.

3. **Deliver** the lead to the correct downstream app. Each agent carries a provenance (`lyfeId` *or* `mktrLeadsId`); the **destination-aware webhook dispatcher** routes `lead.created` / `lead.assigned` / `lead.unassigned` events to **Lyfe** or **mktr-leads** accordingly, HMAC-signed, with retries and a dead-letter queue.

4. **Track conversions** back to the ad platforms: browser **Meta Pixel** + server-side **Conversions API (CAPI)** and **TikTok Events API** fire `ViewContent` / `CompleteRegistration` / `Lead`. A **down-funnel reverse path** lets Lyfe report `qualified` / `won` outcomes back to MKTR, which fires `ConfirmedResident` / `ClosedWon` conversion events to Meta (back-dated within Meta's 7-day window).

5. **Operate** the whole thing from the `mktr.sg` admin console: campaign designer, QR/short-link generation, agent roster (across both agent sources), lead-package allocation, prospect management, commissions, dashboards, and webhook delivery monitoring.

---

## 🗺 System topology

Three Render services are deployed from this one repository (two static sites + one backend), feeding two external Supabase-backed apps:

```
┌───────────────────────────── MKTR Platform (this repo, on Render) ─────────────────────────────┐
│                                                                                                 │
│   redeem.sg                          mktr.sg                                                     │
│   (redeem-frontend Static Site)      (mktr-platform Static Site)                                 │
│   VITE_BRAND=redeem                   VITE_BRAND=mktr                                             │
│   Customer lead-capture only          Operator/admin console + marketing pages                   │
│        │                                   │                                                     │
│        └──────────────┬────────────────────┘   both proxy /api/* and /uploads/* →               │
│                       ▼                                                                          │
│            ┌──────────────────────────┐                                                          │
│            │  api.mktr.sg             │  Single Express monolith (backend/)                      │
│            │  mktr-backend-jo6r       │  PostgreSQL + Sequelize · Pino · Sentry                  │
│            └─────────┬────────────────┘                                                          │
│   Retell AI ─webhook─▶│  POST /api/retell/webhook                                                │
│   Meta Lead Ads ─────▶│  POST /api/meta/*                                                        │
│   QR / Web form ─────▶│  POST /api/prospects                                                     │
│                       │                                                                          │
│   ┌───────────────────┴──────────── outbound, destination-aware, HMAC-signed ───────────────┐   │
│   │  lead.created / lead.assigned / lead.unassigned                                          │   │
│   └──────────────┬──────────────────────────────────────────┬───────────────────────────────┘   │
└──────────────────┼──────────────────────────────────────────┼───────────────────────────────────┘
                   ▼                                            ▼
   ┌──────────────────────────────┐              ┌──────────────────────────────┐
   │  Lyfe (insurance agency app) │              │  mktr-leads (2nd agent team) │
   │  Supabase Edge Function       │              │  Supabase Edge Function       │
   │  receive-mktr-lead            │              │  receive-mktr-lead            │
   │  → leads → push notification  │              │  → leads → push notification  │
   └──────────────────────────────┘              └──────────────────────────────┘
        ▲  agent sync (pull, every 10 min)              ▲  agent sync (pull) + admin invite/manage
        └────────── mktr-agents EF ──────────┘          └────────── agents PostgREST ───────────┘
```

Agents are **mirrored into the backend's local `users` table** from both downstream apps so round-robin can route to either pool. Mirroring is pull-based (a 10-minute cron) plus a push webhook from Lyfe (`/api/integrations/lyfe/users-webhook`) that closes the polling lag for activations/deactivations.

---

## 🎨 The two-brand frontend (`mktr.sg` + `redeem.sg`)

The same React SPA in `src/` builds into two Render Static Sites from the same git commit, branched by the `VITE_BRAND` env var. This is an **operator-vs-customer split, not a rebrand** — both brands coexist permanently.

| Render service | Domain | `VITE_BRAND` | Audience |
|---|---|---|---|
| `mktr-platform` | `mktr.sg`, `www.mktr.sg` | `mktr` (default) | **Operator.** Admin/agent/driver/fleet/PA console, campaign designer, QR generation, agent groups, marketing pages, staff login. |
| `redeem-frontend` | `redeem.sg`, `www.redeem.sg` | `redeem` | **Customer.** Lead-capture forms only. Apex `/` shows a minimal `RedeemPlaceholder`. (A service of MKTR PTE. LTD., UEN 202507548M.) |

**How brand isolation works** ([`vite.config.js`](vite.config.js), [`src/lib/brand.js`](src/lib/brand.js)):

- `vite.config.js` reads `VITE_BRAND` at config time and aliases `@brand-config` → `src/lib/brandConfigs/mktr.js` or `redeem.js`. The inactive brand's strings (wordmark, regulatory copy, hosts) are tree-shaken out of `dist/`.
- Components read `brand` from `@/lib/brand`. Brand-aware values include `name`, `wordmark`, `legalName`, `uen`, `publicHost`, logos/favicons, PDPA URLs, and the `show*` route gates (`showHomepage`, `showAbout`, …).
- **Customer-facing URL helpers are host-aware** (default `redeem.sg`, per-campaign `mktr.sg` via `resolveCustomerHost(campaign.design_config.customerHost)`), so the admin's "Copy Link"/QR/preview surfaces produce a clean link on the campaign's chosen host with no redirect hop: `customerPublicUrl(path, host?)`, `customerLeadCaptureUrl(campaignId, params?, host?)`, `customerPreviewUrl(slug, host?)`, `publicTrackingUrl(slug, host?)`, `publicShareUrl(slug, host?)`. The QR tracker / lead-capture redirect on `mktr.sg` was removed 2026-06-17 so mktr-hosted campaigns serve the SPA directly.
- **Internal routes are `mktr.sg`-only**, enforced at three layers: Render edge redirect rules on `redeem-frontend`; SPA-level `MktrOnlyRedirect` (on the redeem build, `ProtectedRoute` is replaced wholesale so admin/auth UI never renders); and the backend `internalRouteHostGuard` which 403s `/api/auth/*`, `/api/admin/*`, `/api/agents/*`, etc. when the validated public host is `redeem.sg`.
- `vite.config.js` also emits a brand-aware `robots.txt` + `sitemap.xml` per build (public routes only; admin/auth disallowed).

The single backend serves both origins and branches behavior per request via `backend/src/utils/publicHost.js` (`publicHostFromRequest`, allowlisted to the four apex+www hosts) — driving cookie-domain selection, per-host redirect base (`frontendBase.js`), CAPI `event_source_url` alignment, and `EMAIL_FROM` selection.

---

## 🔄 The lead pipeline

### Capture → assign → deliver

```
POST /api/prospects (or Retell/Meta webhook)
  → prospectService.createProspect()
      ├─ resolve attribution (session cookie `sid` → QR scan → campaign)
      ├─ validate (unique phone per campaign, age gate, consent)
      ├─ resolve agent (systemAgent.resolveLeadRouting / resolveLeadAssignment)
      ├─ charge a lead credit  (leadQuota.decideAssignment → leadCredits.chargeLeadCredit)
      │     └─ if no funded agent on a quota campaign → QUARANTINE (held, undelivered)
      ├─ fire Meta CAPI `Lead` (+ `CompleteRegistration` if quiz revealed) and TikTok events
      └─ dispatch `lead.created` webhook  (webhookService.dispatchEvent, post-commit)
            └─ destination-aware: routed to Lyfe or mktr-leads by the agent's provenance
```

### Agent assignment priority (`systemAgent.js`)

`resolveLeadRouting()` returns `{ agentId, via }` by walking this ladder:

1. **Self** — requester is an `agent` (quota-exempt).
2. **Admin-explicit** — admin passed a valid `requestedAgentId` (quota-exempt).
3. **QR direct** — the QR tag has an `assignedAgentId` / legacy `ownerUserId` (quota-gated).
4. **Lead-package round-robin** — per-campaign `RoundRobinCursor` (monotonic counter, modulo-at-read) over active agents holding a `LeadPackageAssignment` with `leadsRemaining > 0` (quota-gated). Serialized per-campaign in-process to survive concurrent webhook bursts.
5. **System Agent fallback** — `system@mktr.local` (quota-gated → quarantine on hard-quota campaigns).

`resolveLeadAssignment()` extends this with a **unified ring** that mixes internal agents and external **mktr-leads buyers** (prepaid `ExternalAgent.leadBalance`) for campaigns flagged `externalEligible`, with consent gating.

### Lead-quota / credit system

- `Campaign.enforceLeadQuota` turns delivery into a hard gate: a lead is delivered only if a credit was charged; otherwise it is **quarantined** (`quarantinedAt`, `quarantineReason='no_funded_agent'`).
- `chargeLeadCredit()` is authoritative (atomic FIFO decrement of the oldest active `LeadPackageAssignment` for that campaign, `FOR UPDATE SKIP LOCKED`, falling back to `users.owed_leads_count`). `deductLeadCredit()` is the best-effort, never-throws variant for exempt routes.
- `releaseSweep.sweepAll()` drains held queues FIFO when an agent's package is topped up (fired inline on top-up, plus a 2-minute safety-net cron). Releasing a held lead fires its first `lead.created` delivery.

### Outbound webhook delivery (`webhookService.js`)

- Events: **`lead.created`**, **`lead.assigned`**, **`lead.unassigned`**.
- **Destination-aware:** subscribers are tagged `metadata.destination` (`lyfe` | `mktr_leads`); a lead is delivered only to the subscriber matching its agent's provenance (null-destination agents like System Agent are default-denied).
- **Signing:** `X-Webhook-Signature` = HMAC-SHA256 of the body, plus `X-Webhook-Event`, `X-Webhook-Delivery-Id`, `X-Webhook-Timestamp`.
- **Reliability:** 10s timeout, 3 attempts with exponential backoff (1s/4s/16s), auto-disable after 50 consecutive failures, in-process concurrency cap of 3 with backpressure, a queryable **dead-letter queue**, and startup + 60s recovery of stranded/pending retries.
- **Global switch:** `WEBHOOK_ENABLED` must be `"true"` or no leads leave the backend (the boot sequence logs a warning if a destination URL is set while the switch is off).

The two Lyfe / mktr-leads webhook **subscribers are auto-registered/reconciled on every boot** from the adapter env (`bootstrap.js`).

---

## 🔌 Integrations

| Integration | Direction | Where | Notes |
|---|---|---|---|
| **Retell AI** voice bot | inbound webhook | `routes/retell.js`, `retellService.js` | HMAC-SHA256 (`x-retell-signature: v=<ts>,d=<hex>`). Idempotent per `call_id` (24h TTL). Sentiment → priority. Resolves/auto-creates `[Retell] {name}` campaigns. Recording URLs fetched + cached on demand. |
| **Meta Lead Ads** | inbound webhook | `routes/meta.js`, `metaLeadService.js` | Ingests FB/IG instant-form leads (verify-token handshake + signed payloads). |
| **Meta Pixel + CAPI** | outbound | `src/lib/metaPixel.js`, `metaCapiService.js` | Browser Pixel + server CAPI with shared `event_id` for dedup; `_fbc`/`_fbp` capture. Suppressed on preview/demo/test routes. |
| **Meta down-funnel CAPI** | inbound→outbound | `routes/lyfeLeadOutcome.js`, `leadOutcomeService.js` | Lyfe agent advances a lead → HMAC POST `/api/integrations/lyfe/lead-outcome` → fires `ConfirmedResident` (on `qualified`) / `ClosedWon` (on `won`), back-dated, mark-on-success, dedup by deterministic `event_id`. |
| **TikTok Events API** | outbound | `src/lib/tiktokPixel.js`, `tiktokEventsService.js` | Mirrors the Meta CAPI pattern (`ttclid`/`ttp`); per-campaign `tiktokPixelId` override. |
| **Lyfe (Supabase)** | outbound webhook + agent sync | `integrations/adapters/lyfe/`, `routes/lyfe.js`, `routes/lyfeUsersWebhook.js` | Leads delivered to the `receive-mktr-lead` EF; agents mirrored from the `mktr-agents` EF (pull) and a `users` push webhook. |
| **mktr-leads (Supabase)** | outbound webhook + agent sync + admin mgmt | `integrations/adapters/mktr-leads/`, `routes/mktrLeadsAgents.js`, `mktrLeadsAgentManagementService.js` | Second agent source; admins can invite/activate/deactivate/edit mktr-leads agents from the MKTR dashboard. Sync mirrors `is_active` and owns profile fields. |
| **AWS SNS** | outbound | `verificationService.js` | SMS OTP for lead-capture phone verification. |
| **Meta WhatsApp Cloud API** | outbound | `verificationService.js` | WhatsApp OTP (alternative channel; `WHATSAPP_PROVIDER=meta`). |
| **AWS S3 / DigitalOcean Spaces** | outbound | `services/storage.js` | QR PNGs, campaign media, uploads (falls back to local disk if unconfigured). |
| **Google OAuth** | inbound | `authController.js` | Staff Google sign-in (`/auth/google/callback`). |
| **Sentry** | outbound | backend + frontend | Error tracking; backend tags `service: mktr-backend`. |

> The agent-sync layer uses a small **adapter pattern** (`backend/src/integrations/`): `AdapterRegistry` + a `PlatformAdapter` contract, with `LyfeAdapter` and `MktrLeadsAdapter` implementations. New downstream apps (HubSpot, Salesforce, …) can be added by registering another adapter.

---

## 🛠 Tech stack

### Frontend (`src/`) — React SPA → two static sites

- **React 18.2** + **Vite 6.1**, **React Router DOM 7.2**
- **Tailwind CSS 3.4** + **Radix UI** primitives + **lucide-react** icons + **framer-motion**
- **TanStack Query 5** (server state) + **Zustand 5** (auth store)
- **React Hook Form 7** + **Zod 3** validation
- **Sentry** (`@sentry/react`), **Sonner** toasts, **Recharts**, **jsPDF**, **@dnd-kit** (designer drag-drop), **DOMPurify**
- **Vitest 4** + Testing Library; **Playwright** E2E (`e2e/`)
- ESLint 9 + Prettier 3, Husky + lint-staged

### Backend (`backend/`) — Express monolith

- **Node.js ≥ 18** (CI on 20), **Express 5.2**, ES modules
- **Sequelize 6.35** over **PostgreSQL** (`pg` 8.11; the connection layer is Postgres-only and requires `DB_HOST`)
- **Pino** structured logging (`pino-http`), **Sentry** (`@sentry/node`)
- **JWT** (`jsonwebtoken`) + **Google OAuth** (`google-auth-library`), **bcryptjs**
- **Joi** validation, **Helmet**, **express-rate-limit**, **compression**, **cookie-parser**, **CORS**
- **Nodemailer** (email), **qrcode** (QR generation), **AWS SDK v3** (S3 + SNS), **jose** (JWKS)
- **Swagger** (`swagger-jsdoc` + `swagger-ui-express`, non-prod only at `/api-docs`)
- **Jest** + **supertest** tests; a local **load harness** (`backend/load/`)

---

## 📂 Repository layout

```
mktr-platform/
├── src/                      # React SPA (builds to mktr.sg AND redeem.sg via VITE_BRAND)
│   ├── pages/                # ~55 route pages (Admin*, Agent*, Driver*, Fleet*, LeadCapture, marketing, legal)
│   │   └── index.jsx         #   the router (public / auth / role-gated routes)
│   ├── components/           # campaigns (designer), prospects, agents, qrcodes, lead-packages,
│   │                         #   fleet, devices, onboarding, homepage, legal, auth, ui (Radix)
│   ├── api/                  # API client + Base44-style entity classes
│   ├── lib/                  # brand.js, brandConfigs/{mktr,redeem}.js, metaPixel.js, tiktokPixel.js
│   ├── hooks/ services/ stores/ schemas/ utils/ design/ constants/
│   └── main.jsx App.jsx index.css
│
├── backend/                  # Express monolith (the live system)
│   └── src/
│       ├── server.js         # "Shell" boot: listen immediately, then load app logic
│       ├── server_internal.js# real app init: middleware stack, health, route auto-loader
│       ├── routes/           # auto-discovered route modules (export `meta`)
│       ├── controllers/      # request handlers
│       ├── services/         # business logic (prospect, webhook, systemAgent, leadQuota, meta/tiktok CAPI, …)
│       ├── models/           # ~38 Sequelize models + index.js (associations)
│       ├── middleware/       # auth, internalRouteHostGuard, prospectScope, validation, tenant, …
│       ├── integrations/     # adapter registry + Lyfe / mktr-leads adapters
│       ├── database/         # connection, bootstrap, runMigrations, migrations/ (35), seed
│       ├── utils/ config/ schemas/ scripts/ tests/
│       └── uploads/          # local asset storage (dev / fallback)
│
├── tablet-app/               # ⏸ PAUSED — Android (Kotlin/Compose) DOOH player
├── services/                 # ⏸ PAUSED — microservices scaffold (gateway, auth, leadgen)
├── infra/                    # ⏸ docker-compose for the paused microservices stack
├── e2e/                      # Playwright end-to-end tests
├── dist/ public/             # build output / static assets
├── docs/                     # audit/, plans/, design notes
├── CLAUDE.md                 # 👉 authoritative architecture reference
├── TRACKER.md                # feature matrix + bug log + priority queue
├── vite.config.js            # brand-aware build (VITE_BRAND, @brand-config, robots/sitemap)
└── package.json              # frontend scripts (backend has its own)
```

---

## 🗃 Data model

The backend owns its **own PostgreSQL database** (Sequelize), separate from Lyfe's Supabase. ~38 models; the ones central to the lead pipeline:

**Identity & agents**
- `User` — local identity. Roles: `admin`, `agent`, `fleet_owner`, `driver_partner`, `customer`. Carries provenance (`lyfeId` **xor** `mktrLeadsId`, enforced by a DB CHECK), `external_role`, `approvalStatus`, `isActive`, `owed_leads_count`, two-phase-delete `pending_deletion_at`.
- `ExternalAgent` — mktr-leads buyers, kept **separate** from `users` so agent-sync never touches them. Prepaid global `leadBalance`; `ExternalCampaignAgent` maps eligibility to campaigns.
- `AgentGroup` / `AgentGroupMember` — round-robin pools attached to QR tags.
- `UserPayout` — payout method per user.

**Leads**
- `Prospect` — the lead record. `leadSource` / `leadStatus` / `priority` enums, scoring, JSON `demographics`/`budget`/`consentMetadata`/`sourceMetadata`, `retellCallId`, and the routing state: `assignedAgentId` **xor** `externalAgentId`, plus `quarantinedAt` / `quarantineReason`.
- `ProspectActivity` — audit trail. `Attribution` / `SessionVisit` — QR-scan → session → lead attribution chain.

**Campaigns**
- `Campaign` — `type` (`lead_generation` | `brand_awareness` | `product_promotion` | `event_marketing` | `quiz`), `status`, `design_config` (form/quiz JSON), `min_age`/`max_age`, `metaPixelId`/`tiktokPixelId`, and the routing gates `enforceLeadQuota` + `externalEligible`.
- `CampaignMediaItem`, `CampaignPreview`, `CampaignAgentAssignment`.

**Credits & commissions**
- `LeadPackage` / `LeadPackageAssignment` (the prepaid quota an agent consumes), `RoundRobinCursor` (per-campaign rotation pointer), `Commission`.

**QR & links**
- `QrTag` (slug, `agentAssignmentMode` direct|round_robin, denormalized assigned-agent fields), `QrScan`, `ShortLink`, `ShortLinkClick`.

**Webhooks & dedup**
- `WebhookSubscriber` (with `metadata.destination`), `WebhookDelivery` (retry/DLQ state), `IdempotencyKey`.

**Verification & misc**
- `Verification` (OTP), `WaitlistSignup` (homepage pre-launch capture, isolated from the pipeline).

**Fleet / DOOH (paused subsystem):** `Device`, `Vehicle`, `Car`, `FleetOwner`, `Driver`, `DeviceCampaignAssignment`, `VehicleCampaignAssignment`, `BeaconEvent`, `Impression`, `ProvisioningSession`.

---

## 🌐 Backend API surface

Routes are **auto-discovered**: each file in `backend/src/routes/` exports `meta = { path, flag?, flagDefault?, priority?, mounts? }`, and `loadRoutes()` mounts them (sorted by priority, skipping flag-disabled routes). Base URL: `https://api.mktr.sg/api` (prod) or `http://localhost:3001/api` (dev).

**Lead pipeline & marketing**
- `POST /api/prospects` — lead capture (public); `/api/prospects/*` — list/assign/bulk-assign/stats (auth)
- `/api/campaigns`, `/api/previews` — campaigns + public preview snapshots
- `/api/qrcodes` (+ `GET /api/qrcodes/track/:slug`), `/api/shortlinks` (+ public `/share/*`)
- `/api/lead-packages`, `/api/commissions`
- `/api/contact`, `/api/waitlist`, `/api/verify` (OTP)

**Agents & identity**
- `/api/auth` (login, Google OAuth, invites, profile), `/api/users`
- `/api/agents`, `/api/admin/agent-groups`
- `/api/lyfe` (Lyfe agent sync), `/api/mktr-leads` (mktr-leads agent admin)

**Inbound integration webhooks** (raw-body HMAC-verified)
- `POST /api/retell/webhook` · `/api/meta/*` · `/api/integrations/lyfe/lead-outcome` · `/api/integrations/lyfe/users-webhook`
- `/api/admin/webhooks` — outbound subscriber CRUD + delivery/DLQ admin

**Dashboards & ops**
- `/api/dashboard`, `/api/analytics`, `/api/notifications`, `/api/uploads`

**Fleet / DOOH (paused, flag-gated)**
- `/api/devices`, `/api/devices/events` (SSE), `/api/vehicles`, `/api/fleet`, `/api/provision`, `/api/apk`
- `/api/adtech/*` — manifest (`MANIFEST_ENABLED`) + beacons (`BEACONS_ENABLED`), default off in `env.example`

**Health & docs**
- `GET /health` · `GET /health/public-host` (host-detection diagnostic) · `GET /health/sync` (per-adapter sync freshness)
- `GET /api-docs` — Swagger UI (non-production only)

Setting `ENABLE_DOMAIN_PREFIXES=true` additionally mounts domain-namespaced mirrors (`/api/leadgen/*`, `/api/adtech/*`, `/api/admin/*`, `/api/fleet/*`).

---

## 🔐 Roles & access control

- Auth is **JWT** (Bearer token; also set in an httpOnly cookie). `optionalAuth` decodes the token early so the rate limiter can exempt admins.
- `requireRole(...roles)` gates routes; convenience guards: `requireAdmin`, `requireAgentOrAdmin`, `requireFleetOwnerOrAdmin`.
- Roles: **`admin`** (full console), **`agent`** (own leads/commissions), **`fleet_owner`**, **`driver_partner`**, **`customer`**. New users default to `customer` / `approvalStatus: pending` and are held at `/PendingApproval` until approved.
- On the SPA, `ProtectedRoute` enforces auth + role + approval, and `getDefaultRouteForRole()` lands each role on its home dashboard. On the `redeem` build, protected routes hard-redirect to `mktr.sg`.

---

## 💻 Local development

### Prerequisites
- **Node.js 18+** (CI uses 20) & npm
- **PostgreSQL 14+** (required — the backend refuses to start without `DB_HOST`; a local instance via Docker is fine)

### 1. Install
```bash
git clone https://github.com/slzwei/mktr-platform.git
cd mktr-platform

npm install                 # frontend deps
cd backend && npm install   # backend deps
cd ..
```
(There is also a convenience [`setup-backend.sh`](setup-backend.sh).)

### 2. Configure
```bash
cp .env.example .env                 # frontend (VITE_*) — see env table below
cp backend/env.example backend/.env  # backend (DB, JWT, integrations)
```
At minimum the backend needs `JWT_SECRET` and a reachable PostgreSQL database (`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`). Everything integration-related (Retell, Meta, Lyfe, mktr-leads, webhooks) is **optional and off by default** — the app boots without it.

### 3. Run
```bash
# Terminal 1 — backend (http://localhost:3001, health at /health, docs at /api-docs)
cd backend
npm run dev        # nodemon

# Terminal 2 — frontend (http://localhost:5173)
npm run dev
```
To run the SPA as the customer brand locally: `VITE_BRAND=redeem npm run dev`.

The backend runs migrations automatically on boot (and, in `NODE_ENV=test`, syncs the schema first).

---

## ⚙️ Environment variables

**Frontend (`.env`, build-time, all `VITE_`-prefixed):**

| Var | Purpose |
|---|---|
| `VITE_BRAND` | `mktr` (default) or `redeem` — selects the brand config + SEO files |
| `VITE_API_URL` | Backend base. Prod: `https://api.mktr.sg/api` (mktr) or `/api` (redeem, via Render rewrite) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client (must match backend `GOOGLE_CLIENT_ID`) |
| `VITE_META_PIXEL_ID` / `VITE_META_TEST_EVENT_CODE` | Browser Meta Pixel (public id; test code on staging only) |
| `VITE_TIKTOK_PIXEL_ID` / `VITE_TIKTOK_TEST_EVENT_CODE` | Browser TikTok Pixel |
| `VITE_SENTRY_DSN` | Frontend error tracking (optional) |

**Backend (`backend/.env`):**

| Group | Vars |
|---|---|
| Core | `NODE_ENV`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `TRUST_PROXY` |
| Database | `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` (PostgreSQL; `DB_SSL`, `DB_CA_CERT` for managed providers) |
| Auth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| AI drafting | `AI_SETTINGS_ENCRYPTION_KEY` (required for admin-entered keys); optional server-managed `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Hosts | `CORS_ORIGIN`, `PUBLIC_BASE_URL` (QR-encoded host), `MKTR_FRONTEND_URL`, `REDEEM_FRONTEND_URL` |
| Rate limit | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` |
| Email | `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD`, `EMAIL_FROM_MKTR`, `EMAIL_FROM_REDEEM` |
| Retell | `RETELL_WEBHOOK_SECRET`, `RETELL_API_KEY`, `RETELL_AGENTS`, `RETELL_CAMPAIGN_MAP` |
| Webhooks | **`WEBHOOK_ENABLED`** (must be `"true"` to deliver leads) |
| Lyfe | `LYFE_WEBHOOK_URL`, `LYFE_WEBHOOK_SECRET`, `LYFE_SUPABASE_URL`, `LYFE_SUPABASE_SERVICE_ROLE_KEY`, `LYFE_USERS_WEBHOOK_SECRET` |
| mktr-leads | `MKTR_LEADS_SUPABASE_URL`, `MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY`, `MKTR_LEADS_WEBHOOK_URL`, `MKTR_LEADS_WEBHOOK_SECRET`, `MKTR_LEADS_INVITE_SECRET` (all optional; unset = inert) |
| Meta CAPI | `META_CAPI_ENABLED`, `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE` |
| Meta Lead Ads | `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN` |
| Down-funnel CAPI | `LYFE_LEAD_OUTCOME_SECRET`, `META_EVENT_QUALIFIED`, `META_EVENT_WON` |
| TikTok | `TIKTOK_EVENTS_API_ENABLED`, `TIKTOK_PIXEL_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_TEST_EVENT_CODE` |
| OTP | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SNS_SENDER_ID`; `WHATSAPP_PROVIDER`, `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_BUSINESS_ACCOUNT_ID` |
| Storage | `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_REGION`, `DO_SPACES_ENDPOINT`, `DO_SPACES_BUCKET`, `DO_SPACES_CDN_BASE` |
| System Agent | `SYSTEM_AGENT_EMAIL`, `SYSTEM_AGENT_REDIRECT_EMAIL`, `DEFAULT_AGENT_ID` |
| Attribution | `ATTRIB_SECRET`, `IP_HASH_SALT` (required in prod) |
| Crons | `SYNC_AGENT_CRON` (default on) |
| DOOH (paused) | `MANIFEST_ENABLED`, `BEACONS_ENABLED`, `MANIFEST_RPS_PER_DEVICE`, `BEACON_RPS_PER_DEVICE`, `BEACON_IDEMP_WINDOW_MIN`, `ENABLE_DOMAIN_PREFIXES` |
| Observability | `SENTRY_DSN`, `OBS_SAMPLE_RATE` |

See `.env.example` and `backend/env.example` for the annotated, copy-pasteable source of truth.

---

## 📜 Scripts

**Frontend (root `package.json`):**
```bash
npm run dev        # Vite dev server (VITE_BRAND=redeem npm run dev for the customer brand)
npm run build      # production build → dist/
npm run preview    # preview the production build
npm run lint       # ESLint
npm run test       # Vitest (run once)   ·   npm run test:watch
npm run analyze    # build + bundle treemap (dist/stats.html)
```

**Backend (`backend/package.json`):**
```bash
npm run dev        # nodemon
npm start          # node src/server.js (production)
npm test           # Jest (set JWT_SECRET; some suites need local Postgres)
npm run migrate    # run migrations explicitly
npm run seed       # seed sample data   ·   npm run seed:fleet
npm run load:smoke # local load harness (also :spike / :stress / :soak / :rr)
npm run docker:build / docker:run / docker:down
```

A standalone stress-test harness for the lead-capture path lives at `backend/stress-test.sh` (see `backend/STRESS-TEST-README.md`).

---

## 🧪 Testing

- **Backend:** Jest + supertest (`backend/src/tests/`, `backend/test/`). CI (`.github/workflows/ci.yml`) spins up a Postgres 15 service container and runs the unit suite on Node 20 with `NODE_ENV=test` (which force-syncs the schema before layering migrations). `npm audit` runs non-blocking.
- **Frontend:** Vitest + Testing Library (`src/**/*.{test,spec}.{js,jsx}`), jsdom environment, v8 coverage.
- **E2E:** Playwright specs in `e2e/` (`playwright.config.js`).

> Some backend suites require a reachable Postgres and inline `JWT_SECRET`; without them a handful fail on `ECONNREFUSED` — that's environmental, not a regression.

---

## 🚀 Deployment

Production runs on **Render** (Singapore region) as three services from this repo:

- **`mktr-platform`** Static Site → `mktr.sg` (`VITE_BRAND=mktr`, absolute `VITE_API_URL=https://api.mktr.sg/api`).
- **`redeem-frontend`** Static Site → `redeem.sg` (`VITE_BRAND=redeem`, relative `VITE_API_URL=/api`; Render rewrites `/api/*` → `api.mktr.sg`).
- **`mktr-backend-jo6r`** Web Service → `api.mktr.sg` (the Express monolith). A `Dockerfile` + `docker-compose.yml` are also provided in `backend/`.

Both static sites proxy `/api/*` and `/uploads/*` to the single backend, so campaigns/agents/leads/round-robin have one source of truth regardless of which brand the traffic came from. DNS for `redeem.sg` is managed at Cloudflare; full env/DNS details are in [`CLAUDE.md`](CLAUDE.md).

---

## 🧬 How the server boots

The backend uses a deliberate **two-stage "Shell" boot** for resilience on Render:

1. **`server.js` (Shell)** — initializes Sentry, then *immediately* binds the port and serves a `/health` endpoint (`mode: "shell"`) so the platform's health check passes even while the app is still loading. It then dynamically `import()`s `server_internal.js` and calls `init(app)`. If app initialization throws, the shell **stays listening** so logs remain reachable instead of crash-looping.
2. **`server_internal.js`** — builds the real middleware stack: `requestId` → Helmet → compression (skips SSE) → CORS (mktr.sg/redeem.sg allowlist) → rate limiter (prod only, admins and `/api/integrations/lyfe/*` exempt) → `internalRouteHostGuard` → Pino HTTP logging → JSON/urlencoded body parsing (capturing **raw body** for `/api/retell`, `/api/meta`, `/api/integrations/lyfe`) → cookie-parser → `/uploads` static → health endpoints → Swagger (non-prod) → `leadCaptureBind` → **`loadRoutes()`** (auto-discovery) → `/t/:slug` fallback → `notFound` → Sentry → `errorHandler`.
3. **`bootstrapDatabase()`** — validates env, connects, runs migrations, then idempotently seeds runtime data: the **System Agent**, the **Lyfe** and **mktr-leads** webhook subscribers (reconciled from adapter env), and the **`[Retell]` campaigns**. It recovers pending webhook retries, then schedules recurring jobs: webhook recovery (60s), idempotency-key purge (hourly), **agent sync** for Lyfe + mktr-leads (10 min), and the **held-lead release sweep** (2 min).

---

## ⏸ Paused subsystems

These exist in the tree and are wired up, but are **paused (since 2026-05-09)** and receive no active development. Don't delete without checking with the owner.

- **`tablet-app/`** — a real Android (Kotlin/Jetpack Compose) DOOH player (ExoPlayer playback, GPS, QR provisioning, heartbeat/impression workers). See [`tablet-app/PAUSED.md`](tablet-app/PAUSED.md). The backend still serves the APIs it consumed: `apk.js` (self-hosted OTA "latest-only" APK), `provisioning.js` (QR device onboarding), `adtechManifest.js` (playlist/manifest), `adtechBeacons.js` (heartbeats/impressions), `deviceEvents.js` (SSE) — all behind `MANIFEST_ENABLED` / `BEACONS_ENABLED`, default off.
- **`services/` + `infra/`** — a microservices migration scaffold (`gateway` :4000, `auth-service` :4001, `leadgen-service`) with a docker-compose stack. **Never wired into production** — the live system is the `backend/` monolith. See [`services/PAUSED.md`](services/PAUSED.md); [`README-dev.md`](README-dev.md) retains the scaffold's run instructions under a clearly-marked "paused" section.

The admin console still exposes the fleet/device/driver pages (`AdminFleet`, `AdminDevices`, `AdminVehicles`, `AdminApkManager`, `ProvisionDevice`, `DriverDashboard`, `FleetOwnerDashboard`, …); they are functional but secondary to the lead-gen product.

---

## 📚 Further documentation

- **[`CLAUDE.md`](CLAUDE.md)** — the authoritative architecture reference: two-brand internals, the Lyfe/Supabase contract, Meta Ads account topology, down-funnel CAPI design, and the full env matrix.
- **[`TRACKER.md`](TRACKER.md)** — feature matrix, severity-ranked bug log, priority queue.
- **`docs/plans/`** — implementation plans & runbooks (Meta tracking, the production lead-pipeline runbook, down-funnel outcome webhook SQL, quiz funnel phases).
- **`docs/audit/`** — subsystem audits (auth, routes, manifest, beacons, leadgen, compose).
- **[`backend/README.md`](backend/README.md)** — backend-specific reference (boot model, route auto-discovery, API surface, env, testing).
- **[`README-dev.md`](README-dev.md)** — hands-on developer quickstart (running both brands, common tasks, hitting the API).

---

*MKTR PTE. LTD. (UEN 202507548M) · Singapore · Proprietary & Confidential.*
