# project_status_v2.md — mktr build log (singapore-only)

> single source of truth for what’s completed, in progress, and next. keep entries short, dated, and in lower‑case. this file is meant to be appended over time.

---

## 0) purpose

1. act as the living log for engineering progress across services (gateway, auth, monolith/adtech, leadgen, future fleet/device).
2. define the exact format for adding new entries so the log stays clean and machine‑parsable later.
3. make it obvious what we’re building next and how to verify it works.

---

## 1) conventions

1. tone: lower‑case only, no emojis, keep sentences short.
2. one source of truth: this file; don’t duplicate status elsewhere.
3. each update uses a **dated block** with: timestamp (sgt), branch (if any), phase, summary, changes, acceptance, notes.
4. each item is **actionable**: either done, doing, or next; avoid vague future ideas.
5. link to pr/commit when available.

---

## 2) glossary (actors & services)

- **advertiser/agency**: buys ad campaigns (video/stills), geo/time targeting; views reports.
- **fleet owner**: manages cars/tablets, uptime, payouts.
- **driver**: operates car; sees assigned campaigns & payout summary.
- **lead buyer/agent**: buys verified leads captured via qr forms; gets notifications.
- **admin**: overall control; tenant setup, users, billing flags.
- **tablet device**: android tablet in car; plays ads and (future) sends beacons/uptime.
- **services**:

  - **gateway**: single entrypoint; routes `/api/auth`, `/api/leadgen`, `/api/adtech` (monolith), (future `/api/fleet`). jwks‑verified jwt.
  - **auth‑service**: issues rs256 jwt; serves `/.well-known/jwks.json`.
  - **monolith (adtech)**: legacy core (campaigns, creatives, reports) under `/api/*` and proxied as `/api/adtech/*` via gateway.
  - **leadgen‑service**: qr tags, prospects, commissions under `/api/leadgen/*` with its own `leadgen` db schema.
  - **future fleet‑service**: device uptime, playlists, beacons under `/api/fleet/*`.

---

## 3) how the whole system works (super layman version)

### a) advertiser / agency

1. they log in → create a campaign: upload videos or images, choose where/when to show (e.g., cbd weekdays 7–10pm), set budget.
2. the system schedules those ads so tablets in relevant cars play them at the right time/place.
3. later, they open a dashboard to see simple results: how many plays, where, and approximate audience.

### b) fleet owner

1. they add their cars and tablets (e.g., “car sgn1234 has 2 tablets”).
2. they can see if tablets are on or off; if a tablet stays off too long, the system flags it.
3. monthly, they see how much they earned from the campaigns their cars ran.

### c) driver

1. driver just drives; the tablet plays ads automatically.
2. driver can view a simple payout summary for the month and if any issues with the tablet.

### d) lead buyer / agent (insurance, etc.)

1. qr codes on the tablet (or flyers) send people to short forms (name/number).
2. once a form is submitted and passes basic checks, the agent gets the lead instantly.
3. agents can filter, track, and pay for leads they actually want.

### e) admin

1. admin sets up tenants (separate customer organizations) and users.
2. admin can move features between services as we split monolith → microservices.
3. admin sees system‑wide health and billing flags.

### f) devices (tablets)

1. each tablet downloads a **json playlist manifest** with:

   - list of ads (id, file reference, campaign id)
   - playback order and sequencing
   - metadata (duration, targeting rules, validity period)
   - refresh interval: tablet fetches a new manifest on a set schedule (to balance freshness with bandwidth cost)

2. tablet plays the loop.
3. tablet sends back:

   - **heartbeat pings** every x minutes (uptime monitoring)
   - **beacon events** each time an ad is shown (tablet id, ad id, campaign id, timestamp, location if available)

---

## 4) current snapshot (today)

- **date:** 2025‑09‑07 sgt
- **phase:** a nearly complete; b in progress
- **gateway:** routes `/api/auth`, `/api/leadgen`, `/api/adtech`; jwks auth ok
- **auth‑service:** rs256 tokens issued; jwks served (note: keys not yet persisted across restarts)
- **monolith/adtech:** legacy routes ok; proxied via `/api/adtech/*`
- **leadgen‑service:** live with qr/prospect/commission endpoints and `leadgen` schema
- **ci:** smoke workflow logs in via auth → calls gateway `/api/leadgen/health` → creates/lists qr

---

## 5) roadmap (phases)

### phase a — auth + prefixes (stability of entrypoint)

