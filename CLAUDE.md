# MKTR Platform — Lead Gen Pipeline

## Overview

MKTR is a marketing lead generation platform that captures leads from multiple sources (QR codes, web forms, Retell AI voice calls) and delivers them to insurance agents via the Lyfe mobile app. The pipeline has three stages:

1. **Retell AI** → voice call ends → webhook to MKTR backend
2. **MKTR Backend** → prospect creation → agent assignment → webhook dispatch
3. **Lyfe Edge Function** → lead upsert into Supabase → push notification to agent

## Architecture — Full Data Flow

```
┌──────────────┐    POST /api/retell/webhook     ┌───────────────────┐
│  Retell AI   │ ─────────────────────────────▶   │  MKTR Backend     │
│  Voice Bot   │  HMAC-SHA256 signed              │  (Express/Node)   │
└──────────────┘                                  │                   │
                                                  │  retellService.js │
                                                  │  ┌─────────────┐  │
┌──────────────┐    POST /api/prospects           │  │ Prospect DB │  │
│  QR Code     │ ─────────────────────────────▶   │  │ (Sequelize) │  │
│  Web Form    │  Lead capture form               │  └──────┬──────┘  │
└──────────────┘                                  │         │         │
                                                  │    dispatchEvent  │
                                                  │   'lead.created'  │
                                                  └─────────┬─────────┘
                                                            │
                            HMAC-SHA256 signed POST         │
                            ┌───────────────────────────────┘
                            ▼
              ┌──────────────────────────────┐
              │  Supabase Edge Function      │
              │  receive-mktr-lead           │
              │                              │
              │  ┌────────────────────────┐  │
              │  │  Lyfe Supabase DB      │  │
              │  │  ┌──────────────────┐  │  │
              │  │  │ leads            │  │  │
              │  │  │ lead_activities  │  │  │
              │  │  │ notifications    │──┼──┼──▶ Push Notification
              │  │  └──────────────────┘  │  │    (Expo Push API)
              │  └────────────────────────┘  │
              └──────────────────────────────┘
```

## Retell AI Integration

### Webhook Endpoint
- **Route**: `POST /api/retell/webhook` (no auth middleware — signature only)
- **Signature**: HMAC-SHA256, format `x-retell-signature: v=<timestamp>,d=<hex>`
- **Secret**: `RETELL_WEBHOOK_SECRET` env var
- **Raw body capture**: Only for `/api/retell/` paths (see `server_internal.js:118-124`)

### Call Processing Logic (`retellService.js`)
1. Guard: skip if `call_status !== 'ended'` (or missing)
2. Guard: skip if `call_analysis.call_successful === false`
3. Idempotency: check `IdempotencyKey` table (scope: `retell:call`, 24h TTL)
4. Extract name from `retell_llm_dynamic_variables.name`
5. Map sentiment: Positive→high, Neutral→medium, Negative→low
6. Resolve campaign by `[Retell] {agent_name}` naming convention
7. Resolve agent via round-robin from lead package assignments
8. Create Prospect + ProspectActivity + IdempotencyKey in single transaction
9. Fire `lead.created` webhook (post-commit, fire-and-forget)
10. Send email notification (fire-and-forget)

### Campaign Resolution (3-tier)
1. `RETELL_CAMPAIGN_MAP` env var (format: `retellAgentId:campaignId,...`)
2. DB lookup: `Campaign.name = '[Retell] {agent_name}'`
3. Fallback: any active campaign starting with `[Retell]`

### Auto-Created Campaigns
On bootstrap (`bootstrap.js:126-174`), reads `RETELL_AGENTS` env var:
```json
[{"agentId":"agent_xxx","name":"Luggage - CPF CareShield Life"}]
```
Creates `[Retell] Luggage - CPF CareShield Life` campaign if missing.
Default if env not set: `agent_58b8bbdfb8920ce49bb2750b86` / "Luggage - CPF CareShield Life".

### Recording URL Retrieval
- `GET /api/retell/recording/:prospectId` (auth required)
- First checks `prospect.sourceMetadata.recordingUrl`
- Falls back to Retell API: `GET https://api.retellai.com/v2/get-call/{callId}`
- Caches result in sourceMetadata for subsequent requests

## LLM Extraction Approach

**There is no separate LLM extraction step.** Retell AI performs all call analysis natively. MKTR stores the results:

| Retell Field | Storage | Used For |
|-------------|---------|----------|
| `retell_llm_dynamic_variables.name` | `prospect.firstName/lastName` | Lead identity |
| `call_analysis.user_sentiment` | `prospect.priority` + `sourceMetadata.sentiment` | Lead scoring |
| `call_analysis.call_summary` | `prospect.notes` (embedded) | Agent context |
| `call_analysis.call_successful` | Gate: skip if false | Quality filter |
| `call_analysis.custom_analysis_data` | `prospect.demographics` | Structured data (schema varies) |
| `transcript` | `prospect.notes` (appended) | Full conversation record |
| `recording_url` | `sourceMetadata.recordingUrl` | Audio playback |

