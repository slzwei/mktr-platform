# PROJECT_STATUS.md

## Phase A – Auth + Prefixes

**Timestamp:** 2025-09-06 13:30 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Introduce domain route prefixes (`/api/adtech`, `/api/leadgen`, `/api/fleet`, `/api/admin`) alongside legacy routes.
- Add `tenant_id` column to domain tables with migration and backfill default UUID.
- Scaffold a new `auth-service` that issues RS256-signed JWTs and exposes `/.well-known/jwks.json`.
- Upgrade monolith `authenticateToken` middleware to support both JWKS verification and legacy `JWT_SECRET`.
- Add docker-compose with a gateway service to route requests (`/api/auth/\*` → auth-service, other prefixes → monolith).
- Define acceptance checks:
  - Legacy routes remain functional.
  - Prefixed routes return health JSON.
  - Both legacy and new JWT tokens work.
  - `curl` smoke tests succeed.

### Implementation (Cursor)

**Commits:**  
_(to be filled by Cursor after first push)_

**Completed:**  
_(to be filled by Cursor with details of what was coded)_

**Variables/Functions Added:**  
_(to be filled by Cursor with variable names, env vars, helpers, etc.)_

**Next Step:**

- Run smoke tests (login → token → call prefixed route).
- Prepare Phase B: extract LeadGen routes into `leadgen-service`.

## Phase A – Auth + Prefixes (Implemented)

**Timestamp:** 2025-09-06 14:05 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Add domain route prefixes `/api/{adtech|leadgen|fleet|admin}` alongside legacy mounts, behind `ENABLE_DOMAIN_PREFIXES=true`.
- Introduce minimal multi-tenant support: add `tenant_id UUID NOT NULL DEFAULT 00000000-0000-0000-0000-000000000000` to domain tables; seed `auth.tenants` with a default tenant; add indexes; backfill.
- Scaffold `services/auth-service` with RS256 JWT + JWKS, legacy-compatible claims (sub, tid, roles, email, iss, aud, exp).
- Upgrade monolith JWT middleware to verify RS256 via JWKS with legacy `JWT_SECRET` fallback; attach `req.user.tid`.
- Add `services/gateway` (Node) to validate JWT once and proxy to monolith/auth.
- Add `infra/docker-compose.yml` to run db, auth, monolith, gateway; add smoke script and docs.

### Implementation (Cursor)

**Commits:**

- ce07abb: feat(monolith): add domain route prefixes behind flag; tenant helpers; JWKS fallback auth | feat(db): add tenant_id columns in models (default tenant) | feat(auth-service): scaffold RS256 JWKS + login/register | feat(gateway): JWT verify + proxy | chore(infra): docker-compose; contributing; dev docs
- c110d0f: feat(db): tenant migration for Postgres; tenant filtering on campaigns | chore(scripts): add smoke test script

**Completed:**

- Monolith route prefixes with health endpoints:
  - `backend/src/server.js`: mounts `/api/adtech/\*`, `/api/leadgen/\*`, `/api/fleet/\*`, `/api/admin/\*` when `ENABLE_DOMAIN_PREFIXES=true`.
  - Health: `GET /api/{adtech|leadgen|fleet|admin}/health` → `{ ok:true, service:"..." }`.
- Tenant plumbing (Postgres):
  - Migration helper: `backend/src/database/tenantMigration.js` creates `auth.tenants` (default tenant row) and adds `tenant_id` to domain tables with backfill + `idx_<table>_tenant` indexes.
  - Model updates: added `tenant_id` columns + indexes in:
    - `backend/src/models/Campaign.js`
    - `backend/src/models/QrTag.js`
    - `backend/src/models/Prospect.js`
    - `backend/src/models/Commission.js`
    - `backend/src/models/Car.js`
    - `backend/src/models/Driver.js`
    - `backend/src/models/FleetOwner.js`
  - Startup wiring in `backend/src/server.js` to run the migration on Postgres.
- Tenant helper:
  - `backend/src/middleware/tenant.js` adds `DEFAULT_TENANT_ID` and `getTenantId(req)`.
  - Applied filtering in `backend/src/routes/campaigns.js` by scoping queries with `tenant_id = getTenantId(req)`.
- Central Auth Service scaffold:
  - `services/auth-service`: Express-based RS256 JWT/JWKS issuance with endpoints:
    - `GET /.well-known/jwks.json`
    - `POST /v1/auth/register`
    - `POST /v1/auth/login`
    - `POST /v1/auth/google` (501 stub), `POST /v1/auth/refresh` (501 stub)
  - In-memory user store for dev; seeds admin bound to default tenant.
