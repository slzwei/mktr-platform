# MKTR Platform — Lead Gen Pipeline

## Overview

MKTR is a marketing lead generation platform that captures leads from multiple sources (QR codes, web forms, Retell AI voice calls) and delivers them to insurance agents via the Lyfe mobile app. The pipeline has three stages:

1. **Retell AI** → voice call ends → webhook to MKTR backend
2. **MKTR Backend** → prospect creation → agent assignment → webhook dispatch
3. **Lyfe Edge Function** → lead upsert into Supabase → push notification to agent

## Parallel Two-Brand Frontend (`mktr.sg` + `redeem.sg`) — cutover completed 2026-05-26

The same React/Vite SPA in `src/` builds into TWO Render Static Sites from the same git commit, branched by the `VITE_BRAND` env var. This is an **operator-vs-customer split**, not a wholesale rebrand — MKTR remains the operator/admin brand, Redeem is the customer-facing brand on lead-capture surfaces only.

| Service (Render) | Domain | `VITE_BRAND` | Audience & purpose |
|---|---|---|---|
| `mktr-platform` | `mktr.sg`, `www.mktr.sg` | `mktr` (default) | **Operator brand.** Admin/agent/driver/fleet/PA UI, campaign designer, QR generation, agent groups, marketing pages (`/Homepage`, `/Contact`, `/features`, `/pricing`, `/about`), PDPA page, staff login. |
| `redeem-frontend` | `redeem.sg`, `www.redeem.sg` | `redeem` | **Customer brand** (a service of MKTR PTE. LTD., UEN 202507548M). What a prospect sees after scanning a QR or clicking a campaign link. Lead-capture forms only. Apex `/` shows minimal `RedeemPlaceholder`. |
| `mktr-backend-jo6r` | `api.mktr.sg` | (backend) | Single Express service serves both static sites' `/api/*` and `/uploads/*` via Render proxy rewrites. Single source of truth for campaigns/agents/leads/round-robin regardless of which brand sent traffic. |

### Cutover redirect rules on `mktr-platform` (5 lead-capture paths only)

Old mktr.sg lead-capture URLs 301-redirect to redeem.sg as a safety net (existing QRs printed with mktr.sg, hardcoded integrations). Everything else stays on MKTR:

| Source | Destination |
|---|---|
| `/LeadCapture` | `https://redeem.sg/LeadCapture` |
| `/LeadCapture/*` | `https://redeem.sg/LeadCapture/*` |
| `/p/*` | `https://redeem.sg/p/*` (campaign preview) |
| `/t/*` | `https://redeem.sg/t/*` (QR tracker) |
| `/share/*` | `https://redeem.sg/share/*` (shortlinks) |
| `/*` | `/index.html` (SPA fallback, LAST) |

The 7 marketing/apex redirects originally added (`/Homepage`, `/Contact`, `/features`, `/pricing`, `/about`, `/personal-data-policy`, `/`) were removed during cutover. Per product direction, `mktr.sg` keeps its existing marketing pages and admin surfaces unchanged — only lead-capture flows redirect.

### Brand isolation in the bundle

`vite.config.js` reads `VITE_BRAND` at config time and aliases `@brand-config` to either `src/lib/brandConfigs/mktr.js` or `src/lib/brandConfigs/redeem.js`. Components import `brand` from `@/lib/brand`, which re-exports the active brand's config. Result: the inactive brand's strings (wordmark, regulatory copy, consumer line, etc.) are not bundled into dist. Acceptance test: `grep MKTR dist/` on the redeem build returns only intentional D3 legal-entity references (`MKTR PTE. LTD.`, the legal data controller).

Brand-aware values include: `name`, `wordmark`, `legalName`, `uen`, `consumerLine`, `logoSrc`/`logoDarkSrc`/`logoIconSrc`/`faviconSrc`, `pageTitle`, `pdpaUrl`, `publicHost`, `defaultRegulatory`, `defaultPoweredBy`, `partnersTerm`, `pdpaAbsoluteUrl`, `consentEntityClause`, plus the `show*` route gates (`showHomepage`, `showAbout`, `showFeatures`, `showPricing`).

