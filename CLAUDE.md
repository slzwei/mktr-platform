# MKTR Platform — Lead Gen Pipeline

MKTR captures leads from multiple sources (QR codes, web forms, Retell AI voice
calls) and delivers them to insurance agents via the Lyfe mobile app:

1. **Retell AI** → voice call ends → webhook to MKTR backend
2. **MKTR Backend** → prospect creation → agent assignment → webhook dispatch
3. **Lyfe Edge Function** → lead upsert into Supabase → push notification to agent

## Where things live (read on demand — not loaded every session)

| Topic | Read this |
|---|---|
| Meta Ads topology, CAPI, down-funnel events, redeemed-audience sync, TikTok | `docs/reference/ads-and-tracking.md` |
| Two-brand routing-guard route lists, URL-helper contracts, prod env tables, DNS, Render IDs | `docs/reference/brand-and-hosting.md` |
| **Redeem Ops** (partner CRM, tasks, rewards, Discover, cadences) — `ops.redeem.sg` | `src/pages/redeemops/CLAUDE.md` + `docs/redeem-ops/` |
| Meta tracking / redeemed-audience deep design | `docs/plans/meta-tracking-implementation.md`, `docs/plans/meta-redeemed-audience-sync.md` |
| **Marketplace inheritance** (single door LIVE 2026-07-22 — redeem.sg listings + featured tiles derive from the campaign page; editors show read-only inherited previews; flags `MARKETPLACE_INHERIT_ENABLED` + `VITE_MARKETPLACE_INHERIT_ENABLED` flip together; Phase C clamp removal pending ≥1wk soak + sign-off) | `docs/plans/marketplace-inherits-campaign-page.md` (plan + review log + flip record) · twins `src/lib/listingDerivation.js` ↔ `backend/src/utils/listingDerivation.js` |
| **Campaign Studio** (the PERMANENT campaign design surface — design_config v2 twins, v2 renderer `src/components/campaignPage/` reusing the funnel, full-viewport editor + AI assist at `/admin/campaigns/:id/studio`; AI "Fill everything" covers ALL slots incl. Distribution picks, sign-up FIELD selection, T&C drafting (draw campaigns = deterministic drawTermsTemplate facts, never LLM legal text), draw-aware looks, + advisory publication recommendations (never auto-applied); create-flow auto-run via `/studio?ai=full`; classic DesignEditor survives ONLY for guided_review; backend `DESIGN_CONFIG_V2_WRITES_ENABLED` = emergency brake; per-campaign migration/rollback runbook) | `docs/reference/campaign-studio-rollout.md` (rollout/rollback) · `docs/plans/campaign-studio-implementation-prompt.md` (build history) · `docs/plans/studio-ai-full-coverage-plan.md` + `docs/plans/studio-ai-create-everything-plan.md` (AI coverage) · twins `src/lib/designConfigV2.js` ↔ `backend/src/utils/designConfigV2.js` (+ `designConfigV2Clamp.js`) |

Cross-system (Supabase schema, edge functions, roles) → parent `../CLAUDE.md`.

## Parallel Two-Brand Frontend (`mktr.sg` + `redeem.sg`) — cutover done 2026-05-26

The same React/Vite SPA in `src/` builds into multiple Render Static Sites from
the same git commit, branched by `VITE_BRAND` (and `VITE_SURFACE` for ops). This
is an **operator-vs-customer split**, not a wholesale rebrand.

| Service (Render) | Domain | Branch var | Purpose |
|---|---|---|---|
| `mktr-platform` | `mktr.sg` | `VITE_BRAND=mktr` (default) | **Operator brand.** Admin/agent/driver/fleet/PA UI, campaign designer, QR gen, marketing pages, staff login. |
| `redeem-frontend` | `redeem.sg` | `VITE_BRAND=redeem` | **Customer brand.** Lead-capture forms + marketplace. Apex `/` = marketplace v2 (since 2026-07-14). |
| `redeem-ops-frontend` | `ops.redeem.sg` | `VITE_SURFACE=ops` | **Redeem Ops.** Partner CRM / tasks / rewards / Discover. Also at `mktr.sg/redeem-ops`. |
| `mktr-backend-jo6r` | `api.mktr.sg` | (backend) | Single Express service. One source of truth for campaigns/agents/leads/round-robin regardless of brand. |

