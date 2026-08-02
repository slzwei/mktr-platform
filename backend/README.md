# MKTR Backend API

The Express/Node.js monolith behind every MKTR surface. It captures leads (QR / campaign page / Retell voice bot), screens them, assigns them to agents via package-funded round-robin, and delivers them to the Lyfe and mktr-leads apps through HMAC-signed webhooks. It also serves the Campaign Studio, the redeem.sg marketplace and draw engine, and Redeem Ops. This is **the live system** — the `services/` microservices scaffold one level up was never wired into production.

> For the product overview and system topology, see [`../README.md`](../README.md). For the authoritative architecture reference (table ownership, Lyfe/Supabase contract, Meta Ads topology, full env matrix), see [`../CLAUDE.md`](../CLAUDE.md). This file is the backend-specific reference.

## Stack

- **Node.js ≥ 18** (CI on 20), **Express 5.2**, ES modules
- **PostgreSQL** via **Sequelize 6.35** (`pg` 8.11) — Postgres-only; `connection.js` requires `DB_HOST` and enables SSL in production (`DB_SSL` / `DB_CA_CERT` to tune)
  - `pg-hstore` looks unimported but is REQUIRED: Sequelize's postgres dialect `require()`s it at runtime (`sequelize/lib/dialects/postgres/hstore.js`) — removing it breaks boot. Do not "clean it up".
- **Pino** structured logging (`pino-http`) · **Sentry** (`@sentry/node`, tagged `service: mktr-backend`)
- **JWT** (`jsonwebtoken`) + **Google OAuth** (`google-auth-library`) · **bcryptjs** · **jose** (JWKS)
- **Joi** validation (`middleware/validation.js`) · **Helmet** · **express-rate-limit** · **compression** · **cookie-parser** · **CORS**
- **Nodemailer** (email) · **qrcode** (QR generation) · **AWS SDK v3** (S3 + SNS)
- **Swagger** (`swagger-jsdoc` + `swagger-ui-express`) — served at `/api-docs` in non-production only
- **Jest** + **supertest** tests · local **load harness** in `load/`

## Quick start

### Prerequisites
- Node.js 18+
- A reachable **PostgreSQL** instance (the server refuses to boot without `DB_HOST`)

### Run with Docker (Postgres included)
```bash
docker-compose up        # or: npm run docker:run
```
The API listens on `http://localhost:3001` (health at `/health`, docs at `/api-docs`).

### Run locally against your own Postgres
```bash
cp env.example .env      # then edit DB_*, JWT_SECRET, etc.
npm install
npm run dev              # nodemon (or: npm start for production mode)
```
Migrations run automatically on boot. To run them explicitly: `npm run migrate`. In `NODE_ENV=test` the schema is force-synced first, then migrations layer on top.

## How it boots

A deliberate **two-stage "Shell" boot** keeps the service healthy on Render even if app init is slow or fails:

1. **`src/server.js` (Shell)** — initializes Sentry, then *immediately* binds `PORT` and serves `/health` (`mode: "shell"`). It dynamically imports `server_internal.js` and calls `init(app)`. If init throws, the shell **stays listening** so logs remain reachable instead of crash-looping.
2. **`src/server_internal.js`** — builds the middleware stack (requestId → Helmet → compression → CORS → rate limiter → `internalRouteHostGuard` → Pino → body parsing with **raw-body capture** for `/api/retell/`, `/api/integrations/lyfe/`, `/api/external/` and `/api/whatsapp/` → cookie-parser → `/uploads` static → health → Swagger → `leadCaptureBind` → auto-loaded routes → error handlers).
3. **`src/database/bootstrap.js`** — validates env, connects, runs migrations, then idempotently seeds the **System Agent**, the **Lyfe** + **mktr-leads** webhook subscribers, and the **`[Retell]` campaigns**. It recovers pending webhook retries, reconciles suppression propagation, sweeps stale email broadcasts, and ensures draw records.

