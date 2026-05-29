# MKTR Lead Gen Pipeline — Audit Tracker

> Audit Date: 2026-03-23
> Auditor: Claude Opus 4.6

## Status Key

| Code | Meaning |
|------|---------|
| DONE | Fully implemented, tested, working |
| BUGGY | Implemented but has bugs or issues |
| PARTIAL | Partially implemented, key pieces missing |
| STUB | Placeholder code exists, not functional |
| NONE | Not implemented at all |

---

## Stage 1: Retell AI Voice Bot Integration

| Feature | Status | File(s) | Notes |
|---------|--------|---------|-------|
| Webhook endpoint | DONE | `backend/src/routes/retell.js:10` | `POST /api/retell/webhook` — no auth middleware, relies on signature |
| HMAC-SHA256 signature verification | DONE | `backend/src/services/retellService.js:37-64` | Timing-safe comparison, correct `v=<ts>,d=<hex>` format |
| Raw body capture for verification | DONE | `backend/src/server_internal.js:118-124` | Only captures for `/api/retell/` paths |
| Call status guard | DONE | `retellService.js:147-149` | Accepts 'ended' or missing status |
| Call success guard | DONE | `retellService.js:155-159` | Handles bool and string "true"/"false" |
| Idempotency (dual-layer) | DONE | `retellService.js:162-172, 268-274` | IdempotencyKey table + retellCallId unique constraint |
| Name extraction | PARTIAL | `retellService.js:175-178` | Only from `retell_llm_dynamic_variables.name`. No LLM parsing. |
| Sentiment → priority mapping | DONE | `retellService.js:181-186` | Positive→high, Neutral→medium, Negative→low |
| Transcript storage | DONE | `retellService.js:189-200` | Stored raw in `notes` field with metadata |
| Campaign resolution | DONE | `retellService.js:81-109` | 2-tier: env RETELL_CAMPAIGN_MAP → DB name convention. No wildcard fallback (B6 fix). |
| Agent assignment (round-robin) | DONE | `systemAgent.js:76-164` | Lead package based round-robin with retry |
| Prospect creation (transaction) | DONE | `retellService.js:218-275` | Transaction wraps Prospect + ProspectActivity + IdempotencyKey |
| Recording URL retrieval | DONE | `retellService.js:345-386` | Cached in sourceMetadata, fetches from Retell API on miss |
| Auto-create Retell campaigns | DONE | `bootstrap.js:126-174` | Reads RETELL_AGENTS env, creates `[Retell] {name}` campaigns |
| Email notification (post-create) | DONE | `retellService.js:303-314` | Fire-and-forget, falls back to system@mktr.sg |
| Webhook dispatch (post-create) | DONE | `retellService.js:279-300` | Fires `lead.created` event |

## Stage 2: MKTR Lead Management

