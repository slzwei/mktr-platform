#!/usr/bin/env bash
set -euo pipefail

echo "1) JWKS"
curl -s http://localhost:4001/.well-known/jwks.json | jq '.keys[0] | {kid, alg, use}'

echo "2) Login"
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .data.token)
echo "Token header:"
echo $TOKEN | awk -F. '{print $1}' | base64 -D 2>/dev/null || true
echo "Claims:"
echo $TOKEN | awk -F. '{print $2}' | base64 -D 2>/dev/null || true

echo "3) Prefixed health via gateway"
curl -s http://localhost:4000/api/adtech/health -H "Authorization: Bearer $TOKEN" | jq .


