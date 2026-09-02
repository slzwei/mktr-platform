# MKTR sandbox — deploy, verify, roll back

Operational companion to `docs/plans/mktr-production-sandbox.md`. Everything here
is reversible; every step names the exact thing to change.

---

## 1. What exists

| Resource | Render id | Purpose |
|---|---|---|
| `mktr-sandbox-api` (web, singapore, starter) | `srv-dac04mifngtc73fgj5e0` | The whole sandbox: Express API **and** the sandbox SPA build, so `/api/*` is genuinely same-origin |
| `mktr-sandbox-db` (Postgres 17, basic_256mb) | `dpg-dac02uv40ujc73ajhn2g-a` | Isolated sandbox database. Never contains production data |
| `mktr-dnc-gateway` (web, singapore, starter) | `srv-dac04fbtqb8s73dov420` | The ONE shared DNC queue. Sole holder of the PDPC credential |
| `mktr-dnc-gateway-db` (Postgres 17, basic_256mb) | `dpg-dac030740ujc73ajhqd0-a` | The queue's own database — belongs to neither application |

Both services have **auto-deploy off**: promotion is an explicit `trigger_deploy`
of a chosen commit, which is what "pinned exact-SHA promotion" means on Render.

### Why one service serves both the SPA and the API

The plan requires browser calls on same-origin `/api/*`. A separate static site
would need a Render rewrite rule to reach the API — a second place for the
sandbox to be pointed at the production API by a stale value, and a rule that
cannot be set through the Render MCP. Serving the built SPA from the sandbox API
removes the question entirely: same origin by construction, host-only cookies,
no CORS in the browser path, and `SANDBOX_SPA_DIR` is only ever set on the
sandbox, so production is untouched.

---

## 2. Wiring a fresh sandbox

### 2.1 Secrets that must be pasted by a human

These cannot be read back through the Render API, so they are copied in the
dashboard. Nothing else is manual.

| Service | Variable | Where the value comes from |
|---|---|---|
| `mktr-sandbox-api` | `DATABASE_URL` | `mktr-sandbox-db` → **Internal Database URL** |
| `mktr-dnc-gateway` | `DNC_GATEWAY_DATABASE_URL` | `mktr-dnc-gateway-db` → **Internal Database URL** |
| `mktr-dnc-gateway` | `DNC_ORG_CODE`, `DNC_ESERVICE_ID`, `DNC_PRIVATE_KEY`, `DNC_HTTPS_PROXY` | Copied from `mktr-backend-jo6r` — the same production credential, moved, not duplicated |
| `mktr-dnc-gateway` + `mktr-backend-jo6r` | `DNC_GATEWAY_TOKEN_PRODUCTION` / `DNC_GATEWAY_TOKEN` | One freshly generated shared secret, same value on both |
| `mktr-sandbox-api` | `SNS_AWS_ACCESS_KEY_ID`, `SNS_AWS_SECRET_ACCESS_KEY` | Only when the live OTP test is being run |

### 2.2 First boot: initialize and seed

Initialization and seeding are ordinary start-time steps guarded by their own
flags, because Render has no first-class one-off job. `scripts/sandbox-boot.mjs`
decides whether to invoke them; the commands themselves stay strict and still
refuse when invoked directly without their flag.

1. Set `SANDBOX_INIT_DB_ALLOWED=true` and `SANDBOX_SEED_ALLOWED=true`.
2. Deploy. The logs show `[sandbox:init-db] done — initialized` and
   `[sandbox:seed] complete`.
3. Set both flags back to `false` and deploy again.

Re-running either step is safe — init is a no-op on an already-initialized
database and seed upserts by stable id — but leaving the flags armed means a
restart re-asserts seeded passwords, so turn them off.

### 2.3 Rebuild from nothing

There is deliberately **no destructive reset command**. To rebuild: create a new
Postgres, point `DATABASE_URL` at it, and repeat §2.2. The old database is
deleted by hand once the new one is proven.

---

## 3. Moving production DNC onto the shared queue

This is the only step that touches production. It is reversible in one variable.

**Before:** `mktr-backend-jo6r` holds the PDPC credential and calls
`https://www.dnc.gov.sg/realtime` directly.
**After:** it holds `DNC_GATEWAY_URL` + `DNC_GATEWAY_TOKEN` and submits to the
queue, which holds the credential.

1. Deploy `mktr-dnc-gateway` with the credential and
   `DNC_GATEWAY_TOKEN_PRODUCTION` set, and **`DNC_GATEWAY_TOKEN_SANDBOX` unset**.
   Sandbox traffic is not admitted yet.
2. Confirm `GET https://mktr-dnc-gateway.onrender.com/health` reports
   `"credentialed": true` and `"database": "ok"`.