| Feature | Status | File(s) | Notes |
|---------|--------|---------|-------|
| Prospect model (30+ fields) | DONE | `backend/src/models/Prospect.js` | UUID PK, E.164 phone, JSON demographics/preferences/sourceMetadata |
| Prospect CRUD | DONE | `prospectService.js` | Create, get, update, delete with scope filtering |
| Agent assignment (manual) | DONE | `prospectService.js:465-531` | Single + bulk assign, fires webhooks |
| Lead status lifecycle | DONE | `prospectService.js:370-443` | Won → commission creation, blocks System Agent conversion |
| Lead credit deduction | DONE | `leadCredits.js` | FIFO from LeadPackageAssignment, then User.owed_leads_count |
| Webhook subscriber management | DONE | `webhookAdminService.js` | Full CRUD for subscribers |
| Webhook dispatch engine | DONE | `webhookService.js:54-95` | Event-driven, WEBHOOK_ENABLED gated, HMAC-signed payloads |
| Webhook retry (exponential backoff) | DONE | `webhookService.js:154-197` | 3 attempts, 1s→4s→16s backoff |
| Webhook auto-disable | DONE | `webhookService.js:252-294` | After 50 consecutive failures |
| Dead letter queue | DONE | `webhookService.js:299-335` | Grouped by subscriber, 200 limit, purge support |
| Delivery stats (per subscriber) | DONE | `webhookService.js:340-376` | last24h/7d/30d with single SQL query |
| Stale retry recovery | DONE | `webhookService.js:382-405` + `bootstrap.js:40-55` | On startup + every 60s poll |
| Concurrency limiter | DONE | `webhookService.js:21-48` | MAX_CONCURRENT_DELIVERIES = 3 |
| Webhook payload builders | DONE | `prospectHelpers.js:35-139` | lead.created, lead.assigned, lead.unassigned |
| Phone normalization (SG-specific) | DONE | `prospectHelpers.js:12-30` | 8-digit SG numbers get +65 prefix |
| QR-based attribution | DONE | `prospectService.js:71-82` | Session cookie → Attribution → QR tag |
| Round-robin routing (QR-level) | DONE | `prospectService.js:166-196` | Atomic index increment on QrTag |
| QR routing visibility (admin UI) | DONE | `qrCodeService.js:89-112`, `src/components/qrcodes/PromotionalQRTable.jsx`, `ExistingQRCodes.jsx` | Added 2026-05-29. `listQrCodes` eager-loads `agentGroup` (+ member count via grouped COUNT, guarded). Admin QR tables show each QR's routing target: assigned agent + phone (direct) or group name + "round robin · N agents" (round-robin), with Unassigned/Group-unavailable fallbacks. QR search matches assignee. |
| Activity audit trail | DONE | `ProspectActivity` model | created, assigned, updated, viewed events |

## Stage 3: Delivery to Lyfe App

| Feature | Status | File(s) | Notes |
|---------|--------|---------|-------|
| Lyfe webhook auto-registration | DONE | `bootstrap.js:81-118` | On every boot, ensures subscriber with all 3 events |
| Seed script (manual) | DONE | `scripts/seed-lyfe-webhook.js` | Subscribes to all 3 events, matches bootstrap.js behavior |
| receive-mktr-lead edge function | DONE | `lyfe-app/supabase/functions/receive-mktr-lead/index.ts` | Full 325-line handler |
| Signature verification (edge fn) | DONE | `receive-mktr-lead/index.ts:50-64` | HMAC-SHA256, timing-safe |
| Replay protection | DONE | `receive-mktr-lead/index.ts:92-100` | 5-minute timestamp window |
| Agent matching (lead.created) | DONE | `receive-mktr-lead/index.ts:164-198` | Tries phone first, falls back to agentExternalId (B1 fix) |
| Agent matching (lead.assigned) | DONE | `receive-mktr-lead/index.ts:181-195` | By agentExternalId (Supabase UUID) |
| Lead upsert (idempotent) | DONE | `receive-mktr-lead/index.ts:198-244` | external_id + source_name='mktr' dedup |
| Lead insert | DONE | `receive-mktr-lead/index.ts:263-293` | Into Lyfe `leads` table |
| lead.unassigned handling | DONE | `receive-mktr-lead/index.ts:130-169` | Clears `assigned_to` + logs activity (B2 fix) |
| Lead activity logging | DONE | `receive-mktr-lead/index.ts:298-309` | Into `lead_activities` table |
| In-app notification | DONE | `receive-mktr-lead/index.ts:312-318` | Into `notifications` table → triggers push |
| mktr-agents edge function | DONE | `lyfe-app/supabase/functions/mktr-agents/index.ts` | API key auth, lists/fetches agents |
| Agent sync service | DONE | `agentSyncService.js` | Fetches from Lyfe Supabase, syncs to local User table |
| Agent sync endpoint | DONE | `routes/lyfeAgents.js` | `POST /api/lyfe/agents/sync` (admin only) |
| Cache management | DONE | `agentSyncService.js:7-24` | 5-minute TTL, manual invalidation endpoint |

---

