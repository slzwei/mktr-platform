### Summary
- scaffolded POST `/api/adtech/v1/beacons/heartbeat` and `/api/adtech/v1/beacons/impressions` behind `BEACONS_ENABLED`
- per-device RPS limiter via `BEACON_RPS_PER_DEVICE`, returns `429` with `Retry-After`
- idempotency via `Idempotency-Key` with replay window `BEACON_IDEMP_WINDOW_MIN`
- dedupe window for identical events; `deduped_total` returned for impressions

### Findings
- device auth uses `X-Device-Key` → `devices.secret_hash`
- tables: `devices`, `beacon_events`, `idempotency_keys` (indexes to be optimized)
- structured logs and metrics are planned; placeholders pending

### Next Steps
- add Joi/Ajv validation for heartbeat/impressions payloads
- record metrics: `beacon_heartbeat_count`, `beacon_impressions_count`, `*_latency_ms`, `*_deduped_total`
- add sampling knobs for logs

### File/Line refs
- `backend/src/routes/adtechBeacons.js`: handlers, idempotency, limiter
- `backend/src/models/{Device,BeaconEvent,IdempotencyKey}.js`: storage

### QUESTIONS
- expected heartbeat payload shape (battery, network, geo?)
- required fields for impressions (asset_id, campaign_id, ts?)


