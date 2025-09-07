#!/usr/bin/env bash
# smoke_gateway_auto.sh
# Auto-detect API base (gateway:4000 vs vite:5173 proxy) and run leadgen smoke.
# Fails fast on any error. Requires: curl, jq.
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }; }
need curl; need jq

say() { printf "\n🟩 %s\n" "$*"; }
err() { printf "\n🟥 %s\n" "$*" >&2; exit 1; }

# --- config (can be overridden via env) ---
# Prefer explicit API root (must include /api) if user set it, e.g. http://localhost:4000/api
API_ROOT="${API_ROOT:-}"
EMAIL="${EMAIL:-test@mktr.sg}"
PASSWORD="${PASSWORD:-test}"

# Candidate API roots to probe (in order)
declare -a CANDIDATE_API_ROOTS=()
if [[ -n "${API_ROOT}" ]]; then
  CANDIDATE_API_ROOTS+=("${API_ROOT}")
fi
CANDIDATE_API_ROOTS+=(
  "http://localhost:4000/api"   # backend gateway
  "http://127.0.0.1:4000/api"
  "http://localhost:5173/api"   # vite dev proxy
  "http://127.0.0.1:5173/api"
)

# Common auth login paths (behind API root or direct AUTH_URL)
declare -a LOGIN_PATHS=(
  "/auth/v1/auth/login"
  "/auth/login"
  "/auth/v1/login"
  "/auth/token"
  "/auth/v1/token"
)

# --- helpers ---
probe_api_root() {
  local root="$1"
  # Try unauthenticated health first (many setups allow it)
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${root}/leadgen/health" || true)
  if [[ "$code" == "200" || "$code" == "401" ]]; then
    echo "$root"; return 0
  fi
  # Fallback: check gateway itself is reachable (302/404 acceptable)
  code=$(curl -s -o /dev/null -w "%{http_code}" "${root}/" || true)
  if [[ "$code" != "000" ]]; then
    echo "$root"; return 0
  fi
  return 1
}

try_login_via_api_root() {
  local root="$1"
  for p in "${LOGIN_PATHS[@]}"; do
    local url="${root}${p}"
    local out code
    out=$(curl -s -S -X POST "$url" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || true)
    # Extract token if present
    local tok
    tok=$(echo "$out" | jq -r 'try .token // empty' 2>/dev/null || true)
    if [[ -n "$tok" && "$tok" != "null" ]]; then
      echo "$tok"; return 0
    fi
    # if explicit invalid creds is returned, bubble it up (but keep probing other paths)
    if echo "$out" | jq -e 'has("error") or has("message")' >/dev/null 2>&1; then
      :
    fi
  done
  return 1
}

# Optionally allow direct AUTH_URL probing if provided
AUTH_URL="${AUTH_URL:-}"
try_login_direct_auth() {
  local base="$1"
  for p in "/v1/auth/login" "/auth/login" "/v1/login" "/login" "/token" "/v1/token"; do
    local url="${base}${p}"
    local out
    out=$(curl -s -S -X POST "$url" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || true)
    local tok
    tok=$(echo "$out" | jq -r 'try .token // empty' 2>/dev/null || true)
    if [[ -n "$tok" && "$tok" != "null" ]]; then
      echo "$tok"; return 0
    fi
  done
  return 1
}

# --- detection: pick a working API_ROOT ---
say "probing API roots (gateway or vite dev proxy)…"
API_OK=""
for cand in "${CANDIDATE_API_ROOTS[@]}"; do
  if API_OK=$(probe_api_root "$cand"); then
    say "using API_ROOT: $API_OK"
    API_ROOT="$API_OK"
    break
  fi
done
[[ -n "$API_ROOT" ]] || err "no reachable API root. tried: ${CANDIDATE_API_ROOTS[*]}"

# --- obtain token (prefer via API_ROOT /api/auth/… ; fallback to direct AUTH_URL if provided) ---
say "attempting login via API_ROOT (${API_ROOT})"
TOKEN="$(try_login_via_api_root "$API_ROOT" || true)"

if [[ -z "${TOKEN}" && -n "${AUTH_URL}" ]]; then
  say "login via direct AUTH_URL (${AUTH_URL})"
  TOKEN="$(try_login_direct_auth "$AUTH_URL" || true)"
fi

if [[ -z "${TOKEN}" ]]; then
  err "failed to obtain token. set EMAIL/PASSWORD or ensure dev seeder is enabled."
fi

# --- health via gateway (through selected API_ROOT) ---
say "leadgen health"
curl -fsS "${API_ROOT}/leadgen/health" -H "Authorization: Bearer $TOKEN" | jq .

# --- create QR via gateway ---
CODE="ci-qr-$(date +%s)"
say "create QR: $CODE"
CREATE_OUT="$(curl -fsS -X POST "${API_ROOT}/leadgen/v1/qrcodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"status\":\"active\"}")"
echo "$CREATE_OUT" | jq .
QR_ID="$(echo "$CREATE_OUT" | jq -r '.id // .data.id // empty')"
[[ -n "$QR_ID" ]] || err "qr create did not return an id"

# --- list QR & assert presence ---
say "list QR & assert code present"
LIST_OUT="$(curl -fsS "${API_ROOT}/leadgen/v1/qrcodes" -H "Authorization: Bearer $TOKEN")"
echo "$LIST_OUT" | jq '.'
MATCH_COUNT="$(echo "$LIST_OUT" | jq --arg C "$CODE" '[.. | objects? | select(has("code")) | select(.code == $C)] | length')"
[[ "$MATCH_COUNT" -ge 1 ]] || err "qr list did not include code $CODE"

say "all checks passed ✅ (API_ROOT=${API_ROOT})"
