# MKTR Platform

**MKTR captures qualified insurance leads across Singapore (QR codes, web forms, Retell AI voice calls), assigns each lead to an agent via package-funded round-robin, and delivers it in seconds to the agent's app through HMAC-signed webhooks.**

Around that pipeline the repo carries three more products that share its database and backend:

- **Campaign Studio** — the design surface every customer-facing campaign page is built in (`design_config` v2, AI-assisted authoring).
- **Redeem marketplace** — the `redeem.sg` storefront where consumers browse offers and lucky draws, including the draw engine (entry passes, ×N boosts, sealed winner draws).
- **Redeem Ops** — an internal partner CRM at `ops.redeem.sg` (partner pipeline, outreach tasks and cadences, reward inventory, activations, redemptions, prospecting).

One Express/Node.js backend (PostgreSQL + Sequelize) serves all of it. One React/Vite SPA in `src/` builds into **three static sites from the same commit**, branched by build-time env: `mktr.sg` (operator console), `redeem.sg` (customer), `ops.redeem.sg` (Redeem Ops staff). Leads flow outward to two downstream agent apps — **Lyfe** (the insurance agency's mobile app) and **mktr-leads** (a second, external agent team) — selected per-agent at delivery time.

For the authoritative architecture reference (Supabase table ownership, the Lyfe contract, Meta Ads topology, the full env matrix) read [`CLAUDE.md`](CLAUDE.md) and the deep-dives in [`docs/reference/`](docs/reference/). This README is the orientation entry point.

---

## 📋 Table of contents

- [What the platform does](#-what-the-platform-does)
- [System topology](#-system-topology)
- [The three frontend surfaces](#-the-three-frontend-surfaces)
- [The lead pipeline](#-the-lead-pipeline)
- [Campaign Studio](#-campaign-studio)
- [Marketplace & the draw engine](#-marketplace--the-draw-engine)
- [Redeem Ops](#-redeem-ops)
- [People, consent & compliance](#-people-consent--compliance)
- [Integrations](#-integrations)
- [Tech stack](#-tech-stack)
- [Repository layout](#-repository-layout)
- [Data model](#-data-model)
- [Backend API surface](#-backend-api-surface)
- [Roles & access control](#-roles--access-control)
- [Local development](#-local-development)
- [Environment variables](#-environment-variables)
- [Scripts](#-scripts)
- [Testing & CI](#-testing--ci)
- [Deployment](#-deployment)
- [How the server boots](#-how-the-server-boots)
- [Retired & frozen code](#-retired--frozen-code)
- [Further documentation](#-further-documentation)

---

## 🎯 What the platform does

1. **Capture** a lead:
   - A prospect scans a **QR code** (`redeem.sg/t/{slug}`) → redirected to the campaign's page.
   - A prospect submits the **campaign page / lead-capture form** (`redeem.sg/LeadCapture?campaign_id={id}`), optionally gated by a quiz funnel, an age gate, a self-declared SG Citizen/PR check, and OTP phone verification.
   - A **Retell AI voice bot** finishes a call → posts a signed webhook → MKTR creates the lead.

2. **Screen** it, when the campaign asks for it: an **AI screening call** (a second Retell agent) holds the lead, dials the prospect, records a verdict, and releases qualified leads to the agent while negatives stay in the admin queue.

3. **Assign** it to an agent using a deterministic priority ladder (self → admin-pick → QR owner → lead-package round-robin → System Agent fallback), gated by a **prepaid lead-credit** system so agents only receive leads they have funded.

4. **Deliver** it to the correct downstream app. Each agent carries a provenance (`lyfeId` *or* `mktrLeadsId`); the **destination-aware webhook dispatcher** routes `lead.created` / `lead.assigned` / `lead.unassigned` to **Lyfe** or **mktr-leads** accordingly, HMAC-signed, with retries and a dead-letter queue.

5. **Reward** the prospect: campaign pages can hand out reward vouchers or lucky-draw entries, fulfilled over email and WhatsApp, redeemable at partner locations tracked in Redeem Ops.

6. **Track conversions** back to the ad platforms: browser **Meta Pixel** + server-side **Conversions API** and **TikTok Events API** fire `ViewContent` / `CompleteRegistration` / `Lead` / `VoucherRedeemed`. A **down-funnel reverse path** lets Lyfe report `qualified` / `won` outcomes back to MKTR, which fires `ConfirmedResident` / `ClosedWon` (back-dated inside Meta's 7-day window).

7. **Operate** it all from `mktr.sg`: Campaign Studio, QR/short-link generation, the agent roster across both agent sources, lead packages and wallets, the lead dispatch queue, the people directory, cohorts and email broadcasts, dashboards, and webhook delivery monitoring.

---

## 🗺 System topology

Four Render services deploy from this one repository (three static sites + one backend), feeding two external Supabase-backed apps:

```
┌───────────────────────── MKTR Platform (this repo, on Render) ─────────────────────────┐
│                                                                                        │
│  redeem.sg                    mktr.sg                     ops.redeem.sg                │
│  redeem-frontend              mktr-platform               redeem-ops-frontend          │
│  VITE_BRAND=redeem            VITE_BRAND=mktr             VITE_SURFACE=ops             │
│  Marketplace + campaign       Operator console +          Partner CRM, tasks,          │
│  pages + lead capture         Campaign Studio             rewards, Discover            │
│       │                            │                           │                       │
│       └──────────────┬─────────────┴───────────────────────────┘                       │
│                      ▼   all three proxy /api/* and /uploads/* →                       │
│           ┌──────────────────────────┐                                                 │
│           │  api.mktr.sg             │  Single Express monolith (backend/)             │
│           │  mktr-backend-jo6r       │  PostgreSQL + Sequelize · Pino · Sentry         │
│           └─────────┬────────────────┘                                                 │
│  Retell AI ─webhook─▶│ POST /api/retell/webhook                                        │
│  Meta WhatsApp ─────▶│ POST /api/whatsapp/webhook  (delivery statuses + STOP replies)  │
│  QR / campaign page ▶│ POST /api/prospects                                             │
│                      │                                                                 │
│  ┌───────────────────┴────────── outbound, destination-aware, HMAC-signed ──────────┐  │
│  │  lead.created / lead.assigned / lead.unassigned / lead.suppressed                │  │
│  └──────────────┬──────────────────────────────────────┬──────────────────────────┬─┘  │
└─────────────────┼──────────────────────────────────────┼──────────────────────────────┘
                  ▼                                      ▼
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │  Lyfe (insurance agency app) │        │  mktr-leads (2nd agent team) │
   │  Supabase Edge Function      │        │  Supabase Edge Function      │
   │  receive-mktr-lead           │        │  receive-mktr-lead           │
   │  → leads → push notification │        │  → leads → push notification │
   └──────────────────────────────┘        └──────────────────────────────┘
        ▲  agent sync (pull, 10 min)            ▲  agent sync (pull, 10 min)
        └──── mktr-agents EF + users ────┘      └──── agents PostgREST + admin ────┘
              push webhook                            invite / activate / edit
```

Agents from both downstream apps are **mirrored into the backend's local `users` table** so round-robin can route to either pool. Mirroring is pull-based (a 10-minute in-process cron) plus a push webhook from Lyfe (`/api/integrations/lyfe/users-webhook`) that closes the polling lag on activations/deactivations.

---

## 🎨 The three frontend surfaces

The same React SPA in `src/` builds into three Render Static Sites from the same git commit. This is an **audience split, not a rebrand** — all three coexist permanently.

| Render service | Domain | Build env | Audience |
|---|---|---|---|
| `mktr-platform` | `mktr.sg`, `www.mktr.sg` | `VITE_BRAND=mktr` (default) | **Operator.** Admin console, Campaign Studio, QR generation, agent groups, wallets, marketing pages, staff login. |
| `redeem-frontend` | `redeem.sg`, `www.redeem.sg` | `VITE_BRAND=redeem` | **Customer.** Marketplace at the apex `/`, campaign pages, lead capture, reward claim, draw winners. (A service of MKTR PTE. LTD., UEN 202507548M.) |
| `redeem-ops-frontend` | `ops.redeem.sg` | `VITE_SURFACE=ops` | **Redeem Ops staff.** Partner CRM / tasks / rewards / Discover. Also reachable at `mktr.sg/redeem-ops`. |

**How the split works** ([`vite.config.js`](vite.config.js), [`src/lib/brand.js`](src/lib/brand.js), [`src/pages/index.jsx`](src/pages/index.jsx)):

- `vite.config.js` reads `VITE_BRAND` at config time and aliases `@brand-config` → `src/lib/brandConfigs/mktr.js` or `redeem.js`. The inactive brand's strings (wordmark, regulatory copy, hosts) are tree-shaken out of `dist/`. Acceptance test: grepping the redeem build for `MKTR` returns only the intentional legal-entity references.
- Components read `brand` from `@/lib/brand`. Brand-aware values: `name`, `wordmark`, `legalName`, `uen`, `publicHost`, logos/favicons, PDPA URLs, and the `show*` route gates.
- `VITE_SURFACE=ops` swaps the whole route table for an ops-only one (auth + `/redeem-ops/*`; everything else redirects into the queue).
- **Customer-facing URL helpers are host-aware.** Customer surfaces default to `redeem.sg`; a campaign opts into `mktr.sg` via `design_config.customerHost` → `resolveCustomerHost()`. Helpers: `customerPublicUrl`, `customerLeadCaptureUrl`, `customerPreviewUrl`, `publicTrackingUrl`, `publicShareUrl`. **Security rule: never pass a raw hostname from campaign JSON into a helper — clamp the enum choice first.**
- **Internal routes are `mktr.sg`-only**, enforced at three layers: Render edge redirect rules on `redeem-frontend`; SPA-level `MktrOnlyRedirect` (on the redeem build `ProtectedRoute` is replaced wholesale, so admin UI never renders); and the backend `internalRouteHostGuard`, which 403s `/api/auth/*`, `/api/admin/*`, `/api/agents/*`, `/api/users/*`, `/api/integrations/*` and friends when the validated public host is `redeem.sg`.
- `vite.config.js` also emits a brand-aware `robots.txt` + `sitemap.xml` per build (public routes only; admin/auth disallowed).

The single backend serves all origins and branches per request via `backend/src/utils/publicHost.js` (`publicHostFromRequest`, allowlisted to the four apex+www hosts) — driving cookie-domain selection, per-host redirect base (`frontendBase.js`), CAPI `event_source_url` alignment, and `EMAIL_FROM` selection.

---

## 🔄 The lead pipeline

### Capture → screen → assign → deliver

```
POST /api/prospects (or the Retell webhook)
  → prospectService.createProspect()
      ├─ resolve attribution (session cookie `sid` → QR scan → campaign)
      ├─ validate (unique phone per campaign, age gate, consent, OTP-verified phone)
      ├─ DNC scrub (Singapore PDPC registry) — block or flag per DNC_ENFORCEMENT
      ├─ record consent grants into the consent ledger; link/create the Consumer
      ├─ screening gate → if the campaign screens, HOLD and queue a Retell call
      ├─ resolve agent (systemAgent.resolveLeadRouting / resolveLeadAssignment)
      ├─ charge a lead credit (leadQuota.decideAssignment → leadCredits.chargeLeadCredit)
      │     └─ no funded agent on a quota campaign → HELD (quarantined, undelivered)
      ├─ issue the reward entitlement / draw entry, notify by email + WhatsApp
      ├─ fire Meta CAPI `Lead` (+ `CompleteRegistration` on quiz reveal) and TikTok events
      └─ dispatch `lead.created` (webhookService.dispatchEvent, post-commit)
            └─ destination-aware: routed to Lyfe or mktr-leads by the agent's provenance
```

### Agent assignment priority (`systemAgent.js`)

`resolveLeadRouting()` returns `{ agentId, via }` by walking this ladder:

1. **Self** — requester is an `agent` (quota-exempt).
2. **Admin-explicit** — admin passed a valid `requestedAgentId` (quota-exempt).
3. **QR direct** — the QR tag has an `assignedAgentId` / legacy `ownerUserId` (quota-gated).
4. **Lead-package round-robin** — per-campaign `RoundRobinCursor` (monotonic counter, modulo-at-read) over active agents holding a `LeadPackageAssignment` with `leadsRemaining > 0` (quota-gated). Serialized per-campaign in-process to survive concurrent webhook bursts.
5. **System Agent fallback** — `system@mktr.local` (quota-gated → held on hard-quota campaigns).

`resolveLeadAssignment()` extends this with a **unified ring** mixing internal agents and external **mktr-leads buyers** (prepaid `ExternalAgent.leadBalance`) for campaigns flagged `externalEligible`, with consent gating.

### Lead quota / credits / wallet

- `Campaign.enforceLeadQuota` turns delivery into a hard gate: a lead is delivered only if a credit was charged; otherwise it is **held** (`quarantinedAt`, `quarantineReason`).
- `chargeLeadCredit()` is authoritative — atomic FIFO decrement of the oldest active `LeadPackageAssignment` for that campaign (`FOR UPDATE SKIP LOCKED`), falling back to `users.owed_leads_count`. `deductLeadCredit()` is the best-effort, never-throws variant for exempt routes.
- **Held leads are manual-only.** An admin assigns them from the dispatch queue; nothing auto-releases on credit top-up. `releaseSweep.sweepAll()` still runs on a 2-minute timer but is a no-op behind `AUTO_RELEASE_ENABLED = false` — the mechanics are retained in case auto-release is restored.
- Agents top up through the wallet (`WalletLedger`, `Payment`, HitPay checkout) and the `/api/external/*` broker surfaces that mktr-leads calls.

### Outbound webhook delivery (`webhookService.js`)

- Events: **`lead.created`**, **`lead.assigned`**, **`lead.unassigned`**, and **`lead.suppressed`** (per-destination opt-in — read the propagation runbook before flipping it; the receivers 400 unknown events, and 50 consecutive failures auto-disable the subscriber).
- **Destination-aware:** subscribers are tagged `metadata.destination` (`lyfe` | `mktr_leads`); a lead is delivered only to the subscriber matching its agent's provenance (null-destination agents like System Agent are default-denied).
- **Signing:** `X-Webhook-Signature` = HMAC-SHA256 of the body, plus `X-Webhook-Event`, `X-Webhook-Delivery-Id`, `X-Webhook-Timestamp`.
- **Reliability:** 10s timeout, 3 attempts with exponential backoff (1s/4s/16s), auto-disable after 50 consecutive failures, in-process concurrency cap of 3 with backpressure, a queryable **dead-letter queue**, and startup + 60s recovery of stranded retries.
- **Global switch:** `WEBHOOK_ENABLED` must be `"true"` or no leads leave the backend (boot logs a warning if a destination URL is set while the switch is off).

Both webhook **subscribers are auto-registered and reconciled on every boot** from the adapter env (`bootstrap.js`).

---

## 🎛 Campaign Studio

Studio is the **permanent** campaign design surface at `/admin/campaigns/:id/studio` — a full-viewport editor over the versioned `design_config` v2 document, with the same v2 renderer (`src/components/campaignPage/`) driving the live customer page.

- **Twins:** `src/lib/designConfigV2.js` ↔ `backend/src/utils/designConfigV2.js` (+ `designConfigV2Clamp.js`) must stay in step — the backend clamp is the security boundary for anything a customer page renders.
- **AI assist** fills every slot: copy, looks, distribution picks, sign-up field selection, and T&C drafting. Draw campaigns use the deterministic `drawTermsTemplate` facts, **never LLM-written legal text**. Publication recommendations are advisory and never auto-applied.
- **Profile questions** — a campaign can slide enrichment questions into its signup funnel from a **fixed library** (`profileQuestionLibrary`: language, annual income, children, pets, retirement age), each with a per-question Required toggle and a per-campaign Chinese-inline-text toggle. Admins pick questions, never author them: free text would need LLM parsing and would poison the deterministic fact ledger. Answers map to taxonomy fact keys server-side and feed [lead scoring](#lead-scoring--meet--buy). The library is a byte-identical twin — `src/lib/profileQuestionLibrary.js` ↔ `backend/src/utils/profileQuestionLibrary.js`, enforced by a parity test.
- **Readiness gates** (`campaignReadinessService`) block activation on server-verifiable problems — OTP send-path misconfiguration, missing draw records, close-date drift, promise-vs-enforcement mismatches.
- The classic `DesignEditor` survives only as the `guided_review` designer; the standalone `/AdminCampaignDesigner` page is retired and redirects into the workspace Design tab.
- `DESIGN_CONFIG_V2_WRITES_ENABLED` (backend) is the emergency brake on v2 writes.

Rollout/rollback runbook: [`docs/reference/campaign-studio-rollout.md`](docs/reference/campaign-studio-rollout.md).

---

## 🎁 Marketplace & the draw engine

- **Marketplace v2** is the `redeem.sg` apex: browse, categories, offer pages, and the claim flow (`src/pages/marketplace/`), behind `VITE_REDEEM_MARKETPLACE_ENABLED` on the frontend and `MARKETPLACE_PUBLIC_API_ENABLED` on the backend.
- **Single door:** marketplace listings and featured tiles are *derived from the campaign page* rather than authored twice — editors show read-only inherited previews. Twins: `src/lib/listingDerivation.js` ↔ `backend/src/utils/listingDerivation.js`. See [`docs/plans/marketplace-inherits-campaign-page.md`](docs/plans/marketplace-inherits-campaign-page.md).
- **Rewards** are issued as `RewardEntitlement` rows, claimed at `/r/:token` (`GET /api/reward-claim/:token`), and redeemed against `RewardOffer` inventory at partner locations.
- **Lucky draws** get their own engine: `Draw`, `DrawEntry`, `DrawAttempt`, `DrawBoostReview`, `DrawTermsVersion`. A signup mints an entry and a WhatsApp/email **entry pass**; extra chances (**×N boosts**) are earnable through the agent scan door and reviewed on a veto model (unlocks count by default, a `rejected` review is a strike). Draw records auto-provision on launch and self-heal through a boot + hourly reconciler. Winners are published at `redeem.sg/winners`.

---

## 🤝 Redeem Ops

An internal CRM for the partner side of the marketplace, live at `ops.redeem.sg` and mirrored at `mktr.sg/redeem-ops`. Flag-gated end to end (`REDEEM_OPS_ENABLED`, plus per-feature flags).

Partner organisations, locations and contacts on a five-stage pipeline · outreach tasks, queues and pools · **cadences** (multi-step sequences with AI-drafted messages) · reward offers and inventory · activations and issuance · redemption tracking · **Discover** (Apify-backed prospecting with territory and hashtag sourcing) · analytics · a capability-based permission matrix on `users.redeemOpsRole`.

Deep-dive: [`src/pages/redeemops/CLAUDE.md`](src/pages/redeemops/CLAUDE.md) and [`docs/redeem-ops/`](docs/redeem-ops/) (ERD, route map, permission matrix, domain ownership).

---

## 🧾 People, consent & compliance

- **Consumer spine** — `Consumer` deduplicates a real person across campaigns; every prospect links to one (`prospects.consumerId`). Admin surfaces: the people directory (`/AdminPeople`) and the per-person lead profile (`/admin/leads/:prospectId`).
- **Enrichment ledger** — every fact learned about a person is appended to `ConsumerObservation` with its provenance, then resolved into `ConsumerProfile` by `factMapperService` through an outbox of `EnrichmentJob` rows. Nothing overwrites: the ledger is the audit trail, the profile is the current view.
- **Consent ledger** — `ConsentEvent` records each grant with its versioned copy (`consentCopyRegistry`, `GET /api/consent-copy/:version`), so any downstream use can prove what the person actually agreed to. Meta/TikTok PII hashing is gated on a ledger-derived marketing-consent flag.
- **Suppression & erasure** — `ConsumerSuppression` + `SuppressionPropagation` carry unsubscribes outward (`lead.suppressed`, per-destination opt-in); `erasureService` cascades deletion; `/api/unsubscribe` and WhatsApp `STOP` both land in the same place.
- **Cohorts & broadcasts** — `Cohort` builds cross-campaign audiences; `EmailBroadcast` sends to them with per-recipient tracking and interrupted-run resume (nothing auto-sends on a deploy or restart).
- **DNC scrubbing** — every captured phone is checked against the Singapore PDPC Do-Not-Call registry (`DNC_API_ENABLED`, RSA-signed, fixed-IP egress proxy), enforced as `block` or `flag`, with a backfill job for checks that errored.
- **SMS sender compliance** — OTP SMS ships under the SSIR-registered `MKTR` sender ID with per-phone and global daily caps plus threshold alerts (`smsQuota`, `RateCounter`).

### Lead scoring — MEET × BUY

`utils/consumerScoring.js` turns resolved facts plus behavioural telemetry into two sub-scores, so "will they meet a consultant" and "will they buy" stay separate questions:

```
MEET = engagement 15 + contactability 10 + market fit 15        (raw 40) ×2.5
BUY  = life events 25 + family gap 20 + capacity 15
       + coverage headroom −10..0                               (raw 60) /60
consumerScore = clamp(0, Σ all components, 100)                 ← default sort
```

The design points worth knowing:

- **The engine is pure.** Facts and telemetry in, scores out — no I/O, no clock (the caller passes `now`). Any score can be re-derived and explained from its stored breakdown, which is what the dials on the lead profile render.
- **Weights are config, rules are code.** `EnrichmentScoringConfig` carries per-component `maxPoints`, the Meet/Buy `groups` map, and `targetSegments`; each rule returns a 0..1 fraction of its component's max. Recalibrating — or regrouping which components feed Meet vs Buy — is a config row, not a deploy.
- **Unknown ≠ zero.** BUY is `null` unless at least one fact component is assessable, because an unknown income must not read as low capacity. MEET always computes (engagement and contactability are behavioural), but market fit only contributes when the language or ethnicity fact exists, and the breakdown says so.
- **Penalties carry their sign in `maxPoints`, never in the fraction** — `coverage_headroom` has `maxPoints −10`, so "fully covered" scores −10 rather than inverting into a bonus.

Scoring runs in-process behind `ENRICHMENT_SCORING_ENABLED`: an hourly tick fenced by `EnrichmentSweepRun` to one real sweep per SGT date, so an instance that was down at the intended hour still sweeps that day. Design: [`docs/plans/consumer-profile-enrichment.md`](docs/plans/consumer-profile-enrichment.md) and [`docs/plans/per-campaign-lead-scoring.md`](docs/plans/per-campaign-lead-scoring.md).

---

## 🔌 Integrations

| Integration | Direction | Where | Notes |
|---|---|---|---|
| **Retell AI** (capture bot) | inbound webhook | `routes/retell.js`, `retellService.js` | HMAC-SHA256 over `body + timestamp` (`x-retell-signature: v=<ts>,d=<hex>`) — the real retell-sdk scheme. Idempotent per `call_id` (24h TTL). Sentiment → priority. Resolves/auto-creates `[Retell] {name}` campaigns. Recording URLs fetched + cached on demand. |
| **Retell AI** (screening) | outbound + inbound | `retellScreeningService.js`, `screeningGate.js`, `screeningSweepService.js`, `routes/screeningCallback.js` | Holds a lead, dials inside a call window with attempt/concurrency caps, stores transcript + cost, releases on a qualified verdict. `RETELL_SCREENING_ENABLED`. |
| **Meta Pixel + CAPI** | outbound | `src/lib/metaPixel.js`, `metaCapiService.js` | Browser Pixel + server CAPI sharing an `event_id` for dedup; `_fbc`/`_fbp` capture; PII only with ledger consent. Suppressed for Retell leads, Meta-lead-gen-attributed leads, and preview/demo routes. |
| **Meta down-funnel CAPI** | inbound→outbound | `routes/lyfeLeadOutcome.js`, `leadOutcomeService.js` | Lyfe advances a lead → HMAC POST `/api/integrations/lyfe/lead-outcome` → fires `ConfirmedResident` (qualified) / `ClosedWon` (won), back-dated, mark-on-success, deterministic `event_id`. |
| **Meta redeemed-audience sync** | outbound | `redeemedAudienceService.js` | Pushes redeemed customers into a Meta customer-list exclusion audience so ads stop chasing people who already converted. |
| **TikTok Events API** | outbound | `src/lib/tiktokPixel.js`, `tiktokEventsService.js` | Mirrors the Meta CAPI pattern (`ttclid`/`ttp`); per-campaign `tiktokPixelId` override. |
| **Lyfe (Supabase)** | outbound webhook + agent sync | `integrations/adapters/lyfe/`, `routes/lyfe.js`, `routes/lyfeUsersWebhook.js`, `routes/lyfeEntitlementUnlock.js` | Leads delivered to the `receive-mktr-lead` EF; agents mirrored from the `mktr-agents` EF (pull) plus a `users` push webhook; consultants unlock entitlements. |
| **mktr-leads (Supabase)** | outbound webhook + agent sync + admin mgmt | `integrations/adapters/mktr-leads/`, `routes/mktrLeadsAgents.js`, `routes/external*.js` | Second agent source; admins invite/activate/deactivate/edit its agents from MKTR; HMAC broker surfaces for wallet, billing, packages, held leads, lead timeline and outcomes. |
| **Meta WhatsApp Cloud API** | outbound + inbound | `services/redeemOps/whatsappService.js`, `waWebhookService.js`, `routes/whatsappWebhook.js` | Template sends (OTP, entry pass, boost receipt, voucher, callback opt-in) plus `POST /api/whatsapp/webhook` for per-`wamid` sent/delivered/read/failed statuses — including the silent 131049 frequency-cap drops — and `STOP` as a global unsubscribe. Verified with `X-Hub-Signature-256`; **prod fails closed without `WHATSAPP_APP_SECRET`**. |
| **AWS SNS** | outbound | `verificationService.js` | SMS OTP under the SSIR-registered sender ID, behind daily caps. |
| **PDPC DNC registry** | outbound | `dncCheckService.js`, `dncGate.js` | RSA-signed realtime scrub through a fixed-IP egress proxy. |
| **Apify** | outbound | `services/redeemOps/discoveryService.js` | Redeem Ops Discover — place/hashtag scraping with run reconciliation and PII retention purge. |
| **HitPay** | outbound | `hitpayClient.js`, `billingService.js` | Agent wallet top-up checkout. |
| **OpenAI / Anthropic** | outbound | `routes/adminAi.js`, `campaignCopyAiService.js`, `guidedReviewAiService.js`, `services/redeemOps/cadenceAiService.js` | Studio AI fill, guided review, cadence drafting. Admin-entered keys are AES-256-GCM encrypted with `AI_SETTINGS_ENCRYPTION_KEY`. |
| **AWS S3 / DigitalOcean Spaces** | outbound | `services/storage.js` | QR PNGs, campaign media, uploads — S3-compatible via `DO_SPACES_*`, falling back to local disk when unconfigured. |
| **Google OAuth** | inbound | `authController.js` | Staff Google sign-in (`/auth/google/callback`). |
| **Sentry** | outbound | backend + frontend | Error tracking; backend tags `service: mktr-backend`. |

> Agent sync uses a small **adapter pattern** (`backend/src/integrations/`): `AdapterRegistry` + a `PlatformAdapter` contract, with `LyfeAdapter` and `MktrLeadsAdapter` implementations. New downstream apps register another adapter.

---

## 🛠 Tech stack

### Frontend (`src/`) — one React SPA → three static sites

- **React 18.2** + **Vite 6.1**, **React Router DOM 7.2**
- **Tailwind CSS 3.4** + **Radix UI** primitives + **lucide-react** + **framer-motion**
- **TanStack Query 5** (server state) + **Zustand 5** (auth store)
- **React Hook Form 7** + **Zod 3** validation
- **Sentry** (`@sentry/react`), **Sonner** toasts, **Recharts**, **jsPDF**, **@dnd-kit**, **cmdk** (⌘K palette), **DOMPurify**
- **Vitest 4** + Testing Library; **Playwright** E2E (`e2e/`)
- ESLint 9 + Prettier 3, Husky + lint-staged

### Backend (`backend/`) — Express monolith

- **Node.js ≥ 18** (CI on 20), **Express 5.2**, ES modules
- **Sequelize 6.35** over **PostgreSQL** (`pg` 8.11; the connection layer is Postgres-only and requires `DB_HOST`)
- **Pino** structured logging (`pino-http`), **Sentry** (`@sentry/node`)
- **JWT** (`jsonwebtoken`) + **Google OAuth** (`google-auth-library`), **bcryptjs**, **jose** (JWKS)
- **Joi** validation, **Helmet**, **express-rate-limit**, **compression**, **cookie-parser**, **CORS**
- **Nodemailer** (email), **qrcode**, **AWS SDK v3** (S3 + SNS), **satori** + **@resvg/resvg-js** (rendered QR / pass cards), **pdfkit**, **ffmpeg-static**
- **Swagger** (`swagger-jsdoc` + `swagger-ui-express`, non-prod only at `/api-docs`)
- **Jest** + **supertest** tests; a local **load harness** (`backend/load/`)

---

## 📂 Repository layout

```
mktr-platform/
├── src/                      # React SPA (mktr.sg / redeem.sg / ops.redeem.sg from one tree)
│   ├── pages/
│   │   ├── index.jsx         #   the router — public / auth / role-gated / ops route tables
│   │   ├── adminv2/          #   Switchboard admin v2 (VITE_ADMIN_V2_ENABLED)
│   │   ├── redeemops/        #   Redeem Ops staff surface (+ its own CLAUDE.md)
│   │   ├── marketplace/      #   redeem.sg marketplace v2
│   │   └── *.jsx             #   top-level pages: lead capture, legal, marketing, auth
│   ├── components/           # campaignPage (v2 renderer), studio, campaigns, prospects,
│   │                         #   agents, qrcodes, lead-packages, redeemops, adminv2, ui (Radix)
│   ├── api/                  # API client + entity classes
│   ├── lib/                  # brand.js, brandConfigs/, designConfigV2.js, listingDerivation.js,
│   │                         #   drawCopy.js, metaPixel.js, tiktokPixel.js, consentCopy.js
│   ├── hooks/ services/ stores/ schemas/ utils/ design/ constants/
│   └── main.jsx App.jsx index.css
│
├── backend/                  # Express monolith (the live system)
│   └── src/
│       ├── server.js         # "Shell" boot: listen immediately, then load app logic
│       ├── server_internal.js# real app init: middleware stack, health, route auto-loader
│       ├── routes/           # 66 auto-discovered route modules (each exports `meta`)
│       ├── controllers/      # 44 request handlers
│       ├── services/         # 98 top-level + 39 under redeemOps/
│       ├── models/           # 90 Sequelize models + index.js (associations)
│       ├── middleware/       # auth, internalRouteHostGuard, prospectScope, validation, …
│       ├── integrations/     # adapter registry + Lyfe / mktr-leads adapters
│       ├── database/         # connection, bootstrap, runMigrations, migrations/ (92), seed
│       ├── utils/ config/ schemas/ scripts/ tests/
│       └── uploads/          # local asset storage (dev / fallback)
│
├── e2e/                      # Playwright end-to-end specs
├── scripts/                  # campaign-page parity harness, Studio smoke driver
├── docs/                     # reference/ · plans/ · redeem-ops/ · audit/ · codex-reviews/ · dnc/
├── tablet-app/ services/ infra/   # ⛔ retired — see "Retired & frozen code"
├── CLAUDE.md                 # 👉 authoritative architecture reference
├── TRACKER.md                # feature matrix + bug log + priority queue
├── vite.config.js            # brand/surface-aware build (@brand-config, robots/sitemap)
└── package.json              # frontend scripts (backend has its own)
```

---

## 🗃 Data model

The backend owns its **own PostgreSQL database** (Sequelize), separate from Lyfe's Supabase — 90 models. The ones that matter most:

**Identity & agents**
- `User` — local identity. Roles: `admin`, `agent`, `fleet_owner`, `driver_partner`, `customer`, `redeem_ops`; plus `redeemOpsRole` for the Redeem Ops capability matrix. Carries provenance (`lyfeId` **xor** `mktrLeadsId`, enforced by a DB CHECK), `external_role`, `approvalStatus`, `isActive`, `owed_leads_count`, and a two-phase-delete `pending_deletion_at`.
- `ExternalAgent` — mktr-leads buyers, kept **separate** from `users` so agent-sync never touches them. Prepaid global `leadBalance`; `ExternalCampaignAgent` maps campaign eligibility.
- `AgentGroup` / `AgentGroupMember` — round-robin pools attached to QR tags. `UserPayout` — payout method per user.

**Leads & people**
- `Prospect` — the lead record: `leadSource` / `leadStatus` / `priority` enums, scoring, JSON `demographics` / `budget` / `consentMetadata` / `sourceMetadata`, `retellCallId`, routing state (`assignedAgentId` **xor** `externalAgentId`, `quarantinedAt` / `quarantineReason`), the DNC block (`dncStatus`, `dncNoVoiceCall`, `dncValidUntil`, …), the screening block (`screeningVerdict`, `screeningAttemptCount`, `screeningNextAttemptAt`, …), and `consumerId` / `enrichmentRevision`.
- `ProspectActivity` — audit trail. `Attribution` / `SessionVisit` — QR-scan → session → lead attribution chain.
- `Consumer`, `ConsentEvent`, `ConsumerSuppression`, `SuppressionPropagation`, `Cohort`, `EmailBroadcast` / `EmailBroadcastRecipient` — the person spine, consent ledger, and marketing surfaces.
- `ConsumerObservation` (append-only fact ledger), `ConsumerProfile` (resolved view + `meetScore` / `buyScore` / `consumerScore` and their breakdown), `EnrichmentJob` (mapper outbox), `EnrichmentScoringConfig` (weights, groups, target segments), `EnrichmentSweepRun` (per-SGT-date sweep fence).

**Campaigns**
- `Campaign` — `type` (`lead_generation` | `brand_awareness` | `product_promotion` | `event_marketing` | `quiz` | `guided_review`), `status`, `design_config` (the v2 document), `slug`, `min_age`/`max_age`, `metaPixelId`/`tiktokPixelId`, `leadPriceCents`, `firstActivatedAt`, and the routing gates `enforceLeadQuota` + `externalEligible`.
- `CampaignMediaItem`, `CampaignPreview`, `CampaignAgentAssignment`.

**Credits, wallet & billing**
- `LeadPackage` / `LeadPackageAssignment` (the prepaid quota an agent consumes), `RoundRobinCursor`, `WalletLedger`, `Payment`, `Commission`.

**Rewards, draws & Redeem Ops**
- `RewardOffer` / `RewardOfferLocation` / `RewardTermsVersion` / `RewardInventoryEvent` / `RewardEntitlement`, `Redemption` / `RedemptionEvent`, `Activation` / `ActivationIssuanceSkip`.
- `Draw`, `DrawEntry`, `DrawAttempt`, `DrawBoostReview`, `DrawTermsVersion`.
- `PartnerOrganisation` / `PartnerLocation` / `PartnerContact` / `PartnerStageEvent` / `PartnerAssignmentEvent` / `PartnerOnboardingItem`, `OutreachTask` / `OutreachActivity` / `OutreachCadence*` / `OutreachSuppression`, `ProspectingPool` / `ProspectingPoolMember`, `DiscoveryRun` / `DiscoveryCandidate` / `DiscoveryTerritory` / `DiscoveryPlaceMemory` / `DiscoveryDailyUsage`, `RedeemOpsCategory`, `RedeemOpsAuditEvent`.

**QR, links, webhooks & misc**
- `QrTag` (slug, `agentAssignmentMode` direct|round_robin, `targetHost`, denormalized assigned-agent fields), `QrScan`, `ShortLink`, `ShortLinkClick`.
- `WebhookSubscriber` (with `metadata.destination`), `WebhookDelivery` (retry/DLQ state), `IdempotencyKey`.
- `Verification` (OTP), `RateCounter` (SMS caps), `AiSettings`, `WaitlistSignup`.

**Retired but still in the schema:** `Device`, `Vehicle`, `Car`, `FleetOwner`, `Driver`, `DeviceCampaignAssignment`, `VehicleCampaignAssignment`, `BeaconEvent`, `Impression`, `ProvisioningSession`.

---

## 🌐 Backend API surface

Routes are **auto-discovered**: each file in `backend/src/routes/` exports `meta = { path, flag?, flagDefault?, priority?, mounts? }`, and `loadRoutes()` mounts them sorted by priority, skipping flag-disabled routes. Base URL: `https://api.mktr.sg/api` (prod) or `http://localhost:3001/api` (dev).

**Lead pipeline & campaigns**
- `POST /api/prospects` — lead capture (public); `/api/prospects/*` — list / assign / bulk-assign / stats (auth)
- `/api/campaigns`, `/api/admin/campaigns`, `/api/previews` — campaigns, Studio writes, public preview snapshots
- `/api/qrcodes` (+ public `GET /api/qrcodes/track/:slug`), `/api/shortlinks` (+ public `/share/*`)
- `/api/lead-packages`, `/api/admin/wallets`, `/api/commissions`
- `/api/verify` (OTP), `/api/dnc`, `/api/contact`, `/api/waitlist`

**People, consent & marketing**
- `/api/consumers` (people directory + person journey), `/api/cohorts`, `/api/email-broadcasts`
- `/api/consent-copy/:version`, public `/api/unsubscribe`

**Marketplace, rewards & draws**
- `/api/marketplace` — public listings (`MARKETPLACE_PUBLIC_API_ENABLED`)
- `GET /api/reward-claim/:token` — public voucher / draw-pass claim (`REDEEM_OPS_ENTITLEMENTS_ENABLED`)
- `/api/screening-callback/:token` — public screening callback opt-in

**Redeem Ops** (`REDEEM_OPS_ENABLED`, plus per-feature flags)
- `/api/redeem-ops/*` — partners, work/tasks, rewards, activations, fulfilment, discovery, cadences, analytics, admin

**Agents & identity**
- `/api/auth` (login, Google OAuth, invites, profile), `/api/users`
- `/api/agents`, `/api/admin/agent-groups`
- `/api/lyfe` (Lyfe agent sync), `/api/mktr-leads` (mktr-leads agent admin)
- `/api/admin/ai` — AI provider settings + generation

**Inbound integration webhooks** (raw-body HMAC-verified)
- `POST /api/retell/webhook`
- `POST /api/integrations/lyfe/lead-outcome` · `/users-webhook` · entitlement unlock
- `POST /api/whatsapp/webhook` (+ `GET` for Meta's subscribe handshake)
- `/api/external/*` — mktr-leads broker surfaces (wallet, billing, packages, held leads, lead activities/outcomes), each behind its own flag
- `/api/admin/webhooks` — outbound subscriber CRUD + delivery/DLQ admin

**Dashboards & ops**
- `/api/dashboard`, `/api/analytics`, `/api/notifications`, `/api/uploads`

**Health & docs**
- `GET /health` · `GET /health/public-host` (host-detection diagnostic) · `GET /health/sync` (per-adapter sync freshness)
- `GET /api-docs` — Swagger UI (non-production only)

`ENABLE_DOMAIN_PREFIXES=true` additionally mounts domain-namespaced mirrors (`/api/leadgen/*`, `/api/adtech/*`, `/api/admin/*`, `/api/fleet/*`).

---

## 🔐 Roles & access control

- Auth is **JWT** (Bearer token, also set in an httpOnly cookie). `optionalAuth` decodes the token early so the rate limiter can exempt admins.
- `requireRole(...roles)` gates routes; convenience guards: `requireAdmin`, `requireAgentOrAdmin`, `requireFleetOwnerOrAdmin`.
- Roles: **`admin`** (full console), **`agent`** (own leads/commissions), **`redeem_ops`** (Redeem Ops only — deliberately invisible to every `requireRole` gate, to agent-sync sweeps, and to lead routing), **`customer`**, plus the retired **`fleet_owner`** / **`driver_partner`**. New users default to `customer` / `approvalStatus: pending` and are held at `/PendingApproval` until approved.
- Redeem Ops layers a second axis: `users.redeemOpsRole` ∈ `super_admin | ops_admin | bdm | outreach_exec | campaign_ops | redemption_ops | analyst`, checked as capabilities in `middleware/redeemOpsAuth.js` (`role='admin'` is an implicit super-admin). Matrix: [`docs/redeem-ops/PERMISSION_MATRIX.md`](docs/redeem-ops/PERMISSION_MATRIX.md).
- On the SPA, `ProtectedRoute` enforces auth + role + approval, and `getDefaultRouteForRole()` lands each role on its home dashboard. On the `redeem` build, protected routes hard-redirect to `mktr.sg`.

---

## 💻 Local development

### Prerequisites
- **Node.js 18+** (CI uses 20) & npm
- **PostgreSQL 14+** (required — the backend refuses to start without `DB_HOST`; Docker is fine)

### 1. Install
```bash
git clone https://github.com/slzwei/mktr-platform.git
cd mktr-platform

npm install                 # frontend deps
cd backend && npm install   # backend deps
cd ..
```
(There is also a convenience [`setup-backend.sh`](setup-backend.sh).)

### 2. Configure
```bash
cp .env.example .env                 # frontend (VITE_*)
cp backend/env.example backend/.env  # backend (DB, JWT, integrations)
```
At minimum the backend needs `JWT_SECRET` and a reachable PostgreSQL database (`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`). Everything integration-related — Retell, Meta, TikTok, WhatsApp, Lyfe, mktr-leads, Redeem Ops, DNC — is **optional and off by default**; the app boots without any of it.

### 3. Run
```bash
# Terminal 1 — backend (http://localhost:3001, health at /health, docs at /api-docs)
cd backend
npm run dev        # nodemon

# Terminal 2 — frontend (http://localhost:5173)
npm run dev
```
Run the other surfaces locally with `VITE_BRAND=redeem npm run dev` (customer) or `VITE_SURFACE=ops npm run dev` (Redeem Ops).

The backend runs migrations automatically on boot (and, in `NODE_ENV=test`, force-syncs the schema first, then layers migrations on top).

---

## ⚙️ Environment variables

**Frontend (`.env`, build-time, all `VITE_`-prefixed):**

| Var | Purpose |
|---|---|
| `VITE_BRAND` | `mktr` (default) or `redeem` — selects the brand config + SEO files |
| `VITE_SURFACE` | `ops` builds the `ops.redeem.sg` route table instead of the normal one |
| `VITE_API_URL` | Backend base. Prod: `https://api.mktr.sg/api` (mktr) or `/api` (redeem/ops, via Render rewrite) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client (must match backend `GOOGLE_CLIENT_ID`) |
| `VITE_ADMIN_V2_ENABLED` | Swaps the admin URLs onto the Switchboard v2 screens |
| `VITE_REDEEM_MARKETPLACE_ENABLED` | Marketplace v2 routes on the redeem build (apex `/` included) |
| `VITE_MARKETPLACE_INHERIT_ENABLED` | Listings/featured tiles derive from the campaign page |
| `VITE_CAMPAIGN_WORKSPACE_ENABLED` | Campaign launch workspace as the campaign entry point |
| `VITE_REDEEM_OPS_ENABLED` / `VITE_REDEEM_OPS_CADENCES_ENABLED` / `VITE_DISCOVERY_ENABLED` | Redeem Ops route group, cadence authoring, Discover |
| `VITE_OPS_ORIGIN` | Where ops staff are sent to sign in (default `https://ops.redeem.sg`) |
| `VITE_META_PIXEL_ID` / `VITE_META_TEST_EVENT_CODE` | Browser Meta Pixel (public id; test code on staging only) |
| `VITE_TIKTOK_PIXEL_ID` / `VITE_TIKTOK_TEST_EVENT_CODE` | Browser TikTok Pixel |
| `VITE_SENTRY_DSN` · `VITE_GOOGLE_MAPS_API_KEY` · `VITE_MAX_UPLOAD_SIZE_MB` | Error tracking, maps, upload-size hint |
| `VITE_PAGE_TITLE` · `VITE_META_DESCRIPTION` · `VITE_FAVICON_SRC` · `VITE_CANONICAL_BASE` | Per-build SEO / chrome overrides |

**Backend (`backend/.env`):**

| Group | Vars |
|---|---|
| Core | `NODE_ENV`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `TRUST_PROXY` |
| Database | `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` (+ `DB_SSL`, `DB_CA_CERT` for managed providers) |
| Auth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Hosts | `CORS_ORIGIN`, `PUBLIC_BASE_URL` (QR-encoded host), `MKTR_FRONTEND_URL`, `REDEEM_FRONTEND_URL`, `API_PUBLIC_ORIGIN` |
| Rate limit | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` |
| Email | `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD`, `EMAIL_FROM_MKTR`, `EMAIL_FROM_REDEEM`, `UNSUB_TOKEN_SECRET` |
| Retell (capture) | `RETELL_WEBHOOK_SECRET`, `RETELL_API_KEY`, `RETELL_AGENTS`, `RETELL_CAMPAIGN_MAP` |
| Retell (screening) | `RETELL_SCREENING_ENABLED`, `RETELL_SCREENING_AGENT_ID`, `RETELL_SCREENING_FROM_NUMBER`, `SCREENING_*` (attempts, window, concurrency, TTL, alerts) |
| Webhooks | **`WEBHOOK_ENABLED`** (must be `"true"` to deliver leads), `LYFE_LEAD_SUPPRESSED_ENABLED`, `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED` |
| Lyfe | `LYFE_WEBHOOK_URL`, `LYFE_WEBHOOK_SECRET`, `LYFE_SUPABASE_URL`, `LYFE_SUPABASE_SERVICE_ROLE_KEY`, `LYFE_USERS_WEBHOOK_SECRET`, `LYFE_LEAD_OUTCOME_SECRET` |
| mktr-leads | `MKTR_LEADS_SUPABASE_URL`, `MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY`, `MKTR_LEADS_WEBHOOK_URL`, `MKTR_LEADS_WEBHOOK_SECRET`, `MKTR_LEADS_INVITE_SECRET` (all optional; unset = inert) |
| Meta CAPI | `META_CAPI_ENABLED`, `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE`, `META_EVENT_QUALIFIED`, `META_EVENT_WON` |
| TikTok | `TIKTOK_EVENTS_API_ENABLED`, `TIKTOK_PIXEL_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_TEST_EVENT_CODE` |
| OTP / SMS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SNS_SENDER_ID`, `SNS_AWS_*`, `SMS_DAILY_CAP_PER_PHONE`, `SMS_DAILY_GLOBAL_CAP`, `SMS_DAILY_ALERT_THRESHOLD`, `SMS_ALERT_EMAIL`, `SMS_QUOTA_SALT` |
| WhatsApp | `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN` (OTP); `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_*` (Redeem Ops sends — a **different** credential pair); `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WABA_ID` (status webhook) |
| Enrichment | `ENRICHMENT_MAP_ARTIFACT_JOBS` (artifact-scoped map jobs — flip only after migration 092 has fully rolled), `ENRICHMENT_SCORING_ENABLED` (the MEET × BUY sweep; off = no score is ever written, the ledger fills either way) |
| Campaign Studio | `DESIGN_CONFIG_V2_WRITES_ENABLED` (emergency brake on v2 writes) |
| Marketplace | `MARKETPLACE_PUBLIC_API_ENABLED`, `MARKETPLACE_INHERIT_ENABLED` |
| Redeem Ops | `REDEEM_OPS_ENABLED`, `REDEEM_OPS_ENTITLEMENTS_ENABLED`, `REDEEM_OPS_CADENCES_ENABLED`, `DISCOVERY_ENABLED`, `APIFY_TOKEN`, `DISCOVERY_CANDIDATE_TTL_DAYS`, `REDEEM_HOUSE_PARTNER_ORG_ID` |
| Draws | `DRAW_RECORD_AUTOCREATE_ENABLED`, `DRAW_BOOST_AUTOPROVISION_ENABLED`, `DRAW_BOOST_DEFAULT_ALLOCATION` |
| Wallet / billing | `AGENT_WALLET_ENABLED`, `BILLING_ENABLED`, `HELD_LEADS_EXTERNAL_ENABLED`, `AGENT_PACKAGES_EXTERNAL_ENABLED`, `ADMIN_PACKAGES_EXTERNAL_ENABLED`, `ADMIN_LEAD_OPS_EXTERNAL_ENABLED`, `LEAD_TIMELINE_EXTERNAL_ENABLED` |
| DNC | `DNC_API_ENABLED`, `DNC_BASE_URL`, `DNC_ORG_CODE`, `DNC_ESERVICE_ID`, `DNC_PRIVATE_KEY`, `DNC_ENFORCEMENT`, `DNC_HTTPS_PROXY`, `DNC_BACKFILL_*`, `DNC_HOURLY_BUDGET` |
| AI | `AI_SETTINGS_ENCRYPTION_KEY` (required for admin-entered keys); optional server-managed `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Storage | `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_REGION`, `DO_SPACES_ENDPOINT`, `DO_SPACES_BUCKET`, `DO_SPACES_CDN_BASE`, `MAX_UPLOAD_SIZE_MB` |
| System Agent | `SYSTEM_AGENT_EMAIL`, `SYSTEM_AGENT_REDIRECT_EMAIL`, `DEFAULT_AGENT_ID` |
| Attribution | `ATTRIB_SECRET`, `IP_HASH_SALT` (required in prod) |
| Crons | `SYNC_AGENT_CRON` (default on) |
| Observability | `SENTRY_DSN`, `OBS_SAMPLE_RATE` |

`backend/env.example` is the annotated, copy-pasteable starting point and carries the most detailed comments; `.env.example` covers the frontend. Neither is exhaustive — the table above, [`CLAUDE.md`](CLAUDE.md) and [`docs/reference/`](docs/reference/) are the fuller picture.

---

## 📜 Scripts

**Frontend (root `package.json`):**
```bash
npm run dev        # Vite dev server (see the brand/surface variants above)
npm run build      # production build → dist/
npm run preview    # preview the production build
npm run lint       # ESLint
npm run test       # Vitest (run once)   ·   npm run test:watch
npm run analyze    # build + bundle treemap (dist/stats.html)
```

**Backend (`backend/package.json`):**
```bash
npm run dev        # nodemon
npm start          # node src/server.js (production)
npm test           # Jest (set JWT_SECRET; some suites need local Postgres)
npm run migrate    # run migrations explicitly
npm run seed       # seed sample data
npm run load:smoke # local load harness (also :spike / :stress / :soak / :rr)
npm run docker:build / docker:run / docker:down
```

Also at the repo root: `scripts/campaignPageParity.mjs` (v1↔v2 campaign-page pixel-diff harness) and `scripts/studioSmoke.mjs` (headless Studio driver). A standalone lead-capture stress harness lives at `backend/stress-test.sh` ([`backend/STRESS-TEST-README.md`](backend/STRESS-TEST-README.md)).

---

## 🧪 Testing & CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs three jobs on Node 20 for every push and PR to `main`:

- **Backend Tests** — a Postgres 15 service container, then Jest in four passes: `test/unit/`, integration (`test/integration/` + top-level `test/*.test.js`), `test/migrations`, and a coverage run. `npm audit` runs non-blocking.
- **Frontend Tests** — Vitest with coverage, then a production `vite build`.
- **Lint** — ESLint over `src/` and `backend/src/`.

Locally:

- **Backend:** Jest + supertest (`backend/src/tests/`, `backend/test/`).
- **Frontend:** Vitest + Testing Library (`src/**/*.{test,spec}.{js,jsx}`), jsdom, v8 coverage.
- **E2E:** Playwright specs in `e2e/` ([`playwright.config.js`](playwright.config.js)).

> Some backend suites need a reachable Postgres and an inline `JWT_SECRET`; without them a handful fail on `ECONNREFUSED` — that's environmental, not a regression.

---

## 🚀 Deployment

Production runs on **Render** (Singapore region) as four services from this repo. Service IDs and DNS records are in [`docs/reference/brand-and-hosting.md`](docs/reference/brand-and-hosting.md).

- **`mktr-platform`** Static Site → `mktr.sg` (`VITE_BRAND=mktr`, absolute `VITE_API_URL=https://api.mktr.sg/api`).
- **`redeem-frontend`** Static Site → `redeem.sg` (`VITE_BRAND=redeem`, relative `VITE_API_URL=/api`; Render rewrites `/api/*` → `api.mktr.sg`).
- **`redeem-ops-frontend`** Static Site → `ops.redeem.sg` (`VITE_SURFACE=ops`; its Cloudflare CNAME must be **DNS-only**, not proxied).
- **`mktr-backend-jo6r`** Web Service → `api.mktr.sg` (the Express monolith). A `Dockerfile` + `docker-compose.yml` are also provided in `backend/`.

All three static sites proxy `/api/*` and `/uploads/*` to the single backend, so campaigns/agents/leads/round-robin have one source of truth regardless of which surface the traffic came from. The only redirect rule left on `mktr-platform` is the SPA fallback `/* → /index.html`, **which must stay last**.

**Pushing to `main` is not proof it shipped.** Services auto-deploy on commit, but two layers can hide a change: the GitHub→Render webhook occasionally never fires (confirm a new deploy appeared, else re-trigger with an empty commit or a manual deploy), and `mktr.sg` / `redeem.sg` are Cloudflare-fronted with `index.html` edge-cached `s-maxage=300`. To verify, curl the Render origin (bypasses the domain cache) or cache-bust the real domain and grep the live JS chunk for a string unique to your change. Full recipe in [`CLAUDE.md`](CLAUDE.md).

---

## 🧬 How the server boots

A deliberate **two-stage "Shell" boot** for resilience on Render:

1. **`server.js` (Shell)** — initializes Sentry, then *immediately* binds the port and serves `/health` (`mode: "shell"`) so the platform health check passes while the app is still loading. It then dynamically `import()`s `server_internal.js` and calls `init(app)`. If app initialization throws, the shell **stays listening** so logs remain reachable instead of crash-looping.
2. **`server_internal.js`** — builds the real middleware stack: `requestId` → Helmet → compression (skips SSE) → CORS (mktr.sg/redeem.sg allowlist) → rate limiter (prod only; admins and the HMAC server-to-server paths exempt) → `internalRouteHostGuard` → Pino HTTP logging → JSON/urlencoded body parsing, capturing the **raw body** for `/api/retell/`, `/api/integrations/lyfe/`, `/api/external/` and `/api/whatsapp/` → cookie-parser → `/uploads` static → health endpoints → Swagger (non-prod) → `leadCaptureBind` → **`loadRoutes()`** (auto-discovery) → `/t/:slug` fallback → `notFound` → Sentry → `errorHandler`.
3. **`bootstrapDatabase()`** — validates env, connects, runs migrations, then idempotently seeds runtime data: the **System Agent**, the **Lyfe** and **mktr-leads** webhook subscribers (reconciled from adapter env), and the **`[Retell]` campaigns**. It recovers pending webhook retries, reconciles suppression propagation, sweeps stale email broadcasts, and ensures draw records.

It then schedules the recurring in-process jobs (all skipped under `NODE_ENV=test`):

| Job | Interval |
|---|---|
| Webhook retry recovery | 60 s |
| Held-lead release sweep (no-op while auto-release is off) | 2 min |
| Screening sweep — stale calls, TTL, drains, due re-dials | `SCREENING_SWEEP_INTERVAL_MINUTES` (default 5 min) |
| Email-broadcast stale sweep | 5 min |
| Discover run reconcile (`DISCOVERY_ENABLED`) | 5 min, plus once ~45 s after boot |
| Agent sync — Lyfe then mktr-leads (`SYNC_AGENT_CRON`) | 10 min |
| Redeem Ops fulfilment sweep | 15 min |
| Redeem Ops stale sweep + cadence reconcile | 30 min |
| Idempotency-key purge · suppression-propagation backstop · draw-record backstop | hourly |
| Enrichment scoring sweep (`ENRICHMENT_SCORING_ENABLED`) — hourly tick, fenced to one real run per SGT date | hourly, first ~150 s after boot |
| Redemption CAPI reconciliation | 6 h |
| Redeemed-audience sync to Meta | `REDEEMED_AUDIENCE_SYNC_INTERVAL_HOURS` (default 24 h) |
| DNC backfill (`DNC_BACKFILL_ENABLED`) · Discover retention purge | `DNC_BACKFILL_INTERVAL_MINUTES` · daily |

> These are in-process timers, not a durable queue — a restart loses in-flight `setTimeout` retries. The 60 s webhook recovery poll mitigates but doesn't eliminate that.

---

## ⛔ Retired & frozen code

The **DOOH / fleet subsystem was retired on 2026-07-15** — fleet, devices, drivers, OTA APK hosting and commissions receive no development, and nothing new should be built for them. The code is still in the tree, so you will encounter it. Mount status: `provisioning.js` (`PROVISIONING_ENABLED`), `apk.js` (`APK_ENABLED`), `adtechManifest.js` (`MANIFEST_ENABLED`) and `adtechBeacons.js` (`BEACONS_ENABLED`) are each behind their own flag, **all default OFF** (an unset env var means the route does not mount); `devices.js`, `deviceEvents.js` (SSE), `vehicles.js`, `fleet.js` and `commissions.js` still mount unconditionally but every endpoint requires a JWT (admin/agent), pending deletion:

- **`tablet-app/`** — an Android (Kotlin/Jetpack Compose) DOOH player. Frozen since 2026-05-09; see [`tablet-app/PAUSED.md`](tablet-app/PAUSED.md).
- **Backend** — `apk.js`, `provisioning.js`, `adtechManifest.js`, `adtechBeacons.js`, `deviceEvents.js` (SSE), `devices.js`, `vehicles.js`, `fleet.js`, plus the fleet models listed under [Data model](#-data-model).
- **Frontend** — `AdminFleet`, `AdminFleetMap`, `AdminDevices`, `AdminDeviceLogs`, `AdminVehicles`, `AdminApkManager`, `ProvisionDevice`, `DriverDashboard`, `FleetOwnerDashboard`, `DriverPayslip`, `DriverPayoutHistory`, `AdminCommissions`. None of them appear in the admin v2 navigation.

**`services/` + `infra/`** are a microservices migration scaffold (`gateway` :4000, `auth-service` :4001, `leadgen-service`) with a docker-compose stack that was **never wired into production** — the live system is the `backend/` monolith. See [`services/PAUSED.md`](services/PAUSED.md); [`README-dev.md`](README-dev.md) keeps the scaffold's run instructions under a marked "paused" section. Nothing in the backend references it any more — the `leadgenProxyShim.js` middleware was deleted in PR #25 — so the scaffold can be removed on its own whenever the owner decides. The `ENABLE_DOMAIN_PREFIXES` flag is a leftover of the same effort but lives entirely inside the monolith.

Don't delete any of this without checking with the owner.

---

## 📚 Further documentation

- **[`CLAUDE.md`](CLAUDE.md)** — the authoritative architecture reference: two-brand internals, the Lyfe/Supabase contract, Meta Ads topology, deploy-verification recipe, and the pointer table into everything below.
- **[`TRACKER.md`](TRACKER.md)** — feature matrix, severity-ranked bug log, priority queue.
- **`docs/reference/`** — [`brand-and-hosting.md`](docs/reference/brand-and-hosting.md) (route lists, env tables, DNS, Render IDs), [`ads-and-tracking.md`](docs/reference/ads-and-tracking.md) (Meta/TikTok topology, CAPI, down-funnel), [`campaign-studio-rollout.md`](docs/reference/campaign-studio-rollout.md), [`webhook-propagation-contract.md`](docs/reference/webhook-propagation-contract.md), [`sms-sender-id-compliance.md`](docs/reference/sms-sender-id-compliance.md).
- **`docs/plans/`** — implementation plans & runbooks (Studio AI coverage, lucky draw, Retell screening, DNC, consent ledger, marketplace inheritance, WhatsApp delivery truth, the production lead-pipeline runbook).
- **`docs/redeem-ops/`** — Redeem Ops ERD, route map, permission matrix, domain ownership.
- **`docs/audit/`** — subsystem audits (auth, routes, manifest, beacons, leadgen, compose).
- **[`backend/README.md`](backend/README.md)** — backend-specific reference (boot model, route auto-discovery, API surface, env, testing).
- **[`README-dev.md`](README-dev.md)** — hands-on developer quickstart (running each surface, common tasks, hitting the API).
- **[`src/pages/redeemops/CLAUDE.md`](src/pages/redeemops/CLAUDE.md)** — the Redeem Ops frontend contract.

---

*MKTR PTE. LTD. (UEN 202507548M) · Singapore · Proprietary & Confidential.*