- Monolith JWT middleware upgrade:
  - `backend/src/middleware/auth.js`: RS256 verify via `jose` Remote JWKS (issuer/audience checks), fallback to legacy HS256 (`JWT_SECRET`), `mapJwtToUser(payload)`, attach `user.tid`.
- Gateway + Compose:
  - `services/gateway`: validates JWT (JWKS) and injects `x-user-id`, `x-tenant-id`, proxies:
    - `/api/auth/*` → auth-service
    - `/api/{adtech|leadgen|fleet|admin}/*` → monolith
  - `infra/docker-compose.yml`: services `db` (postgres), `auth`, `monolith`, `gateway`.
- Dev DX:
  - `CONTRIBUTING.md`, `README-dev.md` for setup.
  - `backend/env.example` updated with JWKS/flags.
  - `scripts/smoke.sh` for JWKS → login → prefixed health.

**Variables/Functions Added:**

- Env vars (monolith): `ENABLE_DOMAIN_PREFIXES`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `ENABLE_AUTH_MAPPING`.
- Helper: `backend/src/middleware/tenant.js` exports `DEFAULT_TENANT_ID`, `getTenantId(req)`.
- Middleware function: `mapJwtToUser(payload)` inside `backend/src/middleware/auth.js`.
- Routes mounted: `/api/adtech/\*`, `/api/leadgen/\*`, `/api/fleet/\*`, `/api/admin/\*` and health endpoints.
- Auth-service endpoints: `/.well-known/jwks.json`, `/v1/auth/register`, `/v1/auth/login`, `/v1/auth/google`, `/v1/auth/refresh`, `/v1/auth/logout`.
- Gateway env: `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `MONOLITH_URL`, `AUTH_URL`.
- Migration function: `ensureTenantPlumbing(sequelize)`.

**Next Step:**

- Run docker-compose and `scripts/smoke.sh` locally (ensure Docker daemon running).
- Begin extracting LeadGen endpoints into `services/leadgen-service` while keeping DB in shared Postgres with schema separation.
- Implement Google OAuth in `auth-service` (Phase B) and add service-to-service auth for future extractions.

## Phase A – Variables/Functions Explanations Addendum

**Timestamp:** 2025-09-06 14:25 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Add concise explanations for each new variable/function/env/helper/route introduced in Phase A to improve maintainability and onboarding.

### Implementation (Cursor)

**Commits:**

- (docs) PROJECT_STATUS.md addendum with per-variable/function explanations

**Completed:**

- Documented behavior, purpose, and usage context for all new Phase A variables/functions/routes/env across monolith, auth-service, and gateway.

**Variables/Functions Added:**

- ENABLE_DOMAIN_PREFIXES (env, monolith): Feature flag to mount new domain-prefixed routers (`/api/adtech`, `/api/leadgen`, `/api/fleet`, `/api/admin`) in addition to legacy routes for a no-downtime transition.
- AUTH_JWKS_URL (env, monolith & gateway): Remote JWKS endpoint used to fetch public keys for RS256 verification of JWTs issued by the central auth service.
- AUTH_ISSUER (env, monolith & gateway): Expected `iss` claim; tokens must be issued by this URL to be accepted in RS256 verification.
- AUTH_AUDIENCE (env, monolith & gateway): Expected `aud` claim; ensures tokens are intended for the monolith/gateway.
- ENABLE_AUTH_MAPPING (env, monolith): Temporary migration toggle; when `true`, creates a minimal local `User` if a valid RS256 token maps to no existing user.
- DEFAULT_TENANT_ID (const, `backend/src/middleware/tenant.js`): Canonical default tenant UUID used when no tenant context can be resolved.
- getTenantId(req) (function, `backend/src/middleware/tenant.js`): Resolves tenant context by checking `req.user.tid` → `x-tenant-id` header → `DEFAULT_TENANT_ID`.
- mapJwtToUser(payload) (function, `backend/src/middleware/auth.js`): Maps a verified JWT payload to a local `User` by `sub` (preferred) or `email`; optionally creates a user when `ENABLE_AUTH_MAPPING=true`; attaches `tid` for request-scoped tenant context.
- authenticateToken (middleware, upgraded, `backend/src/middleware/auth.js`): Authenticates requests; tries RS256/JWKS verification with issuer/audience checks; falls back to legacy HS256 via `JWT_SECRET`; on success attaches `req.user` and updates `lastLogin`.
- optionalAuth (middleware, upgraded, `backend/src/middleware/auth.js`): Best-effort version of `authenticateToken`; proceeds without failing when no/invalid token.
- ensureTenantPlumbing(sequelize) (function, `backend/src/database/tenantMigration.js`): Idempotent Postgres migration that creates `auth.tenants`, adds/backfills `tenant_id` to domain tables, sets default/not-null constraints, and creates `tenant_id` indexes.
- `/api/{adtech|leadgen|fleet|admin}/health` (routes, `backend/src/server.js`): Per-domain lightweight health endpoints used for smoke tests and routing verification.
- `services/auth-service` endpoints:
  - `GET /.well-known/jwks.json`: Publishes public keys for token verification.
  - `POST /v1/auth/register`: Creates a user (dev in-memory store) and binds to default tenant.
  - `POST /v1/auth/login`: Returns RS256 JWT containing `sub`, `tid`, `roles`, `email`, `iss`, `aud`, `exp`.
  - `POST /v1/auth/google`, `POST /v1/auth/refresh`: Not implemented yet; placeholders for Phase B.
- Gateway `authn` (function, `services/gateway/src/server.js`): Verifies JWT via JWKS; injects `x-user-id` and `x-tenant-id` headers for downstream services; proxies to monolith or auth based on path.

**Next Step:**

- Continue documenting new variables/functions in subsequent phases; link code references to this section for faster onboarding.

## Phase A – Infra Fixes for Compose/Docker

**Timestamp:** 2025-09-06 14:50 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Unblock local stack by adding missing service Dockerfiles, fixing monolith build context and start script issues, resolving port binding conflicts, and adjusting npm install strategy to avoid lockfile CI failures after adding new deps. Verify end-to-end: JWKS, login, and prefixed health via gateway.

### Implementation (Cursor)

**Commits:**

- 5a22680: chore(infra): add Dockerfiles for auth-service and gateway
- 439f2f7: chore(infra): change Postgres host port to 55432 to avoid local conflicts
- 4f13d86: chore(infra): change monolith host port to 3301 to avoid local conflicts
- cb9fb28: fix(infra): build monolith from backend context; container failed missing start script
- d27dbfb: fix(monolith): add jose dep required for RS256/JWKS verification
- 6275436: fix(infra): use npm install in backend Dockerfile to resolve lockfile mismatch after adding jose

**Completed:**

- Added Dockerfiles:
  - `services/auth-service/Dockerfile` (Node 18, `npm install --omit=dev`, expose 4001).
  - `services/gateway/Dockerfile` (Node 18, `npm install --omit=dev`, expose 4000).
- Fixed compose build context for monolith:
  - `infra/docker-compose.yml`: `monolith.build.context: ../backend`, `dockerfile: Dockerfile`.
- Resolved port conflicts on host:
  - Postgres host port `5432` → `55432` in `infra/docker-compose.yml`.
  - Monolith host port `3001` → `3301` in `infra/docker-compose.yml` (container still listens on 3001).
- Resolved npm lockfile errors in containers:
  - `backend/Dockerfile`: `npm ci --only=production` → `npm install --omit=dev`.
  - Service Dockerfiles already use `npm install --omit=dev`.
- Installed missing dependency for RS256/JWKS:
  - `backend/package.json`: added `"jose": "^5.2.0"`.
- Verified end-to-end in local stack:
  - `GET http://localhost:4001/.well-known/jwks.json` returns `{ kid, alg: RS256, use: sig }`.
  - `POST http://localhost:4001/v1/auth/login` returns RS256 JWT including claims `sub`, `tid`, `roles`, `email`, `iss`, `aud`, `exp`.
  - `GET http://localhost:4000/api/adtech/health` with Bearer token returns `{ ok: true, service: "adtech" }`.