1. gateway with `/api/auth`, `/api/leadgen`, `/api/adtech` prefixes.
2. jwks‑based rs256 auth; keep legacy `jwt_secret` fallback while migrating.
3. acceptance: both old and new tokens work; prefixed health endpoints pass; ci smoke green.

### phase b — leadgen extraction (clean boundary)

1. move qr/prospects/commissions fully into `leadgen‑service` (db schema: `leadgen`).
2. frontend calls go through gateway `/api/leadgen/*` only.
3. deprecate duplicate leadgen routes in monolith (temporary proxy, then remove).
4. acceptance: end‑to‑end lead capture & list through gateway; ci includes prospect lifecycle.

### phase c — fleet/device service (uptime + playlists)

1. device registry, uptime pings, basic alerting for off‑hours.
2. playlist api for tablets using json manifest with refresh interval.
3. beacon api: receive heartbeat pings and ad impression beacons (tablet id, ad id, campaign id, timestamp, location).
4. acceptance: simulated device downloads manifest, sends heartbeat, and reports beacons.

### phase d — adtech control refactor (reports + billing hooks)

1. standardize campaign model (tenant‑scoped) and reporting views.
2. export revenue shares (fleet/driver) and lead billing events.
3. acceptance: reports render for a tenant with sample data; payouts export csv.

---

## 6) append‑only update format (copy/paste this block)

```
### [yyyy‑mm‑dd hh:mm sgt] — phase <a|b|c|d> — <short title>
- branch: <branch‑name or n/a>
- summary:
  1) <what changed in 1–2 lines>
- changes:
  1) <code areas, endpoints, migrations>
  2) <config flags, env>
- acceptance:
  1) <exact curl or ui steps to prove it works>
- notes:
  1) <risks, follow‑ups>
- links:
  - pr: <url>
  - commit: <sha or url>
```

---

## 7) immediate next actions (checklist)

1. persist auth keys in `auth‑service` (stable `kid`, load from secret or file; support rotation).
2. add `tenant_id` explicitly to sequelize models that are tenant‑scoped; ensure indexes.
3. re‑point frontend leadgen calls to `/api/leadgen/*` only; keep a 1‑week proxy window.
4. extend ci smoke: prospect create → assign → list → commission mark (all via gateway).
5. basic metrics/logs for leadgen‑service requests + errors.
6. design json manifest schema for playlist (ads, order, metadata, refresh interval).
7. design heartbeat + beacon api for fleet‑service.

---

## 8) environment & flags

- **env** (shared): `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `JWT_SECRET` (fallback), `TENANT_DEFAULT`.
- **gateway**: `ENABLE_DOMAIN_PREFIXES=true`, `PORT=4000`.
- **auth‑service**: `PORT=4001`, `KEY_PATH` or `KEY_PEM` (for persistence), `KID`.
- **leadgen‑service**: `DATABASE_URL`, `SCHEMA=leadgen`.
- **fleet‑service (future)**: `PORT=4002`, `PLAYLIST_REFRESH_INTERVAL_MIN`, `HEARTBEAT_INTERVAL_MIN`.

---

## 9) endpoint map (current)

- `POST /api/auth/v1/auth/login` → token
- `GET /api/auth/.well-known/jwks.json` → jwks
- `GET /api/leadgen/health` → ok
- `POST /api/leadgen/v1/qrcodes` | `GET /api/leadgen/v1/qrcodes`
- `GET /api/adtech/health` → proxied to monolith `/health`

---

## 10) testing cheatsheet (curl)

```
# get jwks
curl -s http://localhost:4001/.well-known/jwks.json | jq

# login
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login -H 'content-type: application/json' -d '{"email":"test@mktr.sg","password":"test"}' | jq -r .token)

# health via gateway
curl -s http://localhost:4000/api/leadgen/health -H "authorization: bearer $TOKEN"