## Edge Function Inventory

### receive-mktr-lead (`lyfe-app/supabase/functions/receive-mktr-lead/`)
- **Trigger**: MKTR webhook (lead.created, lead.assigned, lead.unassigned)
- **Auth**: HMAC-SHA256 signature + 5-minute timestamp window
- **Agent matching**:
  - `lead.created`: by `routing.agentPhone` (strips + prefix for Lyfe DB)
  - `lead.assigned`: by `routing.agentExternalId` (Supabase UUID)
  - `lead.unassigned`: by `data.previousAgentId`
- **Behavior**:
  - `lead.created`: insert into `leads`, create activity, send notification
  - `lead.assigned`: reassign existing lead, create activity, send notification
  - `lead.unassigned`: **delete** lead from Lyfe (destructive — see B2 in TRACKER.md)
- **Idempotency**: dedup by `external_id + source_name='mktr'`

### mktr-agents (`lyfe-app/supabase/functions/mktr-agents/`)
- **Trigger**: HTTP GET with API key
- **Auth**: `Authorization: Bearer {MKTR_API_KEY}` (timing-safe comparison)
- **Returns**: Active agents/directors/managers from Lyfe `users` table
- **Privacy**: Phone and email are masked in responses
- **Query**: `?id={uuid}` for single agent lookup

## Supabase Tables — Ownership Map

### MKTR Database (Sequelize on PostgreSQL via Render)
Core pipeline tables:
- `prospects` — leads from all sources (QR, web, Retell)
- `prospect_activities` — full audit trail
- `campaigns` — includes auto-created `[Retell]` campaigns
- `webhook_subscribers` — outbound webhook targets
- `webhook_deliveries` — delivery log with retry state
- `idempotency_keys` — dedup for Retell calls
- `users` — local agent mirror (synced from Lyfe)
- `round_robin_cursors` — per-campaign assignment state
- `lead_packages` / `lead_package_assignments` — agent credit system
- `commissions` — agent earnings on lead conversion

### Lyfe Database (Supabase ap-southeast-1)
Tables written by MKTR pipeline:
- `leads` — MKTR leads arrive with `source_name='mktr'`, `external_id` from MKTR
- `lead_activities` — activity log for each lead
- `notifications` — triggers push notification edge function

Tables read by MKTR pipeline:
- `users` — agent lookup by phone/id/role

## Agent Matching & Subscription Logic

### Agent Assignment Priority (systemAgent.js)
1. Self-assign if requester is an agent
2. Admin-requested agent (if valid + active)
3. QR tag owner (if active agent)
4. Lead Package round-robin (agents with credits > 0 for campaign)
5. **Fallback**: System Agent (`system@mktr.local`)

### Agent Sync (agentSyncService.js)
- Fetches agents from Lyfe Supabase via REST API (service_role key)
- Matches by: lyfeId → phone → email
- Creates local User records for new agents
- Updates stale records (links lyfeId, fills email/phone)
- Deactivates agents no longer in Lyfe
- 5-minute cache TTL
- Endpoint: `POST /api/lyfe/agents/sync` (admin only)

### Lyfe Webhook Subscriber (auto-registered on boot)
- Name: "Lyfe App"
- Events: `['lead.created', 'lead.assigned', 'lead.unassigned']`
- URL: `LYFE_WEBHOOK_URL` → `receive-mktr-lead` edge function
- Secret: `LYFE_WEBHOOK_SECRET`

## Error Handling & Retry

### Webhook Delivery
- **Signature**: HMAC-SHA256 of JSON body using subscriber secret
- **Headers**: `X-Webhook-Event`, `X-Webhook-Delivery-Id`, `X-Webhook-Signature`, `X-Webhook-Timestamp`
- **Timeout**: 10 seconds per attempt
- **Retries**: 3 attempts with exponential backoff (1s, 4s, 16s)
- **Auto-disable**: Subscriber disabled after 50 consecutive failures
- **Recovery**: Stale pending deliveries recovered on startup + every 60s
- **Dead letter**: Failed deliveries queryable, manually retryable, purgeable (30-day default)
- **Concurrency**: MAX_CONCURRENT_DELIVERIES = 3 (in-process queue)

### Retell Webhook
- Duplicate call_id: handled by IdempotencyKey + DB unique constraint
- Transaction rollback on failure
- Unique constraint violation treated as duplicate (not error)

### Edge Function (receive-mktr-lead)
- Returns 200 for duplicates (idempotent)
- Returns 422 for agent-not-found (MKTR should handle retry)
- Returns 400 for bad payload
- Returns 401 for bad signature/timestamp
- Unique constraint (23505) treated as duplicate

## Monitoring & Logging

### Current State
- **Structured logging**: Pino (all backend services)
- **Error tracking**: Sentry (backend only, if SENTRY_DSN set)
- **Health check**: `GET /health` on monolith
- **Metrics**: `GET /metrics` on leadgen-service (counters + p95)
- **Webhook stats**: `GET /api/webhooks/stats` (admin, per-subscriber)