**Brand isolation:** `vite.config.js` aliases `@brand-config` to `src/lib/brandConfigs/{mktr,redeem}.js`; components import `brand` from `@/lib/brand`. The inactive brand's strings are not bundled. Full value list + acceptance test → `docs/reference/brand-and-hosting.md`.

**Per-campaign customer domain:** customer surfaces default to `redeem.sg`, but a campaign opts into `mktr.sg` via the **Customer domain** toggle (Content panel), stored as `design_config.customerHost ∈ {redeem, mktr}` (default `redeem`). Page chrome, regulatory copy, Pixel, and the confirmation email all follow the host. The mktr.sg→redeem.sg lead-capture 301s were removed 2026-06-17 — **the only rule left on `mktr-platform` is the SPA fallback `/* → /index.html`, which must stay last.** Customer-URL helpers (`resolveCustomerHost`, `customerLeadCaptureUrl`, …) and the three-layer routing guard (`internalRouteHostGuard` etc.) → `docs/reference/brand-and-hosting.md`. Security rule: **never pass a raw hostname from campaign JSON into a helper — clamp the enum choice first.**

## Deploying & verifying a frontend change (push ≠ live)

All services auto-deploy from `main` on commit (service IDs in `docs/reference/brand-and-hosting.md`). **Pushing to `main` is NOT proof it shipped** — two layers can hide a change, both bit us on 2026-06-26:

1. **Auto-deploy can silently drop a push.** The GitHub→Render webhook occasionally never fires. After pushing, **confirm a NEW deploy appeared** (Render MCP `list_deploys`, or the dashboard "Updated" column). If none within ~1–2 min, **re-trigger**: `git commit --allow-empty -m "re-trigger deploy" && git push` (the only *autonomous* re-trigger — no Render API key in env), or dashboard Manual Deploy.
2. **mktr.sg & redeem.sg are Cloudflare-fronted; `index.html` is edge-cached `s-maxage=300`.** After a green deploy the bare URL can serve the *old* `index.html` for ~5 min. Self-heals on TTL; a Cloudflare cache purge (user-side dashboard) makes it instant.

**Verify "live"** — Vite content-hashes chunks, so the `index-<hash>.js` ref flips iff code changed:
- **Origin** (bypasses domain cache): `curl -s https://mktr-platform.onrender.com/ | grep -o 'assets/index-[^."]*\.js'`.
- **Cache-bust** the real domain: `curl -s "https://mktr.sg/?cb=$(date +%s)" | grep -o 'assets/index-[^."]*\.js'`.
- **Definitive**: `curl` the live JS chunk and `grep` a string unique to your change (not one that existed in the old bundle).

## Ads & tracking (summary — full detail in `docs/reference/ads-and-tracking.md`)

- **Meta**: browser Pixel (`src/lib/metaPixel.js`) + fire-and-forget CAPI (`backend/src/services/metaCapiService.js`), gated by `shouldFireCapi` (skips Retell + Meta-Lead-Ads origins). Ad account `act_2170132703771607`, pixel `1402034528611431`.
- **TikTok**: mirror of Meta — Pixel (`src/lib/tiktokPixel.js`) + Events API (`backend/src/services/tiktokEventsService.js`). Pixel `D8GJ6T3C77UDLID6746G`. Live in prod.
- **Down-funnel**: agent-confirmed SC/PR fires `ConfirmedResident`/`ClosedWon` back from Lyfe → `POST /api/integrations/lyfe/lead-outcome`.
- **Lead quality**: per-campaign `design_config.sgPrOnly` gate (client-side, self-declared) + Meta customer-list exclusion sync (`redeemedAudienceService`).

## Architecture — Full Data Flow