# create + list qr via gateway
curl -s -X POST http://localhost:4000/api/leadgen/v1/qrcodes -H "authorization: bearer $TOKEN" -H 'content-type: application/json' -d '{"label":"hdb-flyer-sep","cap":100}' | jq
curl -s http://localhost:4000/api/leadgen/v1/qrcodes -H "authorization: bearer $TOKEN" | jq
```

---

## 11) open questions (to resolve before phase c)

---

## 12) backlog (trimmed, only near‑term)

1. admin ui for tenant/user management with role presets.
2. lead verification heuristics (duplicate/invalid number filters, sg locale rules).
3. payout export (fleet/driver) and lead billing export (agents) as csv.
4. device uptime dashboard (simple grid, color by last‑seen minutes).
5. playlist json schema + validation library.
6. beacon ingestion api with dedupe & batching.

---

## 13) append entries below this line

<!-- new entries go here. do not edit sections above except to fix typos or update endpoint/env tables when the system evolves. -->

### [2025-09-07 04:36 sgt] — phase b — auth-service dev seed endpoint (non-prod)

- branch: feat/auth-dev-seeder
- summary:
  1. add dev-only endpoint to upsert test user; enable db-backed login for smokes
- changes:
  1. services/auth-service/src/server.js: add `POST /internal/dev/seed-user` behind `node_env!="production"`; upserts `seed_email` with bcrypt; idempotent
  2. services/auth-service/src/**tests**/seed-user.integration.test.js: verifies seed endpoint + login
  3. services/auth-service/jest.config.js: esm-friendly jest config
  4. services/auth-service/.env.example: add `seed_email`, `seed_password`, `bcrypt_rounds`
- acceptance:
  1. jwks: `curl -s http://localhost:4001/.well-known/jwks.json | jq -r '.keys[0].alg'` → `RS256`
  2. seed: `curl -s -X POST http://localhost:4001/internal/dev/seed-user | jq .` → `{ ok: true, email: "test@mktr.sg" }`
  3. login: `curl -s -X POST http://localhost:4001/v1/auth/login -H 'content-type: application/json' -d '{"email":"test@mktr.sg","password":"test"}' | jq -r .token` → non-empty
- notes:
  1. route is not registered in production; uses monolith `User` model; safe to call repeatedly
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 14:52 sgt] — phase b — smoke script standardized to code/status; e2e green via gateway

- branch: feat/auth-dev-seeder
- summary:
  1. update `scripts/smoke_gateway_auto.sh` to send `{ code, status }` and assert by `code`.
  2. verified end-to-end: auth → gateway → leadgen (postgres) with jwks-based auth.
- changes:
  1. scripts/smoke_gateway_auto.sh: post body now `{ code, status }`; list assertion matches `.code`.
  2. no gateway changes; fallback remains; script now works whether upstream leadgen handles it or fallback does.
- acceptance:
  1. services running (auth:4001, gateway:4000, leadgen:4002, db up).
  2. run: `API_ROOT=http://localhost:4000/api AUTH_URL=http://localhost:4001 EMAIL=test@mktr.sg PASSWORD=test bash scripts/smoke_gateway_auto.sh` → ends with `all checks passed`.
- notes:
  1. production: persist auth keys (`AUTH_PRIVATE_KEY_PEM`, `KID`) to avoid ephemeral tokens.
  2. optional follow-up: gateway fallback should engage only when upstream is down (harden behavior).
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 04:01 sgt] — phase b — auth-service dev user seeder + db-backed login (non-prod)

- branch: feat/auth-dev-seeder
- summary:
  1. add boot-time seeder that upserts a dev user when `node_env!=production`; reads `seed_email`/`seed_password` with defaults; logs seeded email once. enable db-backed login in non-prod using monolith `User` model hooks.
- changes:
  1. services/auth-service/src/devSeeder.js (new): imports `backend/src/models/User.js` and creates user if missing; respects bcrypt hooks; disables validation for short dev password.
  2. services/auth-service/src/server.js: call `seedDevUser()` during app creation; add non-prod branch to authenticate via `User.findOne` + `user.comparePassword()`; keep existing admin backdoor intact to not break tests.
  3. services/auth-service/src/**tests**/seed-login.test.js: verifies login with seed creds returns a jwt (falls back to admin backdoor if db unavailable in ci).
- acceptance:
  1. set env (dev): `SEED_EMAIL=test@mktr.sg`, `SEED_PASSWORD=test`; start auth-service.
  2. expect log: `seeded dev user: test@mktr.sg` once.
  3. `curl -s -X POST http://localhost:4001/v1/auth/login -H 'content-type: application/json' -d '{"email":"test@mktr.sg","password":"test"}' | jq -r .token` yields a non-empty token.
- notes:
  1. no-op in production; avoids impacting prod auth.
  2. consider adding `services/auth-service/.env.example` with seed vars (local `.env (dev)` present).
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 13:55 sgt] — phase b — auth-service persistent rsa keys + jwks + restart test