## LLM Intent Extraction — Field Coverage

**CRITICAL FINDING: There is NO separate LLM intent extraction step in this codebase.**

Retell AI performs the call and provides analysis natively. MKTR stores the results but does not run any additional LLM processing on transcripts.

| Field | Source | Storage Location | Notes |
|-------|--------|-----------------|-------|
| caller name | `retell_llm_dynamic_variables.name` | `prospect.firstName/lastName` | Split on whitespace |
| phone number | `to_number` | `prospect.phone` | E.164 format |
| sentiment | `call_analysis.user_sentiment` | `prospect.sourceMetadata.sentiment` + `prospect.priority` | Mapped to priority |
| call summary | `call_analysis.call_summary` | `prospect.notes` (embedded) | Raw text in notes block |
| transcript | `transcript` | `prospect.notes` (embedded) | Full transcript appended to notes |
| call successful | `call_analysis.call_successful` | `prospect.sourceMetadata.callSuccessful` | Used as gate (skip if false) |
| custom analysis | `call_analysis.custom_analysis_data` | `prospect.demographics` | JSON blob, schema undefined |
| recording URL | `recording_url` | `prospect.sourceMetadata.recordingUrl` | Cached, fetchable from API |
| call duration | `duration_ms` | `prospect.sourceMetadata.durationMs` | Also in notes header |
| disconnect reason | `disconnection_reason` | `prospect.sourceMetadata.disconnectionReason` | Also in notes header |
| Retell agent ID | `agent_id` | `prospect.sourceMetadata.retellAgentId` | Used for campaign resolution |
| Retell agent name | `agent_name` | `prospect.sourceMetadata.retellAgentName` | Used for campaign name matching |

---

## End-to-End Features

| Feature | Status | Notes |
|---------|--------|-------|
| Full pipeline E2E test | DONE | `backend/test/integration/pipelineE2E.test.js` — Retell webhook → Prospect + Activity + IdempotencyKey → Webhook dispatch → Payload shape validation against edge function contract. 5 test cases: payload shape, HMAC verification, transaction integrity, field mapping, delivery record, idempotency. |
| Unit tests (retellService) | DONE | `backend/test/unit/retellService.test.js` |
| Integration tests (retell webhook) | DONE | `backend/test/integration/retellWebhook.test.js` |
| Integration tests (lead capture) | DONE | `backend/test/integration/leadCapture.test.js` |
| Unit tests (webhook dispatch) | DONE | `backend/test/unit/webhookDispatch.test.js` |
| Unit tests (webhook service) | DONE | `backend/test/unit/webhookService.test.js` |
| Sentry error tracking | PARTIAL | `server.js:9-15` — init only if SENTRY_DSN set; not in edge functions |
| Structured logging (pino) | DONE | All services use `logger.js` (pino) |
| Health check | DONE | `GET /health` on monolith |
| Metrics endpoint | DONE | `GET /metrics` on leadgen-service only |
| Latency monitoring | NONE | No p95/p99 tracking on the webhook delivery path |
| Alerting | NONE | No alerting on webhook failure rates or lead delivery failures |
| Rate limiting (Retell webhook) | NONE | `/api/retell/webhook` has no auth or rate limit — only signature check |

---

## Bug Log