```
┌──────────────┐    POST /api/retell/webhook     ┌───────────────────┐
│  Retell AI   │ ─────────────────────────────▶   │  MKTR Backend     │
│  Voice Bot   │  HMAC-SHA256 signed              │  (Express/Node)   │
└──────────────┘                                  │  retellService.js │
┌──────────────┐    POST /api/prospects           │  ┌─────────────┐  │
│  QR / Web     │ ────────────────────────────▶    │  │ Prospect DB │  │
│  Form         │  Lead capture form               │  │ (Sequelize) │  │
└──────────────┘                                  │  └──────┬──────┘  │
                                                  │   dispatchEvent   │
                                                  │   'lead.created'  │
                                                  └─────────┬─────────┘
                            HMAC-SHA256 signed POST         │
                            ▼─────────────────────────────── ┘
              ┌──────────────────────────────┐
              │  Supabase EF receive-mktr-lead│
              │  → leads / lead_activities    │
              │  → notifications ─────────────┼──▶ Push (Expo Push API)
              └──────────────────────────────┘
```

## Retell AI Integration

- **Route**: `POST /api/retell/webhook` (no auth middleware — signature only). Signature HMAC-SHA256, format `x-retell-signature: v=<ts>,d=<hex>`, secret `RETELL_WEBHOOK_SECRET`. Raw body captured only for `/api/retell/` paths (`server_internal.js:118-124`).
- **Processing** (`retellService.js`): skip if `call_status !== 'ended'` or `call_analysis.call_successful === false` → idempotency check (`IdempotencyKey`, scope `retell:call`, 24h TTL) → extract name → map sentiment (Positive→high, Neutral→medium, Negative→low) → resolve campaign → round-robin agent → create Prospect + ProspectActivity + IdempotencyKey (single txn) → fire `lead.created` webhook (post-commit) → email (fire-and-forget).
- **Campaign resolution (3-tier)**: `RETELL_CAMPAIGN_MAP` env → `Campaign.name = '[Retell] {agent_name}'` → any active campaign starting with `[Retell]`. Auto-created on bootstrap (`bootstrap.js:126-174`) from `RETELL_AGENTS` env.
- **Retell is the only extraction step** — no separate LLM. Fields (`name`, `user_sentiment`, `call_summary`, `call_successful`, `custom_analysis_data`, `transcript`, `recording_url`) map onto prospect fields / `sourceMetadata` / `notes`.
- **Recording**: `GET /api/retell/recording/:prospectId` (auth) — checks `sourceMetadata.recordingUrl`, else Retell API `GET /v2/get-call/{callId}`, caches result.

## Edge Functions (in `lyfe-app/supabase/functions/`)

- **receive-mktr-lead** — MKTR webhook (lead.created/assigned/unassigned). Auth HMAC-SHA256 + 5-min window. Agent match: `lead.created` by `routing.agentPhone` (strips `+`), `lead.assigned` by `routing.agentExternalId` (UUID), `lead.unassigned` by `data.previousAgentId`. `lead.unassigned` clears `assigned_to = null` + logs activity (lead preserved, B2 fixed 2026-03-23). Idempotency: `external_id + source_name='mktr'`. Returns 200 dup / 422 agent-not-found / 400 bad payload / 401 bad sig.
- **mktr-agents** — HTTP GET, auth `Authorization: Bearer {MKTR_API_KEY}` (timing-safe). Returns active agents/directors/managers from Lyfe `users`, phone/email masked. `?id={uuid}` for single lookup.

## MKTR DB tables (Sequelize on Render Postgres)

`prospects`, `prospect_activities`, `campaigns` (incl. `[Retell]` auto-created), `webhook_subscribers`, `webhook_deliveries`, `idempotency_keys`, `users` (agent mirror synced from Lyfe), `round_robin_cursors`, `lead_packages`/`lead_package_assignments` (agent credit system), `commissions`.

Writes into Lyfe Supabase (via EF): `leads` (`source_name='mktr'`, `external_id`), `lead_activities`, `notifications`. Reads: `users` (agent lookup).

## Agent assignment priority (`systemAgent.js`)

