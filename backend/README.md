# MKTR Backend API

The Express/Node.js monolith that powers the MKTR lead-generation pipeline. It captures leads (QR/web/Retell/Meta), assigns them to agents via package-funded round-robin, and delivers them to the Lyfe and mktr-leads apps through HMAC-signed webhooks. This is **the live system** — the `services/` microservices scaffold one level up is paused.

> For the product overview and system topology, see [`../README.md`](../README.md). For the authoritative architecture reference (table ownership, Lyfe/Supabase contract, Meta Ads topology, full env matrix), see [`../CLAUDE.md`](../CLAUDE.md). This file is the backend-specific reference.

## Stack

- **Node.js ≥ 18** (CI on 20), **Express 5.2**, ES modules
- **PostgreSQL** via **Sequelize 6.35** (`pg` 8.11) — Postgres-only; `connection.js` requires `DB_HOST` and enables SSL in production (`DB_SSL` / `DB_CA_CERT` to tune)
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
2. **`src/server_internal.js`** — builds the middleware stack (requestId → Helmet → compression → CORS → rate limiter → `internalRouteHostGuard` → Pino → body parsing with **raw-body capture** for `/api/retell`, `/api/meta`, `/api/integrations/lyfe` → cookie-parser → `/uploads` static → health → Swagger → `leadCaptureBind` → auto-loaded routes → error handlers).
3. **`src/database/bootstrap.js`** — validates env, connects, runs migrations, then idempotently seeds the **System Agent**, the **Lyfe** + **mktr-leads** webhook subscribers, and the **`[Retell]` campaigns**. It recovers pending webhook retries and schedules recurring jobs: webhook recovery (60s), idempotency-key purge (hourly), **agent sync** (10 min), and the **held-lead release sweep** (2 min).

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

**Lead pipeline & marketing**
- `POST /api/prospects` (public lead capture) · `/api/prospects/*` (list / assign / bulk-assign / stats)
- `/api/campaigns`, `/api/previews` · `/api/qrcodes` (+ `GET /api/qrcodes/track/:slug`) · `/api/shortlinks` (+ public `/share/*`)
- `/api/lead-packages` · `/api/commissions` · `/api/contact` · `/api/waitlist` · `/api/verify` (OTP)

**Agents & identity**
- `/api/auth` (login, Google OAuth, invites, profile) · `/api/users` · `/api/agents` · `/api/admin/agent-groups`
- `/api/lyfe` (Lyfe agent sync) · `/api/mktr-leads` (mktr-leads agent invite/activate/edit)

**Inbound integration webhooks** (raw-body, HMAC-verified)
- `POST /api/retell/webhook` · `/api/meta/*` (Meta Lead Ads) · `/api/integrations/lyfe/lead-outcome` · `/api/integrations/lyfe/users-webhook`
- `/api/admin/webhooks` (outbound subscriber CRUD + delivery / dead-letter admin)

**Dashboards & ops**
- `/api/dashboard` · `/api/analytics` · `/api/notifications` · `/api/uploads`

**Fleet / DOOH (paused subsystem, flag-gated)**
- `/api/devices`, `/api/devices/events` (SSE), `/api/vehicles`, `/api/fleet`, `/api/provision`, `/api/apk`, `/api/adtech/*` (`MANIFEST_ENABLED` / `BEACONS_ENABLED`, default off)

**Health & docs**
- `GET /health` · `GET /health/public-host` (host-detection diagnostic) · `GET /health/sync` (per-adapter sync freshness)
- `GET /api-docs` (Swagger UI, non-prod) · a Postman collection lives at [`postman-collection.json`](./postman-collection.json)

## Auth & roles

- **JWT** Bearer tokens (also an httpOnly cookie). `optionalAuth` decodes early so the rate limiter can exempt admins; `authenticateToken` enforces.
- Role guards (`middleware/auth.js`): `requireRole(...roles)`, `requireAdmin`, `requireAgentOrAdmin`, `requireFleetOwnerOrAdmin`.
- Roles: **`admin`**, **`agent`**, **`fleet_owner`**, **`driver_partner`**, **`customer`** (new users default to `customer` / `approvalStatus: pending`).