It then schedules the recurring in-process jobs (all skipped under `NODE_ENV=test`):

| Job | Interval |
|---|---|
| Webhook retry recovery | 60 s |
| Held-lead release sweep (no-op while auto-release is off) | 2 min |
| Screening sweep — stale calls, TTL, drains, due re-dials | `SCREENING_SWEEP_INTERVAL_MINUTES` (default 5 min) |
| Email-broadcast stale sweep | 5 min |
| Discover run reconcile (`DISCOVERY_ENABLED`) | 5 min, plus once ~45 s after boot |
| Agent sync — Lyfe then mktr-leads (`SYNC_AGENT_CRON`) | 10 min |
| Redeem Ops fulfilment sweep | 15 min |
| Redeem Ops stale sweep + cadence reconcile | 30 min |
| Idempotency-key purge · suppression-propagation backstop · draw-record backstop | hourly |
| Enrichment scoring sweep (`ENRICHMENT_SCORING_ENABLED`) — fenced to one real run per SGT date by `enrichment_sweep_runs` | hourly, first ~150 s after boot |
| Redemption CAPI reconciliation | 6 h |
| Redeemed-audience sync to Meta | `REDEEMED_AUDIENCE_SYNC_INTERVAL_HOURS` (default 24 h) |
| DNC backfill (`DNC_BACKFILL_ENABLED`) · Discover retention purge | `DNC_BACKFILL_INTERVAL_MINUTES` · daily |

These are in-process timers, not a durable queue — a restart loses in-flight `setTimeout` retries. The 60 s webhook recovery poll mitigates but doesn't eliminate that.

> **Held leads are manual-only.** `releaseSweep.sweepAll()` still runs on its 2-minute timer but returns immediately: `AUTO_RELEASE_ENABLED = false` in `services/releaseSweep.js`. A held lead is assigned by an admin from the dispatch queue — nothing releases it on a credit top-up. The FIFO drain-on-top-up mechanics remain in the file only in case that switch is flipped back.

### Auto-discovered routes
Routes are not registered by hand. Each file in `src/routes/` exports a descriptor:
```js
export const meta = { path: '/api/foo', flag: 'FEATURE_X', flagDefault: 'true', priority: 0 };
// or multiple mounts:
export const meta = { mounts: [{ path: '/api/foo' }, { path: '/api/leadgen/foo', flag: 'ENABLE_DOMAIN_PREFIXES' }] };
```
`loadRoutes()` (`src/routes/index.js`) scans the directory, sorts by `priority`, skips flag-disabled mounts, and mounts the rest.

## API surface

Base URL: `https://api.mktr.sg/api` (prod) · `http://localhost:3001/api` (dev). All protected routes take `Authorization: Bearer <jwt>` (the same JWT is also set in an httpOnly cookie).

**Lead pipeline & campaigns**
- `POST /api/prospects` (public lead capture) · `/api/prospects/*` (list / assign / bulk-assign / stats)
- `/api/campaigns` · `/api/admin/campaigns` (Studio writes) · `/api/previews`
- `/api/qrcodes` (+ public `GET /api/qrcodes/track/:slug`) · `/api/shortlinks` (+ public `/share/*`)
- `/api/lead-packages` · `/api/admin/wallets` · `/api/commissions`
- `/api/verify` (OTP) · `/api/dnc` · `/api/contact` · `/api/waitlist`

**People, consent & marketing**
- `/api/consumers` (people directory + person journey) · `/api/cohorts` · `/api/email-broadcasts`
- `/api/consent-copy/:version` · public `/api/unsubscribe`

**Marketplace, rewards & draws**
- `/api/marketplace` — public listings (`MARKETPLACE_PUBLIC_API_ENABLED`)
- `GET /api/reward-claim/:token` — public voucher / draw-pass claim (`REDEEM_OPS_ENTITLEMENTS_ENABLED`)
- `/api/screening-callback/:token` — public screening callback opt-in