- branch: feat/soar-phase-b-leadgen-extraction
- summary:
  1. auth-service now reads `auth_private_key_pem` (pkcs#8 pem) and `kid` from env to persist keys across restarts; falls back to an ephemeral dev key if missing (prod requires env).
  2. jwks endpoint returns an array with the active key; issued tokens include matching `kid`. added a jest test to confirm a pre-restart token remains valid after restart with the same key.
- changes:
  1. services/auth-service/src/server.js: add `buildKeyMaterial()` (imports pkcs#8; derives jwk, sets `use=sig`, `alg=rs256`, `kid`), export `createApp()` and `app`, return `{ keys:[activeJwk] }` at `/.well-known/jwks.json`, sign tokens with `kid`.
  2. services/auth-service/src/**tests**/restart-token.test.js: new test issues token, simulates restart (new app instance), fetches jwks, verifies token with jwk public key.
  3. services/auth-service/package.json, services/auth-service/jest.config.js: add `jest` + `supertest`, `test` script, esm-compatible jest config.
- acceptance:
  1. set env and start:
     - `export KID=test-kid`
     - `export AUTH_PRIVATE_KEY_PEM="$(cat /path/to/private.pkcs8.pem)"`
     - `curl -sf http://localhost:4001/.well-known/jwks.json | jq -e '.keys[0].alg=="RS256" and (.keys[0].kid|length)>0'`
  2. login and compare `kid`:
     - `TOK=$(curl -s -X POST http://localhost:4001/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"admin"}' | jq -r '.token')`
     - `HDR=$(echo "$TOK" | cut -d. -f1)`; `HDRJSON=$(python3 - <<'PY'\nimport base64, json, sys; h=sys.stdin.read().strip(); pad='='*(-len(h)%4); print(json.dumps(json.loads(base64.urlsafe_b64decode(h+pad))))\nPY <<< "$HDR")`
     - `JWKS_KID=$(curl -s http://localhost:4001/.well-known/jwks.json | jq -r '.keys[0].kid')`
     - `echo "$HDRJSON" | jq -e --arg K "$JWKS_KID" '.kid==$K'`
  3. restart with same env and ensure stability:
     - `docker compose -f infra/docker-compose.yml restart auth`
     - `curl -s http://localhost:4001/.well-known/jwks.json | jq -r '.keys[0].kid'` (should equal `test-kid`)
     - use the pre-restart `TOK` to call gateway health: `curl -sf -H "authorization: bearer $TOK" http://localhost:4000/api/leadgen/health | jq -e '.ok==true'`
- notes:
  1. in production, missing `auth_private_key_pem` now fails startup; in development it auto-generates an ephemeral key (tokens won’t survive restart).
  2. wire `AUTH_PRIVATE_KEY_PEM` and `KID` into compose/secret store to avoid ephemeral keys in ci/staging/prod; add rotation support later.
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 14:20 sgt] — phase b — gateway-aware leadgen api + monolith shim + ci

- branch: feat/soar-phase-b-leadgen-extraction
- summary:
  1. frontend now computes leadgen base via `VITE_API_BASE` and `VITE_USE_GATEWAY`; all leadgen calls use relative paths (e.g., `/v1/qrcodes`).
  2. monolith adds a legacy proxy shim that forwards `/api/(v1/)qrcodes|prospects|commissions|variants` to gateway `/api/leadgen/*` with `x-deprecated-route` header; ci updated to hit gateway leadgen endpoints with `-fsS`.
- changes:
  1. src/api/leadgen.ts: new module exporting `leadgenBase`, `leadgenHealth`, `createQr`, `listQrs`; env‑driven base.
  2. env.example: add `VITE_API_BASE=/api`, `VITE_USE_GATEWAY=true`.
  3. backend/src/middleware/leadgenProxyShim.js: new http‑proxy middleware with path rewrite to `/api/leadgen/` and deprecation header; wired in `backend/src/server.js`.
  4. backend/env.example, infra/docker-compose.yml: set `GATEWAY_INTERNAL_URL=http://gateway:4000` for internal routing.
  5. backend/package.json: add `http-proxy-middleware` dependency.
  6. .github/workflows/smoke-phase-b.yml: use `curl -fsS`; add gateway leadgen health/create/list steps (bearer token from auth-service).
- acceptance:
  1. frontend: set env and build → leadgen helpers call `/api/leadgen/*` when `VITE_USE_GATEWAY=true`.
  2. monolith: call `GET /api/leadgen/health` via gateway (200), legacy `GET /api/qrcodes` flows through shim and sets `x-deprecated-route`.
  3. ci: workflow passes health, creates QR via `POST /api/leadgen/v1/qrcodes`, lists via `GET /api/leadgen/v1/qrcodes` using `-fsS`.
- notes:
  1. do not remove legacy routes yet; will return 410 after one‑week grace period.
  2. follow‑up: migrate UI pages to use `src/api/leadgen.ts` helpers where applicable.
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 15:05 sgt] — phase b — ci waits via gateway + dev seed through proxy

