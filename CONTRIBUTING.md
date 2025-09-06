## Local development (Phase A - Auth & Prefixes)

### Prerequisites
- Node 18+
- Docker & Docker Compose

### Stack
- Monolith API (Express) on :3301 (container 3001)
- Auth Service (RS256, JWKS) on :4001
- API Gateway (JWT verify + proxy) on :4000
- Postgres 16 on :55432 (container 5432)

### Run with Docker Compose
```
cd infra
docker compose up --build
```

Smoke test:
```
curl -s http://localhost:4001/.well-known/jwks.json | jq .
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .data.token)
curl -s http://localhost:4000/api/adtech/health -H "Authorization: Bearer $TOKEN"
```

### Feature flags
- ENABLE_DOMAIN_PREFIXES=true on monolith mounts prefixed routes alongside legacy routes.
- AUTH_JWKS_URL on monolith enables RS256 via JWKS with legacy fallback.


