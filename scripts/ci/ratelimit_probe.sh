#!/usr/bin/env bash
set -u

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
    continue
  fi
  # Treat as header only if it looks like "Name: value" (starts with an alpha/header token and a colon+space)
  if [[ "$arg" =~ ^[A-Za-z0-9-]+:\  ]]; then
    headers+=( -H "$arg" )
  else
    extras+=( "$arg" )
  fi
done

tmp_headers="$(mktemp)"
trap 'rm -f "$tmp_headers"' EXIT

# Perform request; do not follow redirects, no body
set +e
curl -sS -D "$tmp_headers" -o /dev/null -X "$method" "${headers[@]}" "${extras[@]}" "$url"
code=$?
set -e

# Extract possible headers (case-insensitive) without failing on no-match
set +o pipefail
limit="$(awk 'BEGIN{IGNORECASE=1} /^RateLimit-Limit:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"
remaining="$(awk 'BEGIN{IGNORECASE=1} /^RateLimit-Remaining:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"
reset="$(awk 'BEGIN{IGNORECASE=1} /^RateLimit-Reset:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"
retry_after="$(awk 'BEGIN{IGNORECASE=1} /^Retry-After:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"

# Fallback to X-RateLimit-* if standard missing
if [ -z "$limit" ]; then
  limit="$(awk 'BEGIN{IGNORECASE=1} /^X-RateLimit-Limit:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"
fi
if [ -z "$remaining" ]; then
  remaining="$(awk 'BEGIN{IGNORECASE=1} /^X-RateLimit-Remaining:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"
fi
if [ -z "$reset" ]; then
  reset="$(awk 'BEGIN{IGNORECASE=1} /^X-RateLimit-Reset:/ {sub(/^[^:]*:[ ]*/,""); gsub(/\r/,""); print; exit}' "$tmp_headers")"
fi
set -o pipefail

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