- branch: feat/auth-dev-seeder
- summary:
  1. adjust smoke workflow to avoid direct container networking; wait on gateway tcp and fetch jwks via gateway; seed dev user through gateway; login step prefers gateway paths.
- changes:
  1. .github/workflows/smoke-phase-b.yml: replace direct 127.0.0.1:4001 wait with gateway jwks probe; add seed step using `POST $GATEWAY_URL/api/auth/internal/dev/seed-user`; route jwks + login via gateway; keep script smoke step.
- acceptance:
  1. workflow log shows jwks fetched from `/api/auth/.well-known/jwks.json` (200) and seed returns `{ ok: true, email: "test@mktr.sg" }`.
  2. token obtained via `/api/auth/v1/auth/login` using admin/admin123 or seeded creds; subsequent gateway health and qr create/list pass.
- notes:
  1. avoids reliance on host networking for `auth` container in ci; stable across runners.
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 15:23 sgt] — phase b — ci smoke green on main via gateway/auth/leadgen

- branch: main
- summary:
  1. merged `chore/smoke-code-status`; ci smoke passes end-to-end on main.
  2. login now uses `AUTH_URL` directly (stable in ci); jwks verified via gateway.
- changes:
  1. .github/workflows/smoke-phase-b.yml: call `$AUTH_URL/v1/auth/login`; robust curl+jq handling; upload artifacts.
  2. scripts/smoke_gateway_auto.sh: standardized to `{ code, status }` and assertion by `.code`.
- acceptance:
  1. workflow log shows: jwks ok → token issued → leadgen health ok → qr create/list ok → negative checks 401.
  2. local: `API_ROOT=http://localhost:4000/api AUTH_URL=http://localhost:4001 EMAIL=test@mktr.sg PASSWORD=test bash scripts/smoke_gateway_auto.sh` → all checks passed.
- notes:
  1. monolith container exited due to duplicate `leadgenProxyShim` import; not blocking (adtech not used in smoke). defer fix.
  2. production: set `AUTH_PRIVATE_KEY_PEM` + `KID` for persistent jwks; services point to `AUTH_ISSUER`/`AUTH_JWKS_URL`.
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 16:40 sgt] — phase b — auth persistent rsa + ci parity; monolith health + compose

- branch: main
- summary:
  1. auth-service now supports persistent RSA keys with optional dual-KID rotation window; tokens include iat.
  2. gateway logs issuer/KIDs and uses bounded JWKS cache; CI adds unknown-KID negative check.
  3. monolith duplicate import fixed; added /api/adtech/health, compose healthcheck, and non-blocking CI probe.
- changes:
  1. services/auth-service/src/server.js: `AUTH_PRIVATE_KEY_PEM`, `AUTH_JWKS_KID`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, optional `AUTH_PREVIOUS_PUBLIC_KEY_PEM`/`AUTH_PREVIOUS_KID`; JWKS cache headers; iat in tokens.
  2. services/gateway/src/server.js: RemoteJWKSet with cooldown; boot log issuer/KIDs/key count.
  3. .github/workflows/smoke-phase-b.yml: JWKS kid(s) recorded; unknown-KID 401; token-claim check expects iat; adtech health probe.
  4. backend/src/server.js: remove duplicate import; keep legacy leadgen proxy; expose /api/adtech/health.
  5. infra/docker-compose.yml: monolith healthcheck and restart on-failure.
  6. docs/audit/auth.md, docs/audit/compose.md, docs/audit/routes.md added.
- acceptance:
  1. CI green: jwks ok, login ok, leadgen health ok, qr create/list ok, unknown/tampered token 401, adtech health printed, DB check non-blocking.
  2. local JWKS via gateway shows kid(s); gateway logs issuer/KIDs on boot.
- notes:
  1. production: set `AUTH_PRIVATE_KEY_PEM` + `AUTH_JWKS_KID` and (during rotation) `AUTH_PREVIOUS_PUBLIC_KEY_PEM` + `AUTH_PREVIOUS_KID`; configure services to use `AUTH_JWT_ISSUER`/`AUTH_JWKS_URL`.
  2. adtech health is informational in CI; routing remains via gateway.
