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

### Per-campaign customer domain (redeem.sg ↔ mktr.sg) — shipped 2026-06-17

Customer-facing surfaces default to **redeem.sg**, but a campaign can opt into **mktr.sg** per-campaign via the **Customer domain** toggle in the campaign designer (Content panel), stored as `design_config.customerHost ∈ {redeem, mktr}` (default `redeem`). Choosing `mktr.sg` intentionally shows the MKTR (operator) brand to the customer — page chrome, regulatory copy, Pixel, and the confirmation email all follow the host.

**The old mktr.sg→redeem.sg lead-capture 301 redirects were REMOVED** (Render dashboard, 2026-06-17) so `mktr.sg` now serves the SPA for `/LeadCapture`, `/t/*`, `/p/*`, `/share/*` directly. The only redirect/rewrite rule left on `mktr-platform` is the SPA fallback `/* → /index.html` (must stay last). Removing them is safe for redeem campaigns (they still emit redeem.sg links by default) — it just stops force-bouncing mktr.sg lead-capture traffic so the per-campaign option works.

> Historical: during the 2026-05 cutover those 5 lead-capture paths 301'd to redeem.sg as a safety net, and 7 marketing/apex redirects (`/Homepage`, `/Contact`, `/features`, `/pricing`, `/about`, `/personal-data-policy`, `/`) were removed. `mktr.sg` keeps its marketing pages and admin surfaces.

### Brand isolation in the bundle

`vite.config.js` reads `VITE_BRAND` at config time and aliases `@brand-config` to either `src/lib/brandConfigs/mktr.js` or `src/lib/brandConfigs/redeem.js`. Components import `brand` from `@/lib/brand`, which re-exports the active brand's config. Result: the inactive brand's strings (wordmark, regulatory copy, consumer line, etc.) are not bundled into dist. Acceptance test: `grep MKTR dist/` on the redeem build returns only intentional D3 legal-entity references (`MKTR PTE. LTD.`, the legal data controller).

Brand-aware values include: `name`, `wordmark`, `legalName`, `uen`, `consumerLine`, `logoSrc`/`logoDarkSrc`/`logoIconSrc`/`faviconSrc`, `pageTitle`, `pdpaUrl`, `publicHost`, `defaultRegulatory`, `defaultPoweredBy`, `partnersTerm`, `pdpaAbsoluteUrl`, `consentEntityClause`, plus the `show*` route gates (`showHomepage`, `showAbout`, `showFeatures`, `showPricing`).

### Customer-facing URL helpers (host-aware; default redeem.sg)

`src/lib/brand.js` defines `resolveCustomerHost(choice)` which maps a campaign's stored enum CHOICE (`'redeem'` | `'mktr'`) to a HOST (`redeem.sg` | `mktr.sg`), defaulting to `redeem.sg` for any missing/unknown value. The customer-facing helpers take an **optional `host`** (last arg, default `redeem.sg`), so admin-side surfaces emit the campaign's chosen host with no redirect hop. Keep the enum-choice and the hostname strictly separate — never pass a raw hostname from campaign JSON into a helper.

| Helper | Returns |
|---|---|
| `resolveCustomerHost(choice)` | `'redeem.sg'` \| `'mktr.sg'` (default `redeem.sg`) |
| `customerPublicUrl(path, host?)` | `https://{host}{path}` (host defaults to redeem.sg) |
| `customerLeadCaptureUrl(campaignId, extraParams?, host?)` | `https://{host}/LeadCapture?campaign_id={id}&...` |
| `customerPreviewUrl(slug, host?)` | `https://{host}/p/{slug}` |
| `publicTrackingUrl(slug, host?)` | `https://{host}/t/{slug}` (via `customerPublicUrl`) |
| `publicShareUrl(slug, host?)` | `https://{host}/share/{slug}` |
| `publicUrl(path)` | `https://{brand.publicHost}{path}` — brand-self-referential; for canonical, SEO, robots/sitemap only |

Callers pass `resolveCustomerHost(campaign.design_config?.customerHost)`: `AdminCampaigns.handleCopyLink` (both the dropdown + grid Copy Link sites), `AdminCampaignDesigner.handlePreview` (from the *saved* campaign), `PreviewFrame` chrome (from live editor state). The QR admin tables (`CarQRTable`, `ExistingQRCodes`, `PromotionalQRTable`) pass `resolveCustomerHost(qr.targetHost)` — the host baked into that QR image. Customer-side surfaces (`LeadCapture.longShareUrl`, `ShareCampaignDialog`) use `window.location.origin` and are correct on whichever host served them.