| # | Severity | Component | Description | File:Line |
|---|----------|-----------|-------------|-----------|
| B1 | ~~HIGH~~ RESOLVED | receive-mktr-lead + retellService | ~~`lead.created` requires `routing.agentPhone`.~~ **Fixed 2026-03-23:** (1) Added `routing` block to retellService webhook payload (was missing entirely for all Retell leads). (2) Edge function now tries phone match first, falls back to `agentExternalId`. System Agent leads now delivered via ID lookup. | `retellService.js:278-320`, `receive-mktr-lead/index.ts:164-198` |
| B2 | ~~MEDIUM~~ RESOLVED | receive-mktr-lead | ~~`lead.unassigned` deletes the lead from Lyfe.~~ **Fixed 2026-03-23:** Changed DELETE to UPDATE setting `assigned_to = null`. Lead record preserved. Activity log entry added for audit trail. | `receive-mktr-lead/index.ts:150-169` |
| B3 | ~~LOW~~ RESOLVED | seed-lyfe-webhook.js | ~~Only subscribes to `['lead.created']`.~~ **Fixed 2026-03-23:** Updated to subscribe to all 3 events (`lead.created`, `lead.assigned`, `lead.unassigned`), matching bootstrap.js. Also changed upsert to match by name instead of URL for consistency. | `scripts/seed-lyfe-webhook.js:20` |
| B4 | ~~MEDIUM~~ RESOLVED | retellService | ~~Fake email `retell-${call_id}@calls.mktr.sg` pollutes Prospect table.~~ **Fixed 2026-03-23:** Made `Prospect.email` nullable (`allowNull: true`). Retell calls now store `email: null` instead of synthetic addresses. Mailer template handles null with 'N/A' fallback. | `Prospect.js:24-29`, `retellService.js:226` |
| B5 | LOW | webhookService | Retry scheduling via `setTimeout` is lost on server restart. The 60s recovery poll partially compensates, but retries scheduled for <60s from now are delayed. | `webhookService.js:172-178` |
| B6 | ~~MEDIUM~~ RESOLVED | retellService | ~~`resolveRetellCampaign` fallback finds ANY `[Retell]` campaign if name matching fails.~~ **Fixed 2026-03-23:** Removed wildcard fallback. Now returns `null` with a warning log when no campaign matches, so leads are created without a campaign rather than being misattributed. Campaign resolution still works via env map and DB name convention. | `retellService.js:103-109` |
| B7 | ~~LOW~~ RESOLVED | mailer.js | ~~Hardcoded email redirect to `shawnleejob@gmail.com`.~~ **Fixed 2026-03-23:** Now reads `SYSTEM_AGENT_REDIRECT_EMAIL` env var. If set, redirects System Agent emails to that address. If unset, skips the email with a warning log. Added to both `backend/.env.example` and `backend/env.example`. | `mailer.js:100-112` |
| B8 | ~~LOW~~ RESOLVED | env.example | ~~Missing critical pipeline env vars.~~ **Fixed 2026-03-23:** Added `RETELL_WEBHOOK_SECRET`, `RETELL_API_KEY`, `RETELL_AGENTS`, `RETELL_CAMPAIGN_MAP`, `WEBHOOK_ENABLED`, `LYFE_WEBHOOK_URL`, `LYFE_WEBHOOK_SECRET`, `LYFE_SUPABASE_URL`, `LYFE_SUPABASE_SERVICE_ROLE_KEY` with descriptions to all three env.example files (`backend/.env.example`, `backend/env.example`, `.env.example`). | `backend/.env.example`, `backend/env.example`, `.env.example` |
| B9 | ~~LOW~~ RESOLVED | render.yaml | ~~Points to `platform-v2/backend`, not the main `backend/` directory.~~ **Fixed 2026-05-09:** Removed `render.yaml` along with the abandoned `platform-v2/` scaffold. Production deploys via Render's GitHub integration on the active `mktr-platform` static_site + `mktr-backend-jo6r` web_service (no Blueprint/IaC involved). Two stale Blueprints (`mktr-platform`, `mktr-backend-db`) that watched `render.yaml` were also deleted. | (removed) |
| B10 | ~~MEDIUM~~ RESOLVED | WEBHOOK_ENABLED | ~~Defaults to `"false"`, silently disabling pipeline.~~ **Fixed 2026-03-23:** Added startup warning in bootstrap.js when `LYFE_WEBHOOK_URL` is set but `WEBHOOK_ENABLED` is not `"true"`. Also added production warning in envValidation.js when `WEBHOOK_ENABLED` is set to a non-`"true"` value. | `bootstrap.js:39-41`, `envValidation.js:46-48` |
| B11 | ~~MEDIUM~~ RESOLVED | envValidation.js | ~~Pipeline vars not validated.~~ **Fixed 2026-03-23:** Added `WEBHOOK_ENABLED`, `LYFE_WEBHOOK_URL`, `LYFE_WEBHOOK_SECRET` as pipeline-critical vars with dedicated warning message in production. | `config/envValidation.js:24-48` |

