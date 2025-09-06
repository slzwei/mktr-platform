LeadGen Service
================

Overview
--------
Express + Postgres service for lead generation domain using schema `leadgen`.

Run locally
-----------
- Install deps: `npm ci`
- Env (example):
  - `DATABASE_URL=postgres://user:pass@postgres:5432/app`
  - `PG_SCHEMA=leadgen`
  - `AUTH_JWKS_URL=http://auth:4001/.well-known/jwks.json`
  - `AUTH_ISSUER=https://mktr-auth`
  - `AUTH_AUDIENCE=web`
  - `LOG_LEVEL=info`
- Start: `npm start` (port 4002)

Health
------
`GET /health` → `{ ok: true, service: "leadgen" }`


