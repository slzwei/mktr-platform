### Dev stack quickstart

1) Bring up the stack
```
cd infra
docker compose up --build
```

2) Get a token from auth service
```
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .data.token)
```

3) Call prefixed route via gateway
```
curl -s http://localhost:4000/api/adtech/health -H "Authorization: Bearer $TOKEN"
```

Feature flags:
- ENABLE_DOMAIN_PREFIXES=true (monolith)
- AUTH_JWKS_URL set (monolith)