3. On `mktr-backend-jo6r`, add `DNC_GATEWAY_URL` and `DNC_GATEWAY_TOKEN`. Leave
   the DNC credential in place for now — `usesGateway()` takes precedence, so the
   credential is inert but instantly available for rollback.
4. Watch one real production DNC check end to end: the gateway logs
   `dnc_gateway.sent` with a `status_code` and `transactionId`, and the prospect
   row records the same transaction id.
5. Only then set `DNC_GATEWAY_TOKEN_SANDBOX` on the gateway and
   `DNC_API_ENABLED=true` + `SANDBOX_LIVE_DNC_ENABLED=true` on the sandbox.
6. After a soak, remove the now-unused DNC credential from `mktr-backend-jo6r`.

**Rollback:** delete `DNC_GATEWAY_URL` from `mktr-backend-jo6r`. It reverts to
direct PDPC calls on the next restart, with no code change and no deploy. This is
why step 6 waits.

---

## 4. Kill switches

Each takes effect on the next restart, which a Render env-var change triggers
automatically. No deploy, no code change.

| Situation | Switch |
|---|---|
| Any unexpected SMS | `SANDBOX_LIVE_OTP_ENABLED=false` |
| Any unexpected DNC spend from the sandbox | `SANDBOX_LIVE_DNC_ENABLED=false` (or `DNC_API_ENABLED=false`) |
| Any unexpected email | `SANDBOX_LIVE_EMAIL_ENABLED=false` |
| Sandbox must stop reaching the queue at all | Unset `DNC_GATEWAY_TOKEN_SANDBOX` **on the gateway** — this is the stronger switch, because it does not rely on the sandbox behaving |
| Sandbox must stop delivering webhooks | `WEBHOOK_ENABLED=false` |
| Whole sandbox down | Suspend `mktr-sandbox-api` |

Production is unaffected by every one of these.

---

## 5. Verifying a deploy

```bash
BASE=https://mktr-sandbox-api.onrender.com     # or https://sandbox.mktr.sg once DNS is cut over

# Alive, and self-identifying as a sandbox
curl -si "$BASE/health" | grep -i 'x-deploy-env\|x-robots-tag'

# The outbound policy actually in force — caps, switches, allowlist COUNTS
curl -s "$BASE/health/sandbox" | jq

# Never indexed
curl -s "$BASE/robots.txt"

# The SPA is served and labelled
curl -s "$BASE/" | grep -o 'SANDBOX[^<]*'

# The negative test that gates every live rail
curl -s -X POST "$BASE/api/verify/send" -H 'Content-Type: application/json' \
  -d '{"phone":"91234567","countryCode":"+65"}'
# → 403, and the logs show outbound_policy.otp.blocked reason=not_allowlisted
```

The gateway:

```bash
curl -s https://mktr-dnc-gateway.onrender.com/health | jq
curl -s https://mktr-dnc-gateway.onrender.com/v1/stats -H "Authorization: Bearer $TOKEN" | jq
```

---

## 6. Rolling back the application

Application rollback is deploying a known-good commit, never moving a branch
pointer. With auto-deploy off:

1. Render dashboard → the service → **Deploys** → the last good deploy →
   **Redeploy**.
2. Or `trigger_deploy` after pointing the service's branch at that commit.

Every migration in this change set is additive, so the previous application
commit runs against the current schema. If a future migration is not backward
compatible, rebuild the sandbox database (§2.3) rather than restoring it — the
data is synthetic and disposable, which is the point.

Never run the test baseline restore (`restoreBaseline.js`) against the sandbox
database: it drops `public`. `sandbox:init-db` is the only initializer that is
safe to point at a persistent database, and it never drops anything.

---

## 7. Custom domains

`sandbox.mktr.sg` and `api.sandbox.mktr.sg` both point at `mktr-sandbox-api`.
`mktr.sg` DNS is hosted at **mschosting.com**, not Cloudflare (only `redeem.sg`
is on Cloudflare), so the two records are added there:

```
sandbox        CNAME  mktr-sandbox-api.onrender.com
api.sandbox    CNAME  mktr-sandbox-api.onrender.com
```

Add both domains to the service in Render first (Settings → Custom Domains), then
create the records. Until DNS exists the sandbox is reachable at
`https://mktr-sandbox-api.onrender.com`, which is already in
`SANDBOX_PUBLIC_HOSTS`, so host detection, cookies and CORS all work there.

After the cutover, update `MKTR_FRONTEND_URL`, `REDEEM_FRONTEND_URL`,
`PUBLIC_BASE_URL`, `FRONTEND_BASE_URL` and `CORS_ORIGIN` to
`https://sandbox.mktr.sg` so generated links stop naming the platform host.