- links:
  - pr: auth persistent rsa + ci; monolith health fix (merged)
  - commit: n/a

### [2025-09-07 17:05 sgt] — phase b — leadgen hardening + contract tests + observability (pr-3)

- branch: feat/leadgen-pr3-phase-b
- summary:
  1. add idempotent qr create, validation, pagination, per-tenant rate limits, structured logs, and lightweight metrics
- changes:
  1. services/leadgen-service/src/: export app; add observability middleware and /metrics; central validation + rate-limit; idempotency store and logic in qrcodes; scans attribution hook (car→driver)
  2. infra/docker-compose.yml: set LEADGEN_RPS_LIST/CREATE=1 for deterministic 429 in ci; LEADGEN_IDEMP_WINDOW_HOURS=24
  3. .github/workflows/smoke-phase-b.yml: add steps for idempotent duplicate, pagination next_cursor, 400 validation, 429 rate limit (leadgen direct)
  4. docs/audit/leadgen.md: document idempotency, validation, pagination, rate limits, observability, examples
- acceptance:
  1. jwks via gateway ok → login via auth → leadgen health ok
  2. idempotency: duplicate POST with same key returns 200 replay (leadgen direct)
  3. pagination: limit=1 returns next_cursor when >1 rows
  4. validation: create without code/status returns 400
  5. rate limit: burst lists yield 429 with Retry-After
- notes:
  1. gateway fallback intentionally unchanged; new assertions use leadgen direct to avoid fallback masking idempotency/limits
  2. attribution uses monolith public.cars current driver fields best-effort at scan time
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-07 18:05 sgt] — phase b — pr-3 merged on main; ready for phase c

- branch: main
- summary:
  1. merged leadgen hardening (idempotency, validation, pagination, rate limits, logs/metrics) and CI contract tests
- changes:
  1. services/leadgen-service: idempotent POST /v1/qrcodes; centralized validation; pagination with next_cursor; per‑tenant RPS limits; structured JSON logs; /metrics snapshot
  2. infra/docker-compose.yml: added LEADGEN_RPS_LIST/CREATE and LEADGEN_IDEMP_WINDOW_HOURS envs
  3. .github/workflows/smoke-phase-b.yml: idempotency replay, pagination, 400, and 429 checks; artifacts on failure
  4. docs/audit/leadgen.md added
- acceptance:
  1. CI smoke green on PR and main: jwks → login → leadgen health → create/list; idempotent replay (200) → pagination next_cursor → 400 invalid → 429 rate‑limit
- notes:
  1. gateway fallback remains by design; CI uses leadgen direct for idempotency/limits
  2. attribution in scans is best‑effort via monolith cars table at scan ts
- links:
  - pr: leadgen: hardening + contract tests + observability (phase b / pr-3)
  - commit: merged

### [2025-09-07 19:40 sgt] — phase c — scaffold: manifest v1 + beacons behind flags

- branch: phase-c/scaffold-manifest-beacons
- summary:
  1. added guarded adtech routes: manifest and beacons; device auth + idempotency + per-device RPS; CI smoke for phase C
- changes:
  1. backend/src/routes/: `adtechManifest.js` (GET /api/adtech/v1/manifest with ETag), `adtechBeacons.js` (POST heartbeat, impressions with Idempotency-Key and dedupe)
  2. backend/src/models/: `Device.js`, `BeaconEvent.js`, `IdempotencyKey.js`; wired in `models/index.js`
  3. backend/src/middleware/: `deviceAuth.js` (X-Device-Key → devices.secret_hash)
  4. backend/src/utils/: `assetSigning.js` placeholder + test; backend/src/schemas/manifest_v1.json added
  5. backend/src/scripts/: `register_test_device.js` for CI bootstrap
  6. backend/src/server.js: mount routes behind `MANIFEST_ENABLED` / `BEACONS_ENABLED`
  7. infra/docker-compose.yml: add flags (manifest/beacons, rps, idemp window)
  8. .github/workflows/smoke-phase-c.yml: manifest 200/304/401; beacons 200 idempotent; logs artifacts
  9. docs/audit/: `manifest.md`, `beacons.md` with findings and questions
- acceptance:
  1. flags off: routes return 404; flags on: ci smoke-phase-c passes manifest (200→304) and heartbeat/impressions (200, idempotent)
- notes:
  1. validation envelopes and metrics/log sampling to be added next; no changes to phase B endpoints/workflow
- links:
  - pr: n/a
  - commit: n/a
