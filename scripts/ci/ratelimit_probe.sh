#!/usr/bin/env bash
set -euo pipefail

# Usage: ratelimit_probe.sh METHOD URL [HEADER ...]
# Example: ratelimit_probe.sh GET http://localhost:4002/v1/qrcodes "Authorization: Bearer $TOK"
# Sends a single request and prints discovered rate-limit headers to stdout.
# Outputs a summary line with derived values:
#   DERIVED_BURST=<n>
#   DERIVED_WINDOW_SECS=<s>

method="${1:-GET}"
url="${2:-}"
shift 2 || true

headers=( )
extras=( )
for arg in "$@"; do
  if [[ "$arg" == -* ]]; then
    extras+=( "$arg" )
  elif [[ "$arg" == *:* ]]; then
    headers+=( -H "$arg" )
  elif [[ -n "$arg" ]]; then
    extras+=( "$arg" )
  fi
done

tmp_headers="$(mktemp)"
trap 'rm -f "$tmp_headers"' EXIT

# Perform request; do not follow redirects, no body
set +e
eval curl -sS -D "$tmp_headers" -o /dev/null -X "$method" "${headers[@]}" "${extras[@]}" "$url"
code=$?
set -e

# Grep possible headers (case-insensitive)
lc() { tr '[:upper:]' '[:lower:]'; }

limit="$(grep -i '^ratelimit-limit:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"
remaining="$(grep -i '^ratelimit-remaining:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"
reset="$(grep -i '^ratelimit-reset:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"
retry_after="$(grep -i '^retry-after:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"

# Fallback to X-RateLimit-* if standard missing
if [ -z "$limit" ]; then
  limit="$(grep -i '^x-ratelimit-limit:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"
fi
if [ -z "$remaining" ]; then
  remaining="$(grep -i '^x-ratelimit-remaining:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"
fi
if [ -z "$reset" ]; then
  reset="$(grep -i '^x-ratelimit-reset:' "$tmp_headers" | awk -F: '{ $1=""; sub(/^ /,""); print }' | tr -d '\r' | head -n1)"
fi

# Print discovered headers
if [ -n "$limit" ]; then echo "RateLimit-Limit: $limit"; fi
if [ -n "$remaining" ]; then echo "RateLimit-Remaining: $remaining"; fi
if [ -n "$reset" ]; then echo "RateLimit-Reset: $reset"; fi
if [ -n "$retry_after" ]; then echo "Retry-After: $retry_after"; fi

# Default conservative values
burst=60
window_secs=60

# Try to parse standard header syntax (either a plain integer or RFC draft format)
# Common forms:
#  - RateLimit-Limit: 10
#  - RateLimit-Limit: 10;w=1
#  - RateLimit-Reset: 1

if [[ "$limit" =~ ^[0-9]+$ ]]; then
  burst="$limit"
elif [[ "$limit" =~ ^([0-9]+)\;w=([0-9]+) ]]; then
  burst="${BASH_REMATCH[1]}"
  window_secs="${BASH_REMATCH[2]}"
fi

if [[ "$reset" =~ ^[0-9]+$ ]]; then
  window_secs="$reset"
fi

echo "DERIVED_BURST=$burst"
echo "DERIVED_WINDOW_SECS=$window_secs"

# Also provide GitHub Actions outputs if requested
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "burst=$burst"
    echo "window_secs=$window_secs"
  } >> "$GITHUB_OUTPUT"
fi

exit 0


