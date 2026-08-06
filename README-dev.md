# Developer quickstart

Hands-on dev notes for the **live MKTR platform** (the `backend/` Express monolith + the `src/` React SPA). For the full overview see [`README.md`](README.md); for deep architecture see [`CLAUDE.md`](CLAUDE.md).

## Run the live stack

Two processes: the backend API and the Vite SPA.

```bash
# 1. Backend (needs a reachable PostgreSQL — DB_HOST is mandatory)
cd backend
cp env.example .env          # set DB_*, JWT_SECRET at minimum
npm install
npm run dev                  # http://localhost:3001  (health: /health, docs: /api-docs)

# 2. Frontend (in a second terminal, from repo root)
cp .env.example .env         # set VITE_API_URL=http://localhost:3001/api
npm install
npm run dev                  # http://localhost:5173
```

Need Postgres quickly? `cd backend && docker-compose up -d` brings up a local instance matching `env.example`.

### Run the SPA as any of the three surfaces
The same SPA builds into three Render static sites via `VITE_BRAND` / `VITE_SURFACE`:
```bash
npm run dev                      # mktr.sg (operator console) — default
VITE_BRAND=redeem npm run dev    # redeem.sg (marketplace + campaign pages + lead capture)
VITE_SURFACE=ops npm run dev     # ops.redeem.sg (Redeem Ops staff)
```
On the `redeem` build, admin/auth routes redirect to `mktr.sg`, so use the default brand for admin work. The `ops` build registers only auth + `/redeem-ops/*` and bounces everything else into the queue.

## Common tasks

```bash
# Backend
cd backend
npm run migrate                  # apply pending migrations (also runs automatically on boot)
npm run seed                     # seed sample data  ·  npm run seed:fleet
npm test                         # Jest (set JWT_SECRET; needs local Postgres for some suites)
npm run load:smoke               # local load harness (:spike / :stress / :soak / :rr)
./stress-test.sh run 1000        # generate test leads  ·  ./stress-test.sh cleanup

# Frontend (repo root)
npm test                         # Vitest  ·  npm run test:watch
npm run lint                     # ESLint
npm run build                    # production build → dist/
npm run analyze                  # build + bundle treemap (dist/stats.html)
npx playwright test              # E2E specs in e2e/
```

## Hitting the API

The API base is `http://localhost:3001/api`. Explore it via:
- **Swagger UI** at `http://localhost:3001/api-docs` (non-production only)
- **Postman** — import `backend/postman-collection.json`
- **Health/diagnostics** — `GET /health`, `GET /health/public-host`, `GET /health/sync`

Most routes need `Authorization: Bearer <jwt>`. Open to the public: lead capture (`POST /api/prospects`), the tracker/share redirects, reward claim (`GET /api/reward-claim/:token`), the screening callback, and `/api/unsubscribe`. Inbound webhook routes are verified over the raw request body — `/api/retell/`, `/api/integrations/lyfe/` and `/api/external/` by HMAC-SHA256, `/api/whatsapp/` by `X-Hub-Signature-256`.

## Integrations are opt-in

Retell (capture bot + screening calls), Meta Pixel/CAPI, TikTok, the Lyfe and mktr-leads webhooks, OTP (AWS SNS / Meta WhatsApp), WhatsApp template sends, DNC scrubbing, Redeem Ops, Apify Discover, HitPay, and object storage are **all optional and disabled unless their env vars are set** — the app boots and the core lead flow works without any of them. Lead delivery additionally requires the master switch `WEBHOOK_ENABLED="true"`. See [`backend/env.example`](backend/env.example) for the annotated list of every var the server reads.

> Meta Lead Ads ingestion (native instant forms) is flag-gated behind `META_LEAD_ADS_ENABLED` — off by default; with it on in production, boot fails unless `META_APP_SECRET`, `META_VERIFY_TOKEN`, and `META_PAGE_TOKEN_ENC_KEY` are set. Design: `docs/plans/meta-lead-ads-native-pipe.md`.

---

## ⏸ Paused: microservices stack (`infra/` + `services/`)

The repo also contains a **microservices migration scaffold** (`gateway` :4000, `auth-service` :4001, `leadgen-service`) wired with a docker-compose stack. It was started but **never put into production** — the live system is the `backend/` monolith above. It is **paused as of 2026-05-09** (see [`services/PAUSED.md`](services/PAUSED.md)). The instructions below are retained only for whoever revisits that effort:

```bash
# Paused scaffold — NOT the live system
cd infra
docker compose up --build

# Get a token from the auth service
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .data.token)

# Call a prefixed route via the gateway
curl -s http://localhost:4000/api/adtech/health -H "Authorization: Bearer $TOKEN"
```

Related feature flags on the monolith: `ENABLE_DOMAIN_PREFIXES=true` (mounts `/api/leadgen/*`, `/api/adtech/*` mirrors), `AUTH_JWKS_URL` / `AUTH_ISSUER` / `AUTH_AUDIENCE` (JWKS verification for an external identity provider).

> The `leadgenProxyShim.js` middleware that used to proxy into this scaffold was **deleted in PR #25** — nothing in the backend references `services/` any more, so the scaffold can be removed on its own whenever the owner decides.
