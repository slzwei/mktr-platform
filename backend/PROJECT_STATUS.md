# PROJECT_STATUS.md

## Phase A – Auth + Prefixes

**Timestamp:** 2025-09-06 13:30 SGT  
**Branch:** feat/soar-phase-a-auth-and-prefixes

### Proposal (ChatGPT → Cursor)

- Introduce domain route prefixes (`/api/adtech`, `/api/leadgen`, `/api/fleet`, `/api/admin`) alongside legacy routes.
- Add `tenant_id` column to domain tables with migration and backfill default UUID.
- Scaffold a new `auth-service` that issues RS256-signed JWTs and exposes `/.well-known/jwks.json`.
- Upgrade monolith `authenticateToken` middleware to support both JWKS verification and legacy `JWT_SECRET`.
- Add docker-compose with a gateway service to route requests (`/api/auth/*` → auth-service, other prefixes → monolith).
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
  - `backend/src/server.js`: mounts `/api/adtech/*`, `/api/leadgen/*`, `/api/fleet/*`, `/api/admin/*` when `ENABLE_DOMAIN_PREFIXES=true`.
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
- Routes mounted: `/api/adtech/*`, `/api/leadgen/*`, `/api/fleet/*`, `/api/admin/*` and health endpoints.
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