### Customer-facing URL helpers (always point to redeem.sg)

`src/lib/brand.js` defines `CUSTOMER_HOST = 'redeem.sg'` as a module-level constant. Helpers that produce customer-facing URLs **always** use this host regardless of which brand build is rendering them. This ensures admin-side surfaces (Copy Link buttons, QR display, preview links) generate clean `redeem.sg` URLs with no `mktr.sg → redeem.sg` redirect hop:

| Helper | Returns |
|---|---|
| `customerPublicUrl(path)` | `https://redeem.sg{path}` |
| `customerLeadCaptureUrl(campaignId, extraParams)` | `https://redeem.sg/LeadCapture?campaign_id={id}&...` |
| `customerPreviewUrl(slug)` | `https://redeem.sg/p/{slug}` |
| `publicTrackingUrl(slug)` | `https://redeem.sg/t/{slug}` (via `customerPublicUrl`) |
| `publicShareUrl(slug)` | `https://redeem.sg/share/{slug}` |
| `publicUrl(path)` | `https://{brand.publicHost}{path}` — brand-self-referential; for canonical, SEO, robots/sitemap only |

Callers: `AdminCampaigns.handleCopyLink`, `AdminCampaignDesigner.handlePreview`, all QR admin tables (`CarQRTable`, `ExistingQRCodes`, `PromotionalQRTable`). Customer-side surfaces (`LeadCapture.longShareUrl`, `ShareCampaignDialog`) work via `window.location.origin` and are already correct since they execute on `redeem.sg`.

### Routing guards (D13 — internal routes are mktr.sg-only, three layers)

1. **Render edge redirect rules on `redeem-frontend`** (16 rules) — catch admin paths before SPA loads. Routes: `/auth/*`, `/Admin*`, `/admin/*`, `/Agent*`, `/Driver*`, `/FleetOwner*`, `/preview*`, `/provision/*`, `/CustomerLogin`, `/ForgotPassword`, `/Onboarding`, `/PendingApproval`, `/MyProspects`, `/prospect/*`, `/profile`, `/settings` — all 301 to `mktr.sg{path}`.
2. **SPA-level `MktrOnlyRedirect`** — `src/pages/index.jsx` wraps internal route elements with `IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <Real>`. `src/components/auth/ProtectedRoute.jsx` is replaced wholesale with `MktrOnlyRedirect` on the redeem build, so admin/agent/driver routes redirect before any auth state is consulted.
3. **Backend `internalRouteHostGuard`** — `backend/src/middleware/internalRouteHostGuard.js` returns 403 for `/api/auth/*`, `/api/admin/*`, `/api/agents/*`, `/api/fleet/*`, `/api/devices/*`, `/api/users/*`, `/api/lyfe/*`, `/api/webhooks/*`, `/api/integrations/*` when the validated public host is `redeem.sg`. Server-to-server traffic (no host header) passes through unchanged.

### Backend host-aware behavior

The single backend serves both origins. To respond correctly per origin:

