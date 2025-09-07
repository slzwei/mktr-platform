### Summary
- scaffolded GET `/api/adtech/v1/manifest` behind `MANIFEST_ENABLED`
- computes ETag from JSON and respects `If-None-Match`
- includes placeholder asset URL signing util and unit test

### Findings
- centralized device auth via `X-Device-Key` checked against `devices.secret_hash`
- schema placed at `backend/src/schemas/manifest_v1.json` (draft-07)
- rate limiting controlled via `MANIFEST_RPS_PER_DEVICE` (planned hook)

### Next Steps
- validate manifest against schema and emit 400 envelope on validation errors
- wire asset signing into manifest assembly with TTL >= `MANIFEST_REFRESH_SECONDS`
- add metrics: `manifest_request_count`, `manifest_latency_ms`

### File/Line refs
- `backend/src/routes/adtechManifest.js`: GET handler and ETag
- `backend/src/utils/assetSigning.js`: signing placeholder
- `backend/src/schemas/manifest_v1.json`: schema

### QUESTIONS
- should asset URLs be signed per-device or per-tenant?
- confirm minimum refresh_seconds for production tablets