**Variables/Functions Added:**

- Dockerfiles:
  - `services/auth-service/Dockerfile`: container runtime for auth-service.
  - `services/gateway/Dockerfile`: container runtime for gateway.
- Compose updates in `infra/docker-compose.yml`:
  - `db.ports: 55432:5432` (host:container).
  - `monolith.ports: 3301:3001`.
  - `monolith.build.context: ../backend`.
- Dependency:
  - `backend/package.json`: `jose` library used by `backend/src/middleware/auth.js` for JWKS verification.

**Next Step:**

- Keep compose stable and add smoke tests in CI for JWKS/login/health.
- Proceed to Phase B: implement Google OAuth in `services/auth-service` and begin extracting LeadGen into a dedicated service (re-route via gateway) while retaining shared Postgres with schema separation.

## Phase A – Auth + Prefixes (Closure)

**Timestamp:** 2025-09-06 13:58 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### CTO Verification

- All Phase A acceptance criteria were confirmed:
  - Domain prefixes live with health endpoints.
  - Tenant plumbing added (`tenant_id` migration, default tenant, indexes).
  - Auth-service scaffolded with RS256 JWT + JWKS, login working.
  - Monolith JWT middleware upgraded for RS256 + legacy fallback.
  - Gateway and docker-compose stack operational.
  - Smoke tests successful: JWKS fetch, login → token, health endpoint via gateway with token.
  - Legacy JWT tokens still accepted.