1. Self-assign if requester is an agent → 2. Admin-requested agent (if valid+active) → 3. QR tag owner (if active agent) → 4. Lead Package round-robin (agents with credits > 0 for campaign) → 5. **Fallback**: System Agent (`system@mktr.local`).

**Agent sync** (`agentSyncService.js`): pull from Lyfe Supabase REST (service_role), match lyfeId → phone → email, create/update/deactivate local Users, 5-min cache. `POST /api/lyfe/agents/sync` (admin, manual — no auto periodic sync).

**Lyfe webhook subscriber** (auto-registered on boot): "Lyfe App", events `lead.created/assigned/unassigned`, URL `LYFE_WEBHOOK_URL`, secret `LYFE_WEBHOOK_SECRET`.

## Error handling & retry

- **Webhook delivery**: HMAC-SHA256 body sig; headers `X-Webhook-{Event,Delivery-Id,Signature,Timestamp}`; 10s timeout; 3 retries exp backoff (1s/4s/16s); auto-disable subscriber after 50 consecutive failures; stale pending recovered on startup + every 60s; dead-letter queryable/retryable; `MAX_CONCURRENT_DELIVERIES = 3` (in-process queue).
- **Retell**: dup `call_id` handled by IdempotencyKey + unique constraint (treated as dup, not error); txn rollback on failure.
- **setTimeout retries are lost on restart** — the 60s recovery poll mitigates but doesn't eliminate.

## Required env vars

| Variable | Component | Purpose |
|---|---|---|
| `RETELL_WEBHOOK_SECRET` / `RETELL_API_KEY` / `RETELL_AGENTS` | Backend | Verify sig / fetch recordings / auto-campaign creation |
| `WEBHOOK_ENABLED` | Backend | **Must be `"true"`** or webhooks silently don't fire |
| `LYFE_WEBHOOK_URL` / `LYFE_WEBHOOK_SECRET` | Backend + EF | `receive-mktr-lead` URL + shared signing secret |
| `LYFE_SUPABASE_URL` / `LYFE_SUPABASE_SERVICE_ROLE_KEY` | Backend | Agent sync (bypasses RLS) |
| `MKTR_WEBHOOK_SECRET` / `MKTR_API_KEY` | Edge Fn | = `LYFE_WEBHOOK_SECRET` / `mktr-agents` API key |

Optional: `RETELL_CAMPAIGN_MAP`, `DEFAULT_AGENT_ID`, `SYSTEM_AGENT_EMAIL` (default `system@mktr.local`), `SENTRY_DSN`. Host/brand + ads env → the two reference docs.

## Known technical debt

1. **System Agent delivery gap**: leads assigned to System Agent can't reach Lyfe (`lead.created` needs agent phone). Needs a fallback path.
2. **Fake emails for Retell leads**: `retell-{call_id}@calls.mktr.sg` pollutes `prospects`. Consider nullable email / sentinel.
3. **setTimeout-based retries lost on restart** (see above) — consider a persistent job queue (pg-boss/bullmq).
4. **Hardcoded email redirect**: `mailer.js:105-108` redirects System Agent emails to `shawnleejob@gmail.com` — should be `SYSTEM_AGENT_REDIRECT_EMAIL`.
5. **Agent sync is pull-only + manual**; `MAX_CONCURRENT_DELIVERIES = 3` may throttle at high volume; `env.example` incomplete.

## Pipeline-relevant files

```
backend/src/
  services/  retellService · prospectService · prospectHelpers · webhookService ·
             webhookAdminService · systemAgent · agentSyncService · leadCredits · mailer
  controllers/ retellController · lyfeAgentController · prospectController
  routes/    retell · lyfeAgents · prospects · webhookAdmin
  models/    Prospect · WebhookSubscriber · WebhookDelivery · IdempotencyKey
  database/  bootstrap.js  ← system agent, Lyfe subscriber, Retell campaigns
lyfe-app/supabase/functions/  receive-mktr-lead/index.ts · mktr-agents/index.ts
```

> **Note:** fleet / devices / commissions / APK are being retired (2026-07-15) — don't build for them.