**QR generation (backend):** `qrCodeService` bakes the campaign's host into the QR image at create/regenerate time and records it on `QrTag.targetHost` (enum `redeem`|`mktr`, nullable → legacy treated as redeem; migration `037-add-qrtag-target-host.js`, existing rows backfilled to `redeem`). `backend/src/utils/customerHost.js` provides `normalizeCustomerHostChoice()` (enum clamp — the security boundary, never trusts a raw host) and `customerHostOrigin(choice)` (→ `PUBLIC_BASE_URL` for redeem/default, `MKTR_FRONTEND_URL`/`https://mktr.sg` for mktr). `campaignService.updateCampaign` clamps `design_config.customerHost` to the enum on save; the bulk-QR update path excludes `campaignId`/`targetHost`/`slug`/`qrCode`/`qrImageUrl` so host can't be mass-mutated without regeneration.

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
- **`mailer.js`** — `resolveEmailFrom(context)` and `sendEmail({..., context, from})` allow per-flow sender selection. `EMAIL_FROM_MKTR` / `EMAIL_FROM_REDEEM` env vars override the default `EMAIL_FROM`. `sendLeadConfirmationEmail` fires fire-and-forget on every lead-capture submit (`prospectController.js`; synthetic `@calls.mktr.sg` Retell emails are skipped) and **brands by the campaign's `design_config.customerHost`**: a redeem campaign sends Redeem copy/header/footer with `context:'redeem'` (→ `noreply@redeem.sg`); an mktr campaign sends MKTR branding with `context:'mktr'` (→ `EMAIL_FROM_MKTR` = `noreply@mktr.sg`). `prospectService` loads the campaign's `design_config` for every prospect so the brand is available to the email.

### Backend env vars set in production

| Env var | Value | Purpose |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://redeem.sg` | **Default** host baked into QR images (redeem + unbound QRs encode `redeem.sg/t/{slug}`). Per-campaign mktr QRs use `MKTR_FRONTEND_URL` instead, via `customerHostOrigin()`. Also used by APK download URL display (admin-side cosmetic). |
| `MKTR_FRONTEND_URL` | `https://mktr.sg` | Per-host redirect destination for mktr.sg traffic. Falls back to `FRONTEND_BASE_URL`. |
| `REDEEM_FRONTEND_URL` | `https://redeem.sg` | Per-host redirect destination for redeem.sg traffic. |
| `CORS_ORIGIN` | `…mktr-platform.onrender.com,…redeem-frontend.onrender.com` | Adds preview hostnames for staging. Code defaults already include the four apex+www hosts. |
| `EMAIL_FROM_MKTR` | `noreply@mktr.sg` (set 2026-06-17) | From-address for ALL MKTR-context emails — the customer confirmation on mktr campaigns AND agent/admin notifications (lead/package assignments). First in the from-address resolution chain (ahead of `EMAIL_FROM` / `EMAIL_USER`); set explicitly so the sender isn't the SMTP login `admin@mktr.sg`. |
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
- Both static sites bake the public pixel IDs at build time: `VITE_META_PIXEL_ID=1402034528611431` and `VITE_TIKTOK_PIXEL_ID=D8GJ6T3C77UDLID6746G` (TikTok added to `mktr-platform`/mktr.sg on 2026-06-17 to match redeem.sg). `VITE_*` vars are baked into `dist` at build, so changing a pixel id requires a redeploy.

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

### Meta Customer-List "Redeemed" exclusion sync (`redeemedAudienceService`)

The pixel-based "Already redeemed (Lead)" audience (`6981883288829`, subtype PLATFORM) under-captures — it only holds people whose **browser pixel fired AND matched an account** (~20 of ~50 real redeemers in the $10+$20 campaigns), so repeat-redeemers (e.g. the 4 phones incl. `+6596176848` that redeemed in **both** campaigns) slipped into the next campaign despite the exclusion. Fix: a **hashed customer-list** audience synced from our own `prospects` table, used as a *second* ad-set exclusion alongside the pixel one (browser-tag-independent; matches on email **and** phone).

