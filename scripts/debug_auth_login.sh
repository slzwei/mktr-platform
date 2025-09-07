#!/usr/bin/env bash
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:4000}"
AUTH_URL="${AUTH_URL:-http://localhost:4001}"
EMAIL="${EMAIL:-test@mktr.sg}"
PASSWORD="${PASSWORD:-test}"

try() {
  local method="$1"; shift
  local url="$1"; shift
  local data="$1"; shift
  echo -e "\n=== $method $url ==="
  set +e
  if [[ "$method" == "GET" ]]; then
    curl -i -sS "$url"
  else
    curl -i -sS -X "$method" "$url" -H 'content-type: application/json' -d "$data"
  fi
  local code=$?
  set -e
  echo -e "\n(exit code: $code)"
}

echo "Auth diagnostics — AUTH_URL=$AUTH_URL  GATEWAY_URL=$GATEWAY_URL"
echo "Probing health & JWKS…"
try GET "$AUTH_URL/health" ""
try GET "$AUTH_URL/.well-known/jwks.json" ""

echo -e "\nProbing direct login paths (AUTH_URL)…"
BODY="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
for p in /v1/auth/login /auth/login /v1/login /login; do
  try POST "$AUTH_URL$p" "$BODY"
done

echo -e "\nProbing gateway login paths (GATEWAY_URL)…"
for p in /api/auth/v1/auth/login /api/auth/auth/login /api/auth/v1/login /api/auth/login; do
  try POST "$GATEWAY_URL$p" "$BODY"
done

echo -e "\nHint: 401 with a JSON error like \"invalid credentials\" = user mismatch."
echo "      404 = wrong path. 5xx = service/config issue. Check docker logs:"
echo "      docker compose logs auth-service --tail=200"
