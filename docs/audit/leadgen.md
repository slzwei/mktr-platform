## LeadGen Phase B – Hardening + Contract

### Idempotency (POST /v1/qrcodes)

- Accepts header `Idempotency-Key` (UUID recommended).
- Window: `LEADGEN_IDEMP_WINDOW_HOURS` (default 24).
- Behavior:
  - Same key + identical payload within window: 200 and replays original body; no new row.
  - Same key + different payload: 409 with `{ code:409, status:"error", error:"idempotency_conflict" }`.
- Persistence: `leadgen.idempotency_keys(tenant_id, idempotency_key, request_hash, response_json, created_at)`.

### Validation & Errors

- Centralized validation for create/list.
- `400` invalid input; `401/403` for auth/tenant; `429` for rate limits.
- Envelope: `{ code, status, success, data? , error? }`.

### Pagination & Sorting (GET /v1/qrcodes)

- Params: `limit` (1..200), `cursor`, `sort` (`created_at:desc` default; supports `created_at|updated_at|code|status:asc|desc`).
- Deterministic ordering; returns `next_cursor` when more results exist.
- Omitted params preserve existing behavior.

### Attribution (POST /v1/scans)

- Resolve `car_id` from `leadgen.qr_tags.id`.
- Resolve `driver_id` best-effort from `public.cars (current_driver_id, assignment_start, assignment_end)` at scan timestamp.
- Both ids logged in structured logs when available.

### Rate Limits (per-tenant)

- Create: `LEADGEN_RPS_CREATE` (default 5).
- List: `LEADGEN_RPS_LIST` (default 10).
- On exceed: `429` with `Retry-After` header.

### Observability

- JSON logs per request: `tenant_id, request_id, car_id, driver_id, latency_ms, outcome`.
- Lightweight metrics: counters + p95 via `GET /metrics`.

### Examples

```bash
# idempotent create
KEY=$(uuidgen)
curl -s -X POST http://localhost:4002/v1/qrcodes \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
  -d '{"code":"DEMO","status":"active"}' | jq .
curl -s -X POST http://localhost:4002/v1/qrcodes \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
  -d '{"code":"DEMO","status":"active"}' | jq .   # 200 replay

# pagination
curl -s -H "Authorization: Bearer $TOK" 'http://localhost:4002/v1/qrcodes?limit=1' | jq .
```

### QUESTION

- None at this time. If ambiguity arises, cite file/lines in follow-up.