## Data model

The backend owns its **own** PostgreSQL database (separate from Lyfe's Supabase) — ~38 Sequelize models in `src/models/` with associations in `src/models/index.js`. Pipeline-central tables: `User`, `Prospect`, `ProspectActivity`, `Campaign`, `LeadPackage` / `LeadPackageAssignment`, `RoundRobinCursor`, `Commission`, `QrTag` / `QrScan`, `ShortLink`, `Attribution`, `ExternalAgent` / `ExternalCampaignAgent`, `WebhookSubscriber` / `WebhookDelivery`, `IdempotencyKey`. Fleet/DOOH tables (`Device`, `Vehicle`, `Car`, `FleetOwner`, `Driver`, `BeaconEvent`, `Impression`, `ProvisioningSession`, …) belong to the paused subsystem. See [`../README.md`](../README.md#-data-model) for the annotated breakdown.

## Environment variables

The annotated source of truth is [`env.example`](./env.example) (and the frontend's [`../.env.example`](../.env.example) for `VITE_*`). Highlights:

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
| Meta | `META_CAPI_ENABLED`, `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE`; `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN`; `META_EVENT_QUALIFIED`, `META_EVENT_WON` |
| TikTok | `TIKTOK_EVENTS_API_ENABLED`, `TIKTOK_PIXEL_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_TEST_EVENT_CODE` |
| OTP | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SNS_SENDER_ID`; `WHATSAPP_PROVIDER`, `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_BUSINESS_ACCOUNT_ID` |
| Storage | `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_REGION`, `DO_SPACES_ENDPOINT`, `DO_SPACES_BUCKET`, `DO_SPACES_CDN_BASE` |
| Email | `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD`, `EMAIL_FROM_MKTR`, `EMAIL_FROM_REDEEM` |
| System Agent | `SYSTEM_AGENT_EMAIL`, `SYSTEM_AGENT_REDIRECT_EMAIL`, `DEFAULT_AGENT_ID` |
| Attribution | `ATTRIB_SECRET`, `IP_HASH_SALT` (both **required in production** — the server throws without them) |
| Crons / flags | `SYNC_AGENT_CRON`, `ENABLE_DOMAIN_PREFIXES`, `MANIFEST_ENABLED`, `BEACONS_ENABLED`, `RATE_LIMIT_*` |
| Observability | `SENTRY_DSN`, `OBS_SAMPLE_RATE` |

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

- **Jest + supertest** — service/unit specs in `src/tests/`, route/integration specs in `test/` (incl. `test/integration/`).
- **CI** (`../.github/workflows/ci.yml`) runs the suite on Node 20 against a Postgres 15 service container with `NODE_ENV=test` (force-syncs the schema, then applies migrations). `npm audit` runs non-blocking.
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

Runs on **Render** (Singapore) as the `mktr-backend-jo6r` web service behind `api.mktr.sg`, serving `/api/*` and `/uploads/*` for both the `mktr.sg` and `redeem.sg` static sites. A `Dockerfile` and `docker-compose.yml` are provided for container builds. Migrations apply automatically on boot.

## Security

- JWT auth with role-based access control; `internalRouteHostGuard` rejects admin/auth/agent API calls arriving with a `redeem.sg` public-host signature.
- Inbound webhooks are HMAC-SHA256 verified over the raw body (Retell, Meta, Lyfe lead-outcome / users); outbound webhooks are HMAC-signed with per-subscriber secrets.
- Helmet, CORS allowlist (mktr.sg / redeem.sg apex + www), production rate limiting (admins and `/api/integrations/lyfe/*` exempt), Joi input validation, Sequelize parameterization, SVG uploads forced to download.
- Sentry scrubbing (`utils/sentryScrub.js`) and PII hashing (`utils/piiHashing.js`).

---

*MKTR PTE. LTD. (UEN 202507548M) · Singapore · Proprietary & Confidential.*
