#!/usr/bin/env bash
set -euo pipefail

echo "1) JWKS"
curl -s http://localhost:4001/.well-known/jwks.json | jq '.keys[0] | {kid, alg, use}'

echo "2) Login"
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .data.token)
echo "Token header/payload:"
echo $TOKEN | cut -d. -f1,2 | tr '.' '\n' | while read part; do echo $part | base64 -D 2>/dev/null || echo $part | base64 --decode 2>/dev/null; done

echo "3) Prefixed health via gateway"
curl -s http://localhost:4000/api/adtech/health -H "Authorization: Bearer $TOKEN" | jq .