### Not Implemented
- No alerting on webhook failure spikes
- No latency tracking on the full pipeline path
- No Sentry in edge functions
- No dashboard for pipeline health
- No dead letter queue alerting

## Environment Variables & Config

### Required for Pipeline Operation

| Variable | Component | Purpose |
|----------|-----------|---------|
| `RETELL_WEBHOOK_SECRET` | Backend | Verify Retell webhook signatures |
| `RETELL_API_KEY` | Backend | Fetch recording URLs from Retell API |
| `RETELL_AGENTS` | Backend | JSON array of Retell agents for auto-campaign creation |
| `WEBHOOK_ENABLED` | Backend | **Must be `"true"`** for webhooks to fire |
| `LYFE_WEBHOOK_URL` | Backend | Edge function URL for `receive-mktr-lead` |
| `LYFE_WEBHOOK_SECRET` | Backend + Edge Fn | Shared secret for webhook signing/verification |
| `LYFE_SUPABASE_URL` | Backend | Supabase project URL for agent sync |
| `LYFE_SUPABASE_SERVICE_ROLE_KEY` | Backend | Service-role key for agent sync (bypasses RLS) |
| `MKTR_WEBHOOK_SECRET` | Edge Fn | Same value as `LYFE_WEBHOOK_SECRET` (edge fn side) |
| `MKTR_API_KEY` | Edge Fn | API key for `mktr-agents` endpoint |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `RETELL_CAMPAIGN_MAP` | (none) | Override: `retellAgentId:campaignId,...` |
| `DEFAULT_AGENT_ID` | (none) | Pin a specific agent instead of system agent |
| `SYSTEM_AGENT_EMAIL` | `system@mktr.local` | Email for auto-created system agent |
| `SENTRY_DSN` | (none) | Sentry error tracking |

## Known Technical Debt

1. **No LLM extraction**: Transcript analysis is entirely Retell-native. If richer extraction is needed (e.g., specific insurance product interest, budget, timeline), a separate LLM step needs to be built.

2. **Fake emails for Retell leads**: `retell-{call_id}@calls.mktr.sg` pollutes the prospect table. Consider making `email` nullable or using a dedicated "no email" sentinel.

3. **System Agent delivery gap**: Leads assigned to System Agent cannot be delivered to Lyfe because the edge function requires agent phone for `lead.created`. Needs a fallback path.

4. **setTimeout-based retries**: Webhook retries are lost on restart. The 60s recovery poll mitigates but doesn't eliminate the gap. Consider a persistent job queue (pg-boss, bullmq).

5. **lead.unassigned deletes leads**: The edge function deletes the Lyfe lead record on unassignment rather than updating status. This destroys history.

6. **Hardcoded email redirect**: `mailer.js:105-108` redirects System Agent emails to `shawnleejob@gmail.com`. Should be `SYSTEM_AGENT_REDIRECT_EMAIL` env var.

7. **render.yaml stale**: Points to `platform-v2/backend`, not the current backend directory.

8. **env.example incomplete**: Critical pipeline variables not documented in either `env.example` or `.env.example`.

9. **Concurrency bottleneck**: `MAX_CONCURRENT_DELIVERIES = 3` could throttle webhook delivery under high lead volume.

10. **Agent sync is pull-only**: Agents must be synced manually (`POST /api/lyfe/agents/sync`) or on demand. No automatic periodic sync.

## Project Structure (Pipeline-Relevant Files)

```
backend/
  src/
    services/
      retellService.js        ← Stage 1: Retell webhook processing
      prospectService.js       ← Stage 2: Prospect CRUD + assignment
      prospectHelpers.js       ← Webhook payload builders, phone normalization
      webhookService.js        ← Webhook dispatch engine (retry, DLQ, stats)
      webhookAdminService.js   ← Subscriber CRUD
      systemAgent.js           ← Agent assignment + round-robin
      agentSyncService.js      ← Lyfe agent sync (Supabase REST)
      leadCredits.js           ← Lead credit deduction
      mailer.js                ← Email notifications
    controllers/
      retellController.js      ← Retell webhook handler
      lyfeAgentController.js   ← Lyfe agent sync endpoints
      prospectController.js    ← Prospect API handlers
    routes/
      retell.js                ← /api/retell/*
      lyfeAgents.js            ← /api/lyfe/*
      prospects.js             ← /api/prospects/*
      webhookAdmin.js          ← /api/webhooks/*
    models/
      Prospect.js              ← Lead model (30+ fields)
      WebhookSubscriber.js     ← Outbound webhook targets
      WebhookDelivery.js       ← Delivery log
      IdempotencyKey.js        ← Dedup for Retell calls
    database/
      bootstrap.js             ← Startup: system agent, Lyfe subscriber, Retell campaigns
  scripts/
    seed-lyfe-webhook.js       ← Manual subscriber seeder (outdated)

lyfe-app/supabase/functions/
  receive-mktr-lead/index.ts   ← Stage 3: Lead delivery to Lyfe
  mktr-agents/index.ts         ← Agent lookup API for MKTR
```
