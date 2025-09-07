#!/usr/bin/env bash
# smoke_gateway_leadgen.sh
# Non-interactive smoke test for LeadGen via GATEWAY (and optional legacy shim via MONOLITH).
# Fails fast on any error. Requires: curl, jq.
set -euo pipefail

# --- config (override via env) ---
GATEWAY_URL="${GATEWAY_URL:-http://localhost:4000}"
AUTH_URL="${AUTH_URL:-http://localhost:4001}"
# optional: set MONOLITH_URL to test the legacy shim header (e.g., http://localhost:4003 or http://gateway:4000 if it forwards /api/* to monolith)
MONOLITH_URL="${MONOLITH_URL:-}"

EMAIL="${EMAIL:-test@mktr.sg}"
PASSWORD="${PASSWORD:-test}"

# --- helpers ---
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }; }
say() { printf "\n🟩 %s\n" "$*"; }

need curl
need jq

# --- login ---
say "login via auth-service"
TOKEN="$(curl -fsS -X POST "$AUTH_URL/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.token')"

if [[ -z "${TOKEN}" || "${TOKEN}" == "null" ]]; then
  echo "failed to obtain token" >&2
  exit 1
fi

# --- health via gateway ---
say "gateway → leadgen health"
curl -fsS "$GATEWAY_URL/api/leadgen/health" -H "authorization: bearer $TOKEN" | jq .

# --- create QR via gateway ---
LABEL="ci-qr-$(date +%s)"
say "create QR via gateway: $LABEL"
CREATE_OUT="$(curl -fsS -X POST "$GATEWAY_URL/api/leadgen/v1/qrcodes" \
  -H "authorization: bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"label\":\"$LABEL\",\"cap\":5}")"
echo "$CREATE_OUT" | jq .

QR_ID="$(echo "$CREATE_OUT" | jq -r '.id // .data.id // empty')"
if [[ -z "${QR_ID}" ]]; then
  echo "qr create did not return an id" >&2
  exit 1
fi

# --- list QR via gateway & assert our label is present ---
say "list QR via gateway & assert label is present"
LIST_OUT="$(curl -fsS "$GATEWAY_URL/api/leadgen/v1/qrcodes" -H "authorization: bearer $TOKEN")"
echo "$LIST_OUT" | jq '.'

MATCH_COUNT="$(echo "$LIST_OUT" | jq --arg L "$LABEL" '[.. | objects? | select(has("label")) | select(.label == $L)] | length')"
if [[ "$MATCH_COUNT" -lt 1 ]]; then
  echo "qr list did not include the created label $LABEL" >&2
  exit 1
fi

# --- optional: call legacy monolith route and assert shim header ---
if [[ -n "$MONOLITH_URL" ]]; then
  say "legacy route via monolith (expect x-deprecated-route header)"
  # try both v1 and non-v1 paths; middleware should handle rewrite
  LEGACY_RESP_HEADERS="$(curl -isS -X POST "$MONOLITH_URL/api/v1/qrcodes" \
    -H "authorization: bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"label\":\"$LABEL-legacy\",\"cap\":2}" | sed -n '1,20p')"
  echo "$LEGACY_RESP_HEADERS"

  # accept either exact or case-insensitive header name
  if ! echo "$LEGACY_RESP_HEADERS" | grep -iq "^x-deprecated-route: *leadgen-monolith-shim"; then
    echo "missing x-deprecated-route header on legacy path (shim may not be wired)" >&2
    exit 1
  fi
fi

say "all checks passed ✅"