- **Audience:** `52506028688033` "Already redeemed (customer list) — exclude" (subtype CUSTOM, `customer_file_source=USER_PROVIDED_ONLY`) on `act_2170132703771607`. Seeded manually 2026-06-22 with **49 consenting redeemers** (raw email+phone hashed via the Meta MCP; `num_invalid_entries:0`), attached as an **Exclusion** (with the advisor list) on the live **$10** ad set `52503146294833` in Ads Manager. The $20 campaign/ad set is PAUSED.
- **Code:** `backend/src/services/redeemedAudienceService.js` — select non-`call_bot` prospects → consent-gate → hash email+phone via `piiHashing` → batch ≤10k → `POST /{audience_id}/users` with an `Authorization: Bearer` header (never `?access_token=`). 21 unit tests: `test/redeemedAudienceService.test.js`. Shared `backend/src/utils/sentryInit.js` (extracted from `server.js`) gives any entrypoint PII-scrubbed Sentry.
- **Schedule = IN-PROCESS (not a Render cron):** `backend/src/database/bootstrap.js` runs the sync inside the single-instance backend (gated by `REDEEMED_AUDIENCE_SYNC_ENABLED`; initial run ~60s after boot + every `REDEEMED_AUDIENCE_SYNC_INTERVAL_HOURS`, default 24). Chosen over a separate Render Cron Job because the Render MCP can't create Docker cron jobs **and** a standalone cron would have to duplicate the backend's `DB_*` secrets — in-process inherits DB + Meta creds for free, and the job is idempotent + single-instance so there's no double-fire. `backend/scripts/sync-redeemed-audience.js` + the `RUN_MODE=cron-redeemed-audience` entrypoint branch remain for manual/ad-hoc runs.
- **Mode:** `REDEEMED_AUDIENCE_SYNC_MODE=add` (additive `/users`, **verified**) by default; `replace` → `/usersreplace` (authoritative full replace — handles removals/PDPA-erasure) is **PROBE-PENDING** (its exact contract wasn't primary-verifiable; confirm against the live API before switching the default). Additive is safe for a suppression list: nightly re-ADD is idempotent at the person level and refreshes retention.
- **Env (backend):** `REDEEMED_AUDIENCE_SYNC_ENABLED` (master switch, default `false`), `META_ADS_MANAGEMENT_TOKEN` (System User token w/ `ads_management` — already on Render; NOT the CAPI or Page token), `META_REDEEMED_AUDIENCE_ID=52506028688033`, `REDEEMED_AUDIENCE_REQUIRE_CONSENT` (default `true`), `META_AD_ACCOUNT_ID` (create/probe only — the sync is audience-scoped). Graph version via the shared `META_GRAPH_API_VERSION` (default `v21.0`).
- **Deploy status (2026-06-22):** code in **PR #56** (`feat/redeemed-audience-sync` → main). Config env staged on `mktr-backend-jo6r` (`srv-d2s9p0emcj7s73acd9lg`) via the Render MCP (`META_REDEEMED_AUDIENCE_ID=52506028688033`, `META_AD_ACCOUNT_ID`, `REDEEMED_AUDIENCE_SYNC_MODE=add`, `REDEEMED_AUDIENCE_REQUIRE_CONSENT=true`, `REDEEMED_AUDIENCE_SYNC_ENABLED=true`; `META_ADS_MANAGEMENT_TOKEN` already present). **On merge → Render auto-deploys → the in-process scheduler activates**; verify via `mktr-backend-jo6r` logs (`redeemed_audience.sync.done`). Full design: `docs/plans/meta-redeemed-audience-sync.md`.
- **Caveats:** match-rate ceiling (email/phone that don't map to a Meta account stay unmatched), small audience applies less reliably, freshness lag = sync interval + Meta processing. Does **not** stop re-redemption via form/QR/shared link (needs a submit-time repeat-redeemer block — future Phase 2) or TikTok (needs its own customer-file list — Phase 3).

## TikTok Ads — Pixel & Events API

The TikTok counterpart of the Meta funnel above — a browser **Pixel** (`ttq`) plus a server-side **Events API** (TikTok's CAPI equivalent). Built for the quiz/lead-capture funnel and **live in production** (shipped via PRs **#21** quiz-funnel + tracking and **#22** audit fixes; migration `034-add-campaign-tiktok-pixel-id.js` applied 2026-06-04). Deliberately mirrors `metaPixel.js` / `metaCapiService.js` so the two platforms behave identically (stable shared `event_id` → Pixel⇄server dedup, consent-gated PII, origin-gated dispatch).

**Pixel:** TikTok pixel code `D8GJ6T3C77UDLID6746G`. Browser Pixel **+** Events API, both receiving events. (The TikTok ad-account / Business Center topology is not yet documented here — only the pixel + code path is confirmed.)

**Tracking code:**
- `index.html` — `ttq` base stub, gated on `VITE_TIKTOK_PIXEL_ID` (defines the queue + `ttq.load` injector but does NOT call `ttq.load()`/`ttq.page()`; the guard `PIXEL_ID.charAt(0)==='%'` no-ops cleanly when the var is unset, so an unset host shows no broken pixel).
- `src/lib/tiktokPixel.js` — `initTikTokPixel` (injects the SDK only on the live `/LeadCapture` page), `ViewContent` / `CompleteRegistration` / `Lead` trackers carrying the stable `event_id` for Pixel⇄Events-API dedup; `captureTtclidFromUrl` (persists `ttclid`), `readTtp` (reads the `_ttp` cookie). Suppression via shared `src/lib/pixelSuppression.js` (`isTrackableLeadCapture`, kept in lock-step with the Meta pixel).
- `backend/src/services/tiktokEventsService.js` — fire-and-forget `sendConversionEvent` (wrappers `sendTikTokLeadEvent` / `sendTikTokCompleteRegistrationEvent`) → `POST business-api.tiktok.com/open_api/v1.3/event/track/`. Guard `shouldFireTikTok` skips Retell + Meta-Lead-Ads-origin prospects (mirrors `shouldFireCapi`). Hashed email/phone/external_id via `backend/src/utils/piiHashing.js` — email/phone only with marketing consent (`sourceMetadata.consent_contact === true`); `ttclid`/`ttp`/ip/ua always sent. TikTok returns HTTP 200 with a non-zero `code` on logical failure, so success requires `res.ok && body.code === 0` (logged as `tiktok.lead.sent` / `tiktok.complete_registration.sent`).
- Wiring: `prospectService.js` fires both senders post-commit alongside the Meta senders, with `pixelIdOverride: sourceCampaign?.tiktokPixelId`; `prospectController.js` threads `ttclid`/`ttp` from `req.body`. Per-campaign override = `Campaign.tiktokPixelId` (column `tiktok_pixel_id`, migration 034), else the env pixel id.

**Env vars** (pixel id is public — embedded in page source; the access token is the only secret):

| Var | Component | Value / Notes |
|---|---|---|
| `VITE_TIKTOK_PIXEL_ID` | Frontend build (both static sites) | `D8GJ6T3C77UDLID6746G` — on `redeem-frontend` and (2026-06-17) `mktr-platform` |
| `TIKTOK_PIXEL_ID` | Backend (Events API) | `D8GJ6T3C77UDLID6746G` — per-campaign `Campaign.tiktokPixelId` overrides |
| `TIKTOK_ACCESS_TOKEN` | Backend | **Secret** — never commit |
| `TIKTOK_EVENTS_API_ENABLED` | Backend | Must be `"true"` to dispatch |
| `TIKTOK_TEST_EVENT_CODE` / `VITE_TIKTOK_TEST_EVENT_CODE` | Both | Routes events to Test Events (staging/dev) |

**Live status (verified 2026-06-17):** browser Pixel live on **redeem.sg** and **mktr.sg** (both static sites bake `VITE_TIKTOK_PIXEL_ID`); backend Events API firing `Lead` + `CompleteRegistration` successfully — `tiktok.lead.sent` appears continuously in `mktr-backend-jo6r` Render logs (2026-06-04 → 2026-06-16). Note: `.env.example` ships `TIKTOK_EVENTS_API_ENABLED=false` + blank ids — that is the example default, NOT prod state; check the live deploy/logs.

**TODO:** add TikTok's **domain verification** for `redeem.sg` in TikTok Events Manager (the Meta `facebook-domain-verification` TXT is already present in the DNS section; TikTok needs its own record). Not required for the Events API to fire, but it improves pixel attribution / event match quality. No native TikTok lead forms — same `redeem.sg/LeadCapture?campaign_id={id}` landing-page funnel as Meta; optimize the ad for the `Lead` event.

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