- **`backend/src/utils/publicHost.js`** — `publicHostFromRequest(req)` derives the *validated* public host from `Origin` / `X-Forwarded-Host` / `Host`, checked against an allowlist of `{mktr.sg, www.mktr.sg, redeem.sg, www.redeem.sg}`. Returns `undefined` for unknown hosts (never trusts raw headers). `cookieDomainForPublicHost(host)` maps to `.mktr.sg` or `.redeem.sg`.
- **`backend/src/utils/frontendBase.js`** — `frontendBaseForHost(host)` returns `MKTR_FRONTEND_URL` or `REDEEM_FRONTEND_URL` for per-request redirect destinations.
- **`trackerController.js` + `leadCaptureBind.js`** — cookies set via `cookieDomainForPublicHost(publicHostFromRequest(req))`. Redirects use `frontendBaseForHost(...)` to land on the same public host the user came from. The lead-capture binder route redirects to `/LeadCapture` (camelCase, matches SPA route) instead of `/lead-capture` (which doesn't exist on the SPA).
- **`prospectController.js`** — derives a CAPI `event_source_url` fallback from `publicHostFromRequest(req)` when the SPA omits it; `metaCapiService.js` is unchanged (still has no req access).
- **`mailer.js`** — `resolveEmailFrom(context)` and `sendEmail({..., context, from})` allow per-flow sender selection. `EMAIL_FROM_MKTR` / `EMAIL_FROM_REDEEM` env vars override the default `EMAIL_FROM`. `sendLeadConfirmationEmail` is wired to `context: 'redeem'` and fires fire-and-forget on every lead-capture submit (`prospectController.js`; synthetic `@calls.mktr.sg` Retell emails are skipped). Its copy/header/footer are **hardcoded Redeem branding with no per-campaign brand branching** — an MKTR-hosted campaign would still email Redeem branding to the customer (tracked in `docs/plans/per-campaign-customer-domain.md`).

### Backend env vars set in production

| Env var | Value | Purpose |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://redeem.sg` | Host encoded in newly generated QR code images. New QRs encode `redeem.sg/t/{slug}` directly. Also used by APK download URL display (admin-side cosmetic). |
| `MKTR_FRONTEND_URL` | `https://mktr.sg` | Per-host redirect destination for mktr.sg traffic. Falls back to `FRONTEND_BASE_URL`. |
| `REDEEM_FRONTEND_URL` | `https://redeem.sg` | Per-host redirect destination for redeem.sg traffic. |
| `CORS_ORIGIN` | `…mktr-platform.onrender.com,…redeem-frontend.onrender.com` | Adds preview hostnames for staging. Code defaults already include the four apex+www hosts. |
| `EMAIL_FROM_MKTR` | (unset; defaults to `EMAIL_FROM`) | Admin/agent emails (lead assignments, package assignments) — stays MKTR. |
| `EMAIL_FROM_REDEEM` | (falls back to `EMAIL_FROM` if unset) | Customer-facing lead-capture confirmation email (`sendLeadConfirmationEmail`, `context:'redeem'`), sender `noreply@redeem.sg`. SES domain verified + DKIM/SPF/DMARC pass. |

### DNS for `redeem.sg`

Nameservers at Cloudflare (`chance.ns.cloudflare.com`, `liv.ns.cloudflare.com`) after Vodien failed to push delegation during initial setup. Records (managed via Cloudflare):

- A `@` → `216.24.57.1` (Render edge)
- CNAME `www` → `redeem-frontend.onrender.com`
- TXT `@` → `facebook-domain-verification=…` (Meta domain verification)
- TXT `@` → `v=spf1 include:amazonses.com -all` (SPF for AWS SES)
- TXT `_dmarc` → `v=DMARC1; p=none; rua=mailto:admin@mktr.sg; pct=100` (monitoring mode)
- TXT `@` → `google-site-verification=…` (Google Search Console)
- 3× CNAME `<token>._domainkey` → `<token>.dkim.amazonses.com` (AWS SES DKIM)

### Diagnostic endpoint

`GET https://api.mktr.sg/health/public-host` returns the raw `Origin` / `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` / `req.hostname` plus the *derived* `detectedPublicHost` and `cookieDomain`. Useful for verifying the Render proxy preserves original host headers.

### Operational env on the static sites

- mktr-platform Static Site (Render): `VITE_BRAND=mktr` (or unset — defaults to mktr), `VITE_API_URL=https://api.mktr.sg/api` (absolute — pre-rebrand setup, cross-origin to api.mktr.sg works because cookies live on parent `.mktr.sg`).
- redeem-frontend Static Site (Render): `VITE_BRAND=redeem`, `VITE_API_URL=/api` (relative — Render rewrites `/api/*` → `https://api.mktr.sg/api/*` so cookies live on `.redeem.sg`). Vite plugin emits brand-aware `robots.txt` + `sitemap.xml` per build.

## Meta Ads — Advertising Account, Pixel & CAPI

Paid acquisition (Facebook/Instagram) for the lead-capture funnel. All assets live under one Meta **business portfolio**. Topology verified 2026-06-04:

| Asset | ID | Notes |
|---|---|---|
| Business portfolio | `645399914612858` ("VoxaLabs AI") | Owns the ad account, Pixel, and Page below. |
| **Ad account — advertise from this** | `2170132703771607` ("MKTR", SGD) | `act_2170132703771607` for the Graph API. The only ad account the team should use. Payment method (MasterCard) attached. |
| Pixel / Dataset | `1402034528611431` ("MKTR Lead Capture") | Browser Pixel **+** CAPI, both live on `redeem.sg` and receiving events. Connected to the ad account. |
| Facebook Page | `1162230786970311` ("MKTR Campaigns") | The advertiser identity prospects see in-feed. |

**Gotcha — billing ID ≠ ad-account ID:** the MKTR ad account's **billing/payment-account ID is `6976122706429`**. It is the *same account* as `2170132703771607`, not a second one — it appears only in Billing-hub URLs, is **absent from the Ads Manager account picker**, and the Graph API returns `could not resolve ad account` for it. Always use `2170132703771607` in Ads Manager and the API.

**Ignore these accounts:** an empty portfolio "SG Health" (0 ad accounts), and the personal ad account `1931760067413088` ("Shawn Lee") — wrong identity for brand ads; don't attach the card or run campaigns there.

**Brand identity:** ads currently run as the "MKTR Campaigns" Page. Per the operator-vs-customer split, consider a **Redeem**-branded Page so consumer ads match the `redeem.sg` landing page. Link an Instagram professional account to the Page for IG placements.

**Tracking code:**
- `src/lib/metaPixel.js` — Pixel init + `ViewContent`/`Lead` with stable event IDs for Pixel⇄CAPI dedup; captures `_fbc` from `fbclid` and reads/synthesizes `_fbp` (`ensureFbp()` mints a first-party `_fbp` cookie when the Pixel hasn't set one yet, so server `Lead` events carry it). `shouldTrack` suppresses preview/demo/test-data routes and dev-without-test-code.
- `index.html` — base Pixel loader, gated on `VITE_META_PIXEL_ID`.
- `backend/src/services/metaCapiService.js` — fire-and-forget CAPI dispatch via the generic `sendConversionEvent(prospect, ctx, { eventName })` (thin wrappers `sendLeadEvent`/`sendCompleteRegistrationEvent`), gated by `shouldFireCapi` (skips Retell + Meta-Lead-Ads-origin prospects to avoid double-counting); per-campaign override via `Campaign.metaPixelId`, else `META_PIXEL_ID`. `ctx.eventTime` back-dates `event_time` for delayed down-funnel events (Meta accepts up to 7 days old).
- Full design: `docs/plans/meta-tracking-implementation.md`.

**Down-funnel CAPI events (reverse path — `ConfirmedResident` + `ClosedWon`):** whether a lead is a Singapore Citizen/PR is only known in Lyfe, so the signal travels *back* from Lyfe to MKTR. In this funnel `qualified` = "agent CONFIRMED the lead is SC/PR" (the liar-proof version of the self-declared form gate); `won` = bought a policy (implies SC/PR). When an agent advances a lead's `status`, a Supabase trigger (`leads_notify_mktr_outcome`, reference SQL in `docs/plans/lyfe-leads-outcome-webhook.sql`, applied in the separate `lyfe-app` repo) HMAC-POSTs to **`POST /api/integrations/lyfe/lead-outcome`** (`backend/src/routes/lyfeLeadOutcome.js` + controller). Auth = HMAC-SHA256 over `timestamp + "." + rawBody` (timestamp signed → no replay) with a generous ≤7-day freshness window (matches CAPI; tolerates pg_net backlog). `backend/src/services/leadOutcomeService.js` looks up the prospect (`external_id === prospect.id`) and fires `ConfirmedResident` (on `qualified`, and on `won` if not already sent) + `ClosedWon` (on `won`) with deterministic `event_id`s (`confirmed_resident:{id}`/`closed_won:{id}`) back-dated to the status change. Reliability: **mark-on-success** (the `sourceMetadata.capi.{confirmedResidentAt|closedWonAt}` marker is written only after a confirmed send, so a failed send stays re-tryable), bounded transient retry, Meta `event_id` dedup as the concurrency guard, and `/api/integrations/lyfe/` exempt from the public rate limiter; a reconciliation backfill (fast-follow) is the at-least-once safety net for best-effort pg_net. Event names are env-overridable (`META_EVENT_QUALIFIED=ConfirmedResident`/`META_EVENT_WON=ClosedWon`; `won` can later become `Purchase`). Secret: `LYFE_LEAD_OUTCOME_SECRET`. **Measure first** — keep optimizing on `Lead`; create a `ConfirmedResident` Custom Conversion per pixel, switch the ad set onto it once Meta-accepted with steady weekly volume (reachable sooner than a rare event since confirmed-resident volume ≈ real-lead volume; enforce a 24–72h confirmation SLA so events land in the 7-day click window), then seed a Singapore Lookalike from `ConfirmedResident` at ~100. There is no negative/"NotPR" Meta signal — the positive `ConfirmedResident` event + Lookalike is the lever.

**Env vars** (pixel/page IDs are public — embedded in page source; the access token is the only secret):

| Var | Component | Value / Notes |
|---|---|---|
| `VITE_META_PIXEL_ID` | Frontend build | `1402034528611431` |
| `META_PIXEL_ID` | Backend (CAPI) | `1402034528611431` |
| `META_CAPI_ENABLED` | Backend | Must be `"true"` to fire CAPI |
| `META_CAPI_ACCESS_TOKEN` | Backend | **Secret** — Pino-redacted, never commit |
| `META_TEST_EVENT_CODE` / `VITE_META_TEST_EVENT_CODE` | Both | Routes events to Test Events (staging/dev) |

`redeem.sg` is domain-verified in Meta (see the `facebook-domain-verification` TXT in the DNS section above).

**Running a paid campaign** (drives clicks into the existing round-robin pipeline): objective **Leads** (`OUTCOME_LEADS`), conversion location **Website**, optimize for the **Lead** event; destination = a `redeem.sg/LeadCapture?campaign_id={id}` link for the specific MKTR campaign so leads attribute + auto-assign. No native Meta Lead Forms — the funnel uses the `redeem.sg` landing page.

**Lead-quality controls** (who can actually convert — the `$20 voucher` hook attracts low-intent/freebie traffic, so two layers filter it):
- **Per-campaign SG/PR gate** — `design_config.sgPrOnly` (shipped `622fd2e`). When on, `CampaignSignupForm.jsx` renders a Yes/No "Singapore Citizen or PR?" screening card before the form ("No" blocks); toggle it in the campaign designer's **Content** panel. It is **client-side and self-declared** (the answer is not POSTed to the backend): it deters honest non-residents and — because the Pixel `Lead` event only fires on a completed submit — keeps unqualified people out of CAPI + Meta's conversion optimization, but won't stop a motivated false answer.
- **Meta-side audience filters** (ad-account config, not in this repo): Meta offers no occupation/citizenship targeting, so the ad set instead targets **"people who live in Singapore"** (`geo_locations.location_types:["home"]`, not the default "everyone in this location"), bounds age, and **excludes a customer-list Custom Audience** of known industry contacts/advisors (plus a lookalike of it). Under **Advantage+ Audience**, excluded custom audiences are the *only* hard filter Meta honors — interest/inclusion targeting is treated as a suggestion. Specific audience IDs live in the ad account.

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
  - `lead.unassigned`: clear assignment — update `assigned_to = null` + log activity; lead record preserved (B2 fixed 2026-03-23)
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

5. ~~**lead.unassigned deletes leads**~~ **(RESOLVED 2026-03-23)**: `lead.unassigned` updates `assigned_to = null` and logs an activity rather than deleting — the lead record and history are preserved (`receive-mktr-lead/index.ts`).

6. **Hardcoded email redirect**: `mailer.js:105-108` redirects System Agent emails to `shawnleejob@gmail.com`. Should be `SYSTEM_AGENT_REDIRECT_EMAIL` env var.

7. **env.example incomplete**: Critical pipeline variables not documented in either `env.example` or `.env.example`.

8. **Concurrency bottleneck**: `MAX_CONCURRENT_DELIVERIES = 3` could throttle webhook delivery under high lead volume.

9. **Agent sync is pull-only**: Agents must be synced manually (`POST /api/lyfe/agents/sync`) or on demand. No automatic periodic sync.

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