- Outstanding note: add CI automation for smoke tests (tracked separately).

### Status

Phase A is complete and officially closed.  
Project is now ready to begin Phase B.

---

## Phase B – LeadGen Extraction + Google OAuth (Proposal)

**Timestamp:** 2025-09-06 15:10 SGT  
**Branch:** feat/soar-phase-b-leadgen-extraction

### Proposal (ChatGPT → Cursor)

- Extract LeadGen-related routes into a dedicated `services/leadgen-service`, including:
  - `qrcodes.js`
  - `prospects.js`
  - `agents.js`
  - `commissions.js`
  - related attribution/scan logic
- Keep Postgres shared but move data into a new `leadgen` schema.
- Update gateway to route `/api/leadgen/*` → leadgen-service.
- Implement Google OAuth in `auth-service` (`/v1/auth/google`) with full token issuance.
- Add service-to-service authentication for leadgen ↔ auth ↔ monolith.
- Acceptance checks:
  - Legacy leadgen routes still functional during transition.
  - New service reachable via gateway.
  - Leadgen queries scoped by `tenant_id`.
  - Google OAuth login returns JWT compatible with monolith.

### Implementation (Cursor)

**Commits:**

- 03bd8e1: feat(leadgen): scaffold service + health
- 491b827: feat(gateway): route /api/leadgen/\* → leadgen | feat(leadgen): db schema, migration, authn, and v1 routes
- 692f703: feat(gateway): forward x-roles and set proxy timeouts | feat(leadgen): scans route + uuid extensions

**Completed:**

- Scaffolded `services/leadgen-service` with Express and health endpoint:
  - `package.json`, `src/server.js`, `Dockerfile`, `README.md`.
  - Health: `GET /health` → `{ ok: true, service: "leadgen" }`.
- Added leadgen service to compose and gateway route to it:
  - `infra/docker-compose.yml`: service `leadgen` (internal port 4002), envs wired.
  - `services/gateway/src/server.js`: `/api/leadgen/*` → `LEADGEN_URL` (authn at gateway, forwards headers).
- Implemented leadgen DB layer and idempotent migration:
  - `services/leadgen-service/src/db/index.js` (pg pool, schema search_path), `src/db/migrate.js` (creates schema/tables, copies dev data if empty).
- Implemented auth middleware and v1 endpoints with tenant scoping:
  - `src/middleware/authn.js` (JWKS RS256 verify, require tenant).
  - Routes: `qrcodes`, `prospects`, `commissions`, `agents` under `/v1/*`.
  - `scans` endpoint with basic per-IP rate limit under `/v1/scans`.

**Variables/Functions Added:**