**Redeem Ops** (`REDEEM_OPS_ENABLED`, plus per-feature flags)
- `/api/redeem-ops/*` — partners, work/tasks, rewards, activations, fulfilment, discovery, cadences, analytics, admin

**Agents & identity**
- `/api/auth` (login, Google OAuth, invites, profile) · `/api/users` · `/api/agents` · `/api/admin/agent-groups`
- `/api/lyfe` (Lyfe agent sync) · `/api/mktr-leads` (mktr-leads agent invite/activate/edit)
- `/api/admin/ai` — AI provider settings + generation

**Inbound integration webhooks** (raw-body, HMAC-verified)
- `POST /api/retell/webhook`
- `POST /api/integrations/lyfe/lead-outcome` · `/users-webhook` · entitlement unlock
- `POST /api/whatsapp/webhook` (+ `GET` for Meta's subscribe handshake)
- `/api/external/*` — mktr-leads broker surfaces (wallet, billing, packages, held leads, lead activities/outcomes), each behind its own flag
- `/api/admin/webhooks` (outbound subscriber CRUD + delivery / dead-letter admin)

**Dashboards & ops**
- `/api/dashboard` · `/api/analytics` · `/api/notifications` · `/api/uploads`

**Retired — fleet / DOOH** (2026-07-15; still mounted, some flag-gated)
- `/api/devices`, `/api/devices/events` (SSE), `/api/vehicles`, `/api/fleet`, `/api/provision`, `/api/apk`, `/api/adtech/*` (`MANIFEST_ENABLED` / `BEACONS_ENABLED`, default off)

**Health & docs**
- `GET /health` · `GET /health/public-host` (host-detection diagnostic) · `GET /health/sync` (per-adapter sync freshness)
- `GET /api-docs` (Swagger UI, non-prod) · a Postman collection lives at [`postman-collection.json`](./postman-collection.json)

## Auth & roles

- **JWT** Bearer tokens (also an httpOnly cookie). `optionalAuth` decodes early so the rate limiter can exempt admins; `authenticateToken` enforces.
- Role guards (`middleware/auth.js`): `requireRole(...roles)`, `requireAdmin`, `requireAgentOrAdmin`, `requireFleetOwnerOrAdmin`.
- Roles: **`admin`**, **`agent`**, **`redeem_ops`**, **`customer`**, plus the retired **`fleet_owner`** / **`driver_partner`** (new users default to `customer` / `approvalStatus: pending`). `redeem_ops` is deliberately invisible to every `requireRole` gate, to agent-sync sweeps, and to lead routing.
- Redeem Ops adds a second axis: `users.redeemOpsRole` ∈ `super_admin | ops_admin | bdm | outreach_exec | campaign_ops | redemption_ops | analyst`, checked as capabilities in `middleware/redeemOpsAuth.js` (`role='admin'` is an implicit super-admin).

## Request validation (the idiom for new code)

**New/changed body-carrying routes validate at the route layer with a Joi schema
passed to the shared `validate()` from `middleware/validation.js`** — never a
locally re-implemented middleware (two such copies were deleted in P4-6):

- **Route-local schema + shared `validate()`** is the default: declare the
  `Joi.object` next to the router that uses it (the `adminAi.js` / `contact.js`
  / `waitlist.js` shape). Colocation keeps the contract next to the endpoint.
- The **central registry** (`schemas.*` in `middleware/validation.js`) is the
  legacy home used by `auth` / `campaigns` / `prospects` / `qrcodes` /
  `users` / `agents`. Add to it only when a schema is genuinely shared by
  multiple routers; don't migrate existing entries just to move them.
- `validate(schema, { stripUnknown: true })` is for **public** endpoints where
  contract drift must drop keys rather than 400 a customer (lead capture,
  contact, waitlist). Internal/admin routes omit it so stale clients fail loudly.
- The **redeemOps\*** and **external\*** families validate inside their
  controllers/services (capability gates + service-level checks). That is an
  accepted second idiom for those slices — keep new endpoints there consistent
  with their neighbours rather than importing the registry.
- Migration path for the remainder (route files with no route-layer validation
  whose controllers also don't validate): add a route-local schema **when a
  route is next touched**, matching what the real frontend caller sends — no
  big-bang conversion.

## Data model

The backend owns its **own** PostgreSQL database (separate from Lyfe's Supabase) — 90 Sequelize models in `src/models/` with associations in `src/models/index.js`, and 92 migrations under `src/database/migrations/`.

Pipeline-central: `User`, `Prospect`, `ProspectActivity`, `Campaign`, `LeadPackage` / `LeadPackageAssignment`, `RoundRobinCursor`, `WalletLedger`, `Payment`, `QrTag` / `QrScan`, `ShortLink`, `Attribution`, `ExternalAgent` / `ExternalCampaignAgent`, `WebhookSubscriber` / `WebhookDelivery`, `IdempotencyKey`.

Person spine & consent: `Consumer`, `ConsentEvent`, `ConsumerSuppression`, `SuppressionPropagation`, `Cohort`, `EmailBroadcast` / `EmailBroadcastRecipient`.

Enrichment & scoring: `ConsumerObservation` (append-only fact ledger), `ConsumerProfile` (resolved view + `meetScore` / `buyScore` / `consumerScore` + breakdown), `EnrichmentJob` (mapper outbox), `EnrichmentScoringConfig` (weights / groups / target segments), `EnrichmentSweepRun` (per-SGT-date sweep fence). The scoring math is pure and lives in `utils/consumerScoring.js` — see the [README section](../README.md#lead-scoring--meet--buy).

Rewards, draws & Redeem Ops: `RewardOffer` / `RewardEntitlement` / `Redemption`, `Activation`, `Draw` / `DrawEntry` / `DrawAttempt` / `DrawBoostReview` / `DrawTermsVersion`, the `Partner*` / `Outreach*` / `Discovery*` families.

Retired but still in the schema: `Device`, `Vehicle`, `Car`, `FleetOwner`, `Driver`, `BeaconEvent`, `Impression`, `ProvisioningSession`, `Commission`. See [`../README.md`](../README.md#-data-model) for the annotated breakdown.

## Environment variables

[`env.example`](./env.example) is the annotated source of truth — every var the server reads is in it, grouped and commented. The frontend's `VITE_*` vars live in [`../.env.example`](../.env.example). Highlights:

| Group | Vars |
|---|---|
| Core | `NODE_ENV`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `TRUST_PROXY` |
| Database | `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`, `DB_SSL`, `DB_CA_CERT` |
| Auth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| AI drafting | `AI_SETTINGS_ENCRYPTION_KEY` (required for admin-entered keys); optional server-managed `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Hosts | `CORS_ORIGIN`, `PUBLIC_BASE_URL`, `MKTR_FRONTEND_URL`, `REDEEM_FRONTEND_URL` |
| Webhooks | **`WEBHOOK_ENABLED`** (must be `"true"` to deliver leads) |
| Lyfe | `LYFE_WEBHOOK_URL`, `LYFE_WEBHOOK_SECRET`, `LYFE_SUPABASE_URL`, `LYFE_SUPABASE_SERVICE_ROLE_KEY`, `LYFE_USERS_WEBHOOK_SECRET`, `LYFE_LEAD_OUTCOME_SECRET` |
| mktr-leads | `MKTR_LEADS_SUPABASE_URL`, `MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY`, `MKTR_LEADS_WEBHOOK_URL`, `MKTR_LEADS_WEBHOOK_SECRET`, `MKTR_LEADS_INVITE_SECRET` (all optional) |
| Retell | `RETELL_WEBHOOK_SECRET`, `RETELL_API_KEY`, `RETELL_AGENTS`, `RETELL_CAMPAIGN_MAP` |
| Meta | `META_CAPI_ENABLED`, `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE`; `META_EVENT_QUALIFIED`, `META_EVENT_WON`, `META_EVENT_REDEEMED` |
| TikTok | `TIKTOK_EVENTS_API_ENABLED`, `TIKTOK_PIXEL_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_TEST_EVENT_CODE` |
| Retell screening | `RETELL_SCREENING_ENABLED`, `RETELL_SCREENING_AGENT_ID`, `RETELL_SCREENING_FROM_NUMBER`, `SCREENING_*` (attempts, window, concurrency, TTL, alerts) |
| OTP | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SNS_SENDER_ID`; `SNS_AWS_ACCESS_KEY_ID` / `SNS_AWS_SECRET_ACCESS_KEY` (preferred SNS-only pair — set both or neither); `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`. The WhatsApp OTP channel is chosen per campaign by `design_config.otpChannel`, not by an env var. |
| Enrichment | `ENRICHMENT_MAP_ARTIFACT_JOBS`, `ENRICHMENT_SCORING_ENABLED` |
| SMS caps (SSIR) | `SMS_DAILY_CAP_PER_PHONE` (7), `SMS_DAILY_GLOBAL_CAP` (500), `SMS_DAILY_ALERT_THRESHOLD` (250), `SMS_ALERT_EMAIL`, `SMS_QUOTA_SALT` — guard the registered `MKTR` sender ID; see `docs/reference/sms-sender-id-compliance.md` |
| WhatsApp sends | `REDEEM_OPS_WHATSAPP_ENABLED`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_*` — **a different credential pair from the `META_WA_*` OTP set above** |
| WhatsApp webhook | `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (**prod fails closed without it**), `WHATSAPP_WABA_ID` |
| Campaign Studio | `DESIGN_CONFIG_V2_WRITES_ENABLED` — v2 writes are rejected until this is `"true"` |
| Marketplace | `MARKETPLACE_PUBLIC_API_ENABLED`, `MARKETPLACE_INHERIT_ENABLED`, `MARKETPLACE_QR_REDIRECT_ENABLED` |
| Draws | `DRAW_RECORD_AUTOCREATE_ENABLED`, `DRAW_BOOST_AUTOPROVISION_ENABLED`, `DRAW_BOOST_DEFAULT_ALLOCATION` |
| Redeem Ops | `REDEEM_OPS_ENABLED`, `REDEEM_OPS_ENTITLEMENTS_ENABLED`, `REDEEM_OPS_CADENCES_ENABLED`, `DISCOVERY_ENABLED`, `APIFY_TOKEN` (+ the `DISCOVERY_*` quota block) |
| External broker | `EXTERNAL_APP_SECRET`, `EXTERNAL_OUTCOME_WEBHOOK_SECRET`, `AGENT_WALLET_ENABLED`, `BILLING_ENABLED`, `HITPAY_*`, and the five `*_EXTERNAL_ENABLED` route flags |
| DNC | `DNC_API_ENABLED`, `DNC_BASE_URL`, `DNC_ORG_CODE`, `DNC_ESERVICE_ID`, `DNC_PRIVATE_KEY`, `DNC_ENFORCEMENT`, `DNC_HTTPS_PROXY`, `DNC_BACKFILL_*`, `DNC_HOURLY_BUDGET` |
| Storage | `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_REGION`, `DO_SPACES_ENDPOINT`, `DO_SPACES_BUCKET`, `DO_SPACES_CDN_BASE`, `MAX_UPLOAD_SIZE_MB` |
| Email | `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD`, `EMAIL_FROM_MKTR`, `EMAIL_FROM_REDEEM`, `WAITLIST_NOTIFY_EMAIL`, `EMAIL_BROADCAST_*` |
| Consent | `UNSUB_TOKEN_SECRET`, `API_PUBLIC_ORIGIN` |
| System Agent | `SYSTEM_AGENT_EMAIL`, `SYSTEM_AGENT_REDIRECT_EMAIL`, `DEFAULT_AGENT_ID` |
| Attribution | `ATTRIB_SECRET`, `IP_HASH_SALT` (both **required in production** — `envValidation.js` throws without them) |
| Crons / flags | `SYNC_AGENT_CRON`, `ENABLE_DOMAIN_PREFIXES`, `MANIFEST_ENABLED`, `BEACONS_ENABLED`, `RATE_LIMIT_*` |
| Observability | `SENTRY_DSN`, `OBS_SAMPLE_RATE`, `LOG_LEVEL` |

> **OTP is AWS SNS + Meta WhatsApp Cloud API — not Twilio.** (Earlier docs referenced Twilio; that is no longer accurate.)

## Scripts

```bash
npm start            # production server (node src/server.js)
npm run dev          # nodemon
npm test             # Jest (NODE_OPTIONS=--experimental-vm-modules)
npm run migrate      # run pending migrations and exit
npm run seed         # seed sample data        ·  npm run seed:fleet
npm run load:smoke   # local load harness      ·  :spike / :stress / :soak / :rr
npm run docker:build / docker:run / docker:down
```

## Testing

- **Jest + supertest** — service/unit specs in `src/tests/`, route/integration specs in `test/` (incl. `test/integration/` and `test/migrations/`).
- **CI** (`../.github/workflows/ci.yml`) runs the **Backend Tests** job on Node 20 against a Postgres 15 service container with `NODE_ENV=test` (force-syncs the schema, then applies migrations), in four passes:
  1. `--testPathPattern="test/unit/"`
  2. integration — `test/integration/` plus the top-level `test/*.test.js`
  3. `test/migrations`
  4. a coverage run over unit + integration

  `npm audit --audit-level=high --production` runs non-blocking. Two sibling jobs cover the frontend (Vitest + `vite build`) and lint (ESLint over `src/` and `backend/src/`).
- Locally, tests need a reachable Postgres and an inline `JWT_SECRET`; without them some suites fail on `ECONNREFUSED` (environmental, not a regression).

### Lead-capture stress harness
`./stress-test.sh` generates/cleans realistic test prospects (tagged for safe cleanup):
```bash
./stress-test.sh run 1000     # generate 1000 test leads
./stress-test.sh preview      # preview cleanup
./stress-test.sh cleanup      # remove all test leads
```
See [`STRESS-TEST-README.md`](./STRESS-TEST-README.md) and [`STRESS-TEST-QUICK-START.md`](./STRESS-TEST-QUICK-START.md).

## Deployment

Runs on **Render** (Singapore) as the `mktr-backend-jo6r` web service behind `api.mktr.sg`, serving `/api/*` and `/uploads/*` for all three static sites (`mktr.sg`, `redeem.sg`, `ops.redeem.sg`). A `Dockerfile` and `docker-compose.yml` are provided for container builds. Migrations apply automatically on boot.

## Security

- JWT auth with role-based access control; `internalRouteHostGuard` rejects admin/auth/agent API calls arriving with a `redeem.sg` public-host signature.
- Inbound webhooks are verified over the raw body: HMAC-SHA256 for Retell (`body + timestamp`), the Lyfe lead-outcome / users channels and the `/api/external/*` broker routes; `X-Hub-Signature-256` for the Meta WhatsApp status webhook. Outbound webhooks are HMAC-signed with per-subscriber secrets.
- Helmet, CORS allowlist (mktr.sg / redeem.sg apex + www), production rate limiting (admins and `/api/integrations/lyfe/*` exempt), Joi input validation, Sequelize parameterization, SVG uploads forced to download.
- Sentry scrubbing (`utils/sentryScrub.js`) and PII hashing (`utils/piiHashing.js`).

---

*MKTR PTE. LTD. (UEN 202507548M) · Singapore · Proprietary & Confidential.*