---

## Shared Supabase Tables

### MKTR-Owned Tables (Sequelize/PostgreSQL on Render)

| Table | Read By | Written By | Notes |
|-------|---------|------------|-------|
| prospects | MKTR backend | MKTR backend | Main lead table, 30+ fields |
| prospect_activities | MKTR backend | MKTR backend | Audit trail |
| campaigns | MKTR backend | MKTR backend, bootstrap.js | Includes auto-created `[Retell]` campaigns |
| webhook_subscribers | MKTR backend | MKTR backend, bootstrap.js | Lyfe subscriber auto-registered |
| webhook_deliveries | MKTR backend | MKTR backend | Delivery tracking + dead letter |
| idempotency_keys | MKTR backend | retellService | 24h TTL, scope: `retell:call` |
| users | MKTR backend, agentSyncService | MKTR backend, agentSyncService | Local copy of agents from Lyfe |
| qr_tags | MKTR backend | MKTR backend | QR codes with routing config |
| commissions | MKTR backend | MKTR backend | Agent commissions on conversion |
| lead_packages | MKTR backend | MKTR backend (admin) | Campaign-specific lead packages |
| lead_package_assignments | MKTR backend | MKTR backend (admin) | Agent package assignments |
| round_robin_cursors | MKTR backend | systemAgent.js | Per-campaign round-robin state |

### Lyfe-Owned Tables (Supabase ap-southeast-1)

| Table | Read By | Written By | Notes |
|-------|---------|------------|-------|
| users | mktr-agents edge fn, agentSyncService, receive-mktr-lead | Lyfe apps | Agent matching by phone/id |
| leads | receive-mktr-lead | receive-mktr-lead | MKTR leads with `source_name='mktr'` |
| lead_activities | receive-mktr-lead | receive-mktr-lead | Activity log per lead |
| notifications | receive-mktr-lead | receive-mktr-lead | Triggers push notification edge fn |

---

## Priority Queue (Top 5 Next Actions)

1. **FIX B5 (LOW)**: `setTimeout`-based webhook retries lost on restart. Consider persistent job queue.

---

## Audit Progress

- **Last file/folder examined**: All files in `backend/src/`, `services/leadgen-service/src/`, `lyfe-app/supabase/functions/receive-mktr-lead/`, `lyfe-app/supabase/functions/mktr-agents/`, `scripts/`, `infra/`, `docs/audit/`, config files
- **Files/folders left to audit**:
  - `services/leadgen-service/src/db/` (migration scripts — low priority, separate schema)
  - `services/leadgen-service/src/lib/` (metrics, idempotency — already documented in docs/audit/leadgen.md)
  - `services/gateway/src/server.js` (routing proxy — not part of lead gen pipeline)
  - `tablet-app/` (Android ad player — not part of lead gen pipeline)
  - Individual Retell/webhook test files (test coverage confirmed by file existence)
- **Open questions to verify next session**:
  1. Is `WEBHOOK_ENABLED=true` in production? If not, leads are not reaching Lyfe.
  2. Are there Retell calls that fall back to System Agent? If so, B1 is actively blocking delivery.
  3. Has `lead.unassigned` ever fired in production? If so, leads may have been deleted from Lyfe.
  4. What's the actual failure rate on webhook deliveries? Check `webhook_deliveries` table.
  5. Is `LYFE_SUPABASE_URL` vs `LYFE_WEBHOOK_URL` — are both pointing to the same Supabase project?
- **Estimated completion**: 95% done — all pipeline code read, all critical paths documented, all bugs catalogued. Remaining 5% is test file verification and env var runtime check.