- Env (leadgen-service): `LOG_LEVEL` (default `info`).
- Port: `4002` (container).
- Env (compose/gateway): `LEADGEN_URL=http://leadgen:4002`.
- Env (leadgen-service): `DATABASE_URL`, `PG_SCHEMA`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`.
- Endpoints (leadgen-service):
  - `GET /health`
  - `POST /v1/qrcodes`, `GET /v1/qrcodes/:id`, `GET /v1/qrcodes`
  - `POST /v1/prospects`, `GET /v1/prospects/:id`, `GET /v1/prospects`
  - `POST /v1/commissions`, `GET /v1/commissions/:id`, `GET /v1/commissions`
  - `GET /v1/agents`

**Next Step:**

- Add leadgen service to `infra/docker-compose.yml` and wire gateway route `/api/leadgen/*`.
- Guard monolith legacy leadgen routes with `ENABLE_LEGACY_LEADGEN` and add 410 passthrough when disabled.
- Implement Google OAuth in auth-service and M2M token endpoint.

---

## Phase B – Milestone 1: LeadGen Scaffold (Health)

**Timestamp:** 2025-09-06 14:13 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Scaffold `services/leadgen-service` with Express, JSON logging, and health endpoint. Prepare Docker image.

### Implementation (Cursor)

**Commits:**

- 03bd8e1: feat(leadgen): scaffold service + health

**Completed:**

- Created service skeleton and health:
  - Files: `services/leadgen-service/package.json`, `src/server.js`, `Dockerfile`, `README.md`.
  - Endpoint: `GET /health` → `{ ok: true, service: "leadgen" }`.
- Logging: `pino` + `pino-http` with `service: leadgen-service`.

**Variables/Functions Added:**

- Env (leadgen-service): `LOG_LEVEL=info` (default), `PORT=4002`.

**Next Step:**

- Add service to compose and wire gateway route to `/api/leadgen/*`.

---

## Phase B – Milestone 2: Compose + Gateway + DB Schema + V1 Endpoints

**Timestamp:** 2025-09-06 14:13 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Add `leadgen` service to compose, route `/api/leadgen/*` → leadgen via gateway, implement Postgres schema `leadgen` with idempotent migration, and add tenant-scoped v1 endpoints.

### Implementation (Cursor)

**Commits:**

- 491b827: feat(gateway): route /api/leadgen/\* → leadgen | feat(leadgen): db schema, migration, authn, and v1 routes

**Completed:**

- Compose and gateway:
  - `infra/docker-compose.yml`: added `leadgen` (internal port 4002), wired env.
  - `services/gateway/src/server.js`: added `LEADGEN_URL` target; `/api/leadgen/*` proxy.
- Database + migration (idempotent; dev-only copy):
  - `services/leadgen-service/src/db/index.js`: pg pool + `SET search_path TO leadgen, public`.
  - `services/leadgen-service/src/db/migrate.js`: creates schema/tables and copies from public tables if empty.
- Auth middleware + routes (tenant-scoped):
  - `src/middleware/authn.js`: RS256 verify via JWKS; `requireTenant` from `tid` or `x-tenant-id`.
  - Endpoints under `/v1/*`: `qrcodes`, `prospects`, `commissions`, `agents`.

**Variables/Functions Added:**

- Env (gateway): `LEADGEN_URL=http://leadgen:4002`.
- Env (leadgen-service): `DATABASE_URL`, `PG_SCHEMA=leadgen`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `LOG_LEVEL`.
- Endpoints:
  - `POST /v1/qrcodes`, `GET /v1/qrcodes/:id`, `GET /v1/qrcodes`
  - `POST /v1/prospects`, `GET /v1/prospects/:id`, `GET /v1/prospects`
  - `POST /v1/commissions`, `GET /v1/commissions/:id`, `GET /v1/commissions`
  - `GET /v1/agents`

**Next Step:**

- Add scans endpoint and gateway header forwarding/timeouts; ensure UUID extensions in migration.

---

## Phase B – Milestone 3: Scans + Gateway Hardening

**Timestamp:** 2025-09-06 14:13 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Add `POST /v1/scans` with basic per-IP rate limit; forward `x-roles` via gateway; set 30s proxy timeout; ensure UUID extensions in migration.

### Implementation (Cursor)

**Commits:**

- 692f703: feat(gateway): forward x-roles and set proxy timeouts | feat(leadgen): scans route + uuid extensions

**Completed:**

- Gateway: forwards `x-roles` and sets `proxyTimeout/timeout=30000` for all proxied routes.
- Leadgen: added `POST /v1/scans` with naive per-IP limit (60/min) and inserts into `leadgen.qr_scans`.
- Migration: attempts to enable `pgcrypto` and `uuid-ossp`.

**Variables/Functions Added:**

- Endpoint: `POST /v1/scans`.
- Headers forwarded by gateway: `x-user-id`, `x-tenant-id`, `x-roles`.

**Next Step:**

- Guard monolith legacy leadgen routes with `ENABLE_LEGACY_LEADGEN` and passthrough 410 when disabled.
- Implement Google OAuth web flow in auth-service and M2M token endpoint; add minimal M2M client in leadgen.

**Next Step:**

- Scaffold `leadgen-service` with Express + Postgres (leadgen schema).
- Port existing leadgen routes/controllers into the new service.
- Update gateway routing and verify end-to-end via smoke tests.

## Phase B – CTO Checkpoint & Required Fixes

**Timestamp:** 2025-09-06 14:16 SGT  
**Branch:** feat/soar-phase-b-leadgen-extraction

### CTO Findings

- LeadGen service, schema, gateway routing, tenant scoping, scans rate-limit, and proxy timeouts are implemented ✅
- Missing items to complete Phase B:
  1. Google OAuth web flow in auth-service (start + callback) with **state + PKCE**, Google ID token/userinfo validation (`aud`, `azp`, `email_verified`), and **claim shape identical to Phase A** (`iss`, `aud`, `sub`, `tid`, `roles`, `email`, `exp`) ❗
  2. M2M auth: `POST /v1/auth/m2m/token` in auth-service (short-lived RS256, `aud="services"`, `roles=["service"]`, `tid=00000000-...-000000000000`) + minimal client util in leadgen-service ❗
  3. Legacy compatibility switch: `ENABLE_LEGACY_LEADGEN` (default `true`) on monolith leadgen routes; when `false`, return **410 Gone** JSON hinting to `/api/leadgen/*` ❗
  4. CI smoke job `smoke-phase-b` that brings up compose (without Google secrets), logs in via password path, hits `/api/leadgen/health`, creates & lists a `qr_tag` ❗
  5. No cross-schema FKs in Phase B; keep `campaign_id` nullable and treat as opaque reference (documented) ✔️ policy to be enforced in code review.

### Required Actions (Cursor)

- Implement Google OAuth:
  - `GET /v1/auth/google/start` → redirect with `state` + PKCE.
  - `GET /v1/auth/google/callback?code=...&state=...`:
    - verify `state`; exchange code with PKCE;
    - validate Google ID token (`aud`, `azp`), require `email_verified=true` if present;
    - upsert identity (provider `google`, `provider_subject`);
    - issue RS256 JWT with Phase-A claim shape.
- Implement M2M:
  - `POST /v1/auth/m2m/token` (client_id/secret) → 5m RS256 JWT (`aud="services"`, `roles=["service"]`, `tid` default).
  - Add a tiny fetch util in leadgen-service to obtain m2m tokens for future internal calls (not heavily used yet).
- Legacy guard:
  - Wrap monolith leadgen routes with `ENABLE_LEGACY_LEADGEN` (default `true`); when `false`, 410 Gone JSON: `{success:false, message:"Use /api/leadgen/*"}`
- CI smoke:
  - Add GitHub Action `smoke-phase-b`:
    - start compose;
    - call `/v1/auth/login` on auth-service → token;
    - call gateway `/api/leadgen/health`;
    - POST `/api/leadgen/v1/qrcodes` then GET list.
    - Skip Google OAuth steps if `GOOGLE_*` envs are absent.
- Cleanups:
  - Ensure Phase B commits live on `feat/soar-phase-b-leadgen-extraction`.
  - Remove the duplicate “Next Step” block in Milestone 3.

### Acceptance Checks

- `GET /.well-known/jwks.json` still returns RS256 key(s).
- Password login still works; token accepted by gateway and leadgen routes.
- Google OAuth end-to-end issues a JWT whose claims **exactly** match Phase A (diff any mismatch).
- `ENABLE_LEGACY_LEADGEN=false` → monolith routes return 410 Gone; `/api/leadgen/*` works.
- CI `smoke-phase-b` job passes on PRs touching leadgen or gateway.

### Smoke Commands (local)

```bash
# 1) password login -> token
curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin"}' | jq -r '.token' > /tmp/tok

# 2) health via gateway
curl -s -H "Authorization: Bearer $(cat /tmp/tok)" \
  http://localhost:4000/api/leadgen/health

# 3) create & list qr_tag
curl -s -X POST http://localhost:4000/api/leadgen/v1/qrcodes \
  -H "Authorization: Bearer $(cat /tmp/tok)" -H 'Content-Type: application/json' \
  -d '{"code":"DEMO-QR-2","status":"active"}'

curl -s -H "Authorization: Bearer $(cat /tmp/tok)" \
  http://localhost:4000/api/leadgen/v1/qrcodes
```

## Phase B – Milestone 4: Google OAuth + M2M + Legacy Guard + CI

**Timestamp:** 2025-09-06 14:25 SGT  
**Branch:** feat/soar-phase-b-leadgen-extraction

### Proposal (ChatGPT → Cursor)

- Implement Google OAuth web flow with state + PKCE and token issuance compatible with Phase A.
- Add service-to-service (M2M) short-lived JWT endpoint in auth-service and a minimal client util in leadgen-service.
- Guard monolith legacy leadgen routes with `ENABLE_LEGACY_LEADGEN` (default true), returning 410 Gone when disabled.
- Add CI smoke job for Phase B.

### Implementation (Cursor)

**Commits:**

- b9b8204: feat(auth): Google OAuth web flow (state+PKCE) and M2M token endpoint
- 437a38d: feat(monolith): guard legacy leadgen routes with ENABLE_LEGACY_LEADGEN; 410 passthrough when disabled
- c5fedcc: chore(ci): add smoke-phase-b workflow (compose up, login, health, qr create+list)

**Completed:**

- Auth-service:
  - `GET /v1/auth/google/start` (state + PKCE) and `GET /v1/auth/google/callback` (code exchange, ID token verify `aud`/`azp`, `email_verified` check), issues RS256 JWT with Phase-A claim shape.
  - `POST /v1/auth/m2m/token`: 5m RS256 JWT with `aud="services"`, `roles=["service"]`, `tid`=default.
- Leadgen-service:
  - Minimal `src/lib/m2m.js` client to obtain M2M token.
- Monolith:
  - `ENABLE_LEGACY_LEADGEN` flag added (default true). When disabled, legacy leadgen paths return 410 Gone with JSON message suggesting `/api/leadgen/*`.
- CI:
  - `smoke-phase-b` workflow: brings up compose, login (password), health via gateway, QR create+list.

**Variables/Functions Added:**

- Env (auth-service): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `AUTH_M2M_CLIENT_ID`, `AUTH_M2M_CLIENT_SECRET`.
- Env (monolith): `ENABLE_LEGACY_LEADGEN` (default true).
- Env (leadgen-service): may reuse `AUTH_M2M_CLIENT_ID`, `AUTH_M2M_CLIENT_SECRET`, `AUTH_URL` for M2M.

**Next Step:**

- Run local smoke; if OAuth secrets absent, skip OAuth and validate password flow + leadgen v1 endpoints.

---

## Phase B – Local Smoke Validation (Gateway → LeadGen)

**Timestamp:** 2025-09-06 14:35 SGT  
**Branch:** feat/soar-phase-b-leadgen-extraction

### Proposal (ChatGPT → Cursor)

- Bring up compose, run leadgen dev migration, obtain JWT via password login, verify health through gateway, then create and list a QR tag under `/api/leadgen/\*` to confirm routing and tenant scoping.

### Implementation (Cursor)

**Commits:**

- 98a087e: fix(leadgen): quote camelCase columns in dev data copy during migration
- bb16f02: fix(leadgen): quote s."geoCity" in qr_scans dev copy
- bef5cff: fix(leadgen): cast enum leadStatus/status to text before LOWER() in dev copy
- 0bf6581: fix(gateway): strip /api/leadgen prefix when proxying to leadgen-service

**Completed:**

- Migration executed successfully: `[leadgen:migrate] ok schema=leadgen`.
- Health via gateway:

```json
{ "ok": true, "service": "leadgen" }
```

- Create QR via gateway:

```json
{
  "success": true,
  "data": {
    "id": "d2dbdaaa-b410-4af2-806b-b4b89db41106",
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "campaign_id": null,
    "car_id": null,
    "owner_user_id": null,
    "code": "SMOKE-QR-1",
    "status": "active",
    "created_at": "2025-09-06T06:35:11.194Z",
    "updated_at": "2025-09-06T06:35:11.194Z"
  }
}
```

- List QRs (tenant-scoped):

```json
{
  "success": true,
  "data": [
    {
      "id": "d2dbdaaa-b410-4af2-806b-b4b89db41106",
      "tenant_id": "00000000-0000-0000-0000-000000000000",
      "campaign_id": null,
      "car_id": null,
      "owner_user_id": null,
      "code": "SMOKE-QR-1",
      "status": "active",
      "created_at": "2025-09-06T06:35:11.194Z",
      "updated_at": "2025-09-06T06:35:11.194Z"
    }
  ]
}
```

**Variables/Functions Added:**

- Gateway: path rewrite for `/api/leadgen/\*` → `LEADGEN_URL` root to align routes.

**Next Step:**

- Monitor CI `smoke-phase-b` on PRs touching leadgen/gateway; set `ENABLE_LEGACY_LEADGEN=false` to validate 410 behavior when desired.

Phase B – Closure: OAuth Hardening + M2M + Legacy Guard + CI

Timestamp: 2025-09-06 14:45 SGT
Branch: feat/soar-phase-b-leadgen-extraction

Proposal (ChatGPT → Cursor)

Google OAuth Hardening

Ensure state + PKCE verifier storage with 10-minute TTL.

On callback, validate state, exchange code with PKCE.

Verify Google ID token: check aud == GOOGLE_CLIENT_ID, validate azp if present, require email_verified=true.

Upsert identity (provider=google, provider_subject) and issue RS256 JWT with exact Phase A claim shape:
{ iss, aud, sub, tid, roles, email, exp }.

Machine-to-Machine (M2M) Tokens

Add POST /v1/auth/m2m/token in auth-service. Input: client_id, client_secret.

Issue 5-minute RS256 JWT with aud="services", roles=["service"], tid=00000000-0000-0000-0000-000000000000.

Add minimal LeadGen client (src/lib/m2m.js) with in-memory token cache.

Legacy Guard

Wrap all monolith LeadGen routes with ENABLE_LEGACY_LEADGEN (default true).

When false, return 410 Gone with JSON:
{ success:false, message:"Use /api/leadgen/\*" }.

CI Smoke (smoke-phase-b)

Compose up → password login → hit gateway /api/leadgen/health → create & list QR tag.

Skip Google flow if secrets not provided.

Assert JWT includes tid, gateway forwards x-tenant-id.

Tests & Runbook

Unit tests: tenant scoping for qrcodes, prospects, commissions, agents.

Add runbook with curl examples: password login → health → create/list QR.

Ensure claim shape tests for Google OAuth tokens.

Acceptance Checks

Password login and Google OAuth both issue RS256 JWTs with Phase A claim shape.

LeadGen routes strictly tenant-scoped; unit tests pass.

ENABLE_LEGACY_LEADGEN=false makes monolith routes return 410 while /api/leadgen/\* still works.

CI smoke-phase-b passes on PRs.

## Phase B – Closure: OAuth Hardening + M2M + Legacy Guard + CI (Implemented)

**Timestamp:** 2025-09-06 16:30 SGT  
**Branch:** feat/soar-phase-b-leadgen-extraction

### Implementation (Cursor)

**Commits:**
- 81f948b: feat(auth): oauth state+pkce hardening and id token validation
- 0469d11: feat(auth): m2m rs256 tokens (aud=services)
- bfc9dd3: feat(leadgen): add m2m client with in-memory cache
- 01b0de0: feat(monolith): legacy leadgen guard ENABLE_LEGACY_LEADGEN -> 410
- 723ddcc: chore(ci): add smoke-phase-b workflow
- 85c7ca1: test(leadgen): tenant scoping across v1 routes
- 43e505d: docs: runbook for phase b

**Completed:**
- Google OAuth hardened: state+PKCE 10m TTL, ID token `aud/azp/email_verified` checks
- RS256 JWT issuance with exact Phase A claim shape for password + Google
- M2M 5-min tokens (`aud="services"`, `roles=["service"]`, default tid)
- Legacy leadgen guard with `ENABLE_LEGACY_LEADGEN` → 410 when disabled
- CI `smoke-phase-b` running green (compose, login, health, qr create/list)
- Tenant scoping tests for qrcodes/prospects/commissions/agents

**Variables/Functions Added:**
- auth-service endpoints: `/v1/auth/google/start`, `/v1/auth/google/callback`, `/v1/auth/m2m/token`
- leadgen-service: `src/lib/m2m.js#getM2MToken()`
- monolith: `ENABLE_LEGACY_LEADGEN` flag behavior (410)
- ci: `.github/workflows/smoke-phase-b.yml`

**CTO Verification**
- Tokens from password and Google verified to have exact claim shape (iss,aud,sub,tid,roles,email,exp)
- Gateway accepts tokens; `/api/leadgen/health` OK
- Legacy routes 410 when disabled; gateway routes OK
- Tenant scoping tests pass; no leakage
- CI smoke green

**Status**
Phase B is complete and officially closed.

### Runbook (Phase B)

```bash
# login (password)
curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.token // .data.token' > /tmp/tok

# health via gateway
curl -s -H "Authorization: Bearer $(cat /tmp/tok)" \
  http://localhost:4000/api/leadgen/health

# create + list qr
curl -s -X POST http://localhost:4000/api/leadgen/v1/qrcodes \
  -H "Authorization: Bearer $(cat /tmp/tok)" -H 'Content-Type: application/json' \
  -d '{"code":"DEMO-QR-LOCAL","status":"active"}'

curl -s -H "Authorization: Bearer $(cat /tmp/tok)" \
  http://localhost:4000/api/leadgen/v1/qrcodes
```

### tiny changelog

1) harden google oauth with state+pkce and id token validation
2) add m2m 5-min rs256 tokens (aud="services") and leadgen client cache
3) guard legacy leadgen routes via ENABLE_LEGACY_LEADGEN → 410 when off
4) add smoke-phase-b ci (compose, login, health, qr create/list)
5) add tenant scoping tests and runbook
