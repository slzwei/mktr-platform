# Ads & Tracking Reference (Meta + TikTok)

> Extracted from `CLAUDE.md` 2026-07-15 to keep per-session context lean. This is
> lookup material — read it when doing ads / pixel / CAPI / audience work.
> Deep design docs: `docs/plans/meta-tracking-implementation.md`,
> `docs/plans/meta-redeemed-audience-sync.md`.

Paid acquisition (Facebook/Instagram + TikTok) drives clicks into the existing
`redeem.sg/LeadCapture?campaign_id={id}` round-robin pipeline. No native lead
forms on either platform — the funnel is always the landing page.

---

## Meta Ads — Advertising Account, Pixel & CAPI

All assets live under one Meta **business portfolio**. Topology verified 2026-06-04:

| Asset | ID | Notes |
|---|---|---|
| Business portfolio | `645399914612858` ("VoxaLabs AI") | Owns the ad account, Pixel, and Page below. |
| **Ad account — advertise from this** | `2170132703771607` ("MKTR", SGD) | `act_2170132703771607` for the Graph API. The only ad account the team should use. Payment method (MasterCard) attached. |
| Pixel / Dataset | `1402034528611431` ("MKTR Lead Capture") | Browser Pixel **+** CAPI, both live on `redeem.sg` and receiving events. Connected to the ad account. |
| Facebook Page | `1162230786970311` ("MKTR Campaigns") | The advertiser identity prospects see in-feed. |

**Gotcha — billing ID ≠ ad-account ID:** the MKTR ad account's **billing/payment-account ID is `6976122706429`**. It is the *same account* as `2170132703771607`, not a second one — it appears only in Billing-hub URLs, is **absent from the Ads Manager account picker**, and the Graph API returns `could not resolve ad account` for it. Always use `2170132703771607` in Ads Manager and the API.

**Ignore these accounts:** an empty portfolio "SG Health" (0 ad accounts), and the personal ad account `1931760067413088` ("Shawn Lee") — wrong identity for brand ads; don't attach the card or run campaigns there.

**Brand identity:** ads currently run as the "MKTR Campaigns" Page. Per the operator-vs-customer split, consider a **Redeem**-branded Page so consumer ads match the `redeem.sg` landing page. Link an Instagram professional account to the Page for IG placements.

### Tracking code

- `src/lib/metaPixel.js` — Pixel init + `ViewContent`/`Lead` with stable event IDs for Pixel⇄CAPI dedup; captures `_fbc` from `fbclid` and reads/synthesizes `_fbp` (`ensureFbp()` mints a first-party `_fbp` cookie when the Pixel hasn't set one yet, so server `Lead` events carry it). `shouldTrack` suppresses preview/demo/test-data routes and dev-without-test-code.
- `index.html` — base Pixel loader, gated on `VITE_META_PIXEL_ID`.
- `backend/src/services/metaCapiService.js` — fire-and-forget CAPI dispatch via the generic `sendConversionEvent(prospect, ctx, { eventName })` (thin wrappers `sendLeadEvent`/`sendCompleteRegistrationEvent`), gated by `shouldFireCapi` (skips Retell + Meta-Lead-Ads-origin prospects to avoid double-counting); per-campaign override via `Campaign.metaPixelId`, else `META_PIXEL_ID`. `ctx.eventTime` back-dates `event_time` for delayed down-funnel events (Meta accepts up to 7 days old).
- Full design: `docs/plans/meta-tracking-implementation.md`.

### Down-funnel CAPI events (reverse path — `ConfirmedResident` + `ClosedWon`)

Whether a lead is a Singapore Citizen/PR is only known in Lyfe, so the signal travels *back* from Lyfe to MKTR. In this funnel `qualified` = "agent CONFIRMED the lead is SC/PR" (the liar-proof version of the self-declared form gate); `won` = bought a policy (implies SC/PR). When an agent advances a lead's `status`, a Supabase trigger (`leads_notify_mktr_outcome`, reference SQL in `docs/plans/lyfe-leads-outcome-webhook.sql`, applied in the separate `lyfe-app` repo) HMAC-POSTs to **`POST /api/integrations/lyfe/lead-outcome`** (`backend/src/routes/lyfeLeadOutcome.js` + controller). Auth = HMAC-SHA256 over `timestamp + "." + rawBody` (timestamp signed → no replay) with a generous ≤7-day freshness window (matches CAPI; tolerates pg_net backlog). `backend/src/services/leadOutcomeService.js` looks up the prospect (`external_id === prospect.id`) and fires `ConfirmedResident` (on `qualified`, and on `won` if not already sent) + `ClosedWon` (on `won`) with deterministic `event_id`s (`confirmed_resident:{id}`/`closed_won:{id}`) back-dated to the status change. Reliability: **mark-on-success** (the `sourceMetadata.capi.{confirmedResidentAt|closedWonAt}` marker is written only after a confirmed send, so a failed send stays re-tryable), bounded transient retry, Meta `event_id` dedup as the concurrency guard, and `/api/integrations/lyfe/` exempt from the public rate limiter; a reconciliation backfill (fast-follow) is the at-least-once safety net for best-effort pg_net. Event names are env-overridable (`META_EVENT_QUALIFIED=ConfirmedResident`/`META_EVENT_WON=ClosedWon`; `won` can later become `Purchase`). Secret: `LYFE_LEAD_OUTCOME_SECRET`.

**Measure first** — keep optimizing on `Lead`; create a `ConfirmedResident` Custom Conversion per pixel, switch the ad set onto it once Meta-accepted with steady weekly volume (reachable sooner than a rare event since confirmed-resident volume ≈ real-lead volume; enforce a 24–72h confirmation SLA so events land in the 7-day click window), then seed a Singapore Lookalike from `ConfirmedResident` at ~100. There is no negative/"NotPR" Meta signal — the positive `ConfirmedResident` event + Lookalike is the lever.

### Meta env vars

(pixel/page IDs are public — embedded in page source; the access token is the only secret)

| Var | Component | Value / Notes |
|---|---|---|
| `VITE_META_PIXEL_ID` | Frontend build | `1402034528611431` |
| `META_PIXEL_ID` | Backend (CAPI) | `1402034528611431` |
| `META_CAPI_ENABLED` | Backend | Must be `"true"` to fire CAPI |
| `META_CAPI_ACCESS_TOKEN` | Backend | **Secret** — Pino-redacted, never commit |
| `META_TEST_EVENT_CODE` / `VITE_META_TEST_EVENT_CODE` | Both | Routes events to Test Events (staging/dev) |

`redeem.sg` is domain-verified in Meta (see the `facebook-domain-verification` TXT in `docs/reference/brand-and-hosting.md`).

### Running a paid campaign

Objective **Leads** (`OUTCOME_LEADS`), conversion location **Website**, optimize for the **Lead** event; destination = a `redeem.sg/LeadCapture?campaign_id={id}` link for the specific MKTR campaign so leads attribute + auto-assign.

### Lead-quality controls

The `$20 voucher` hook attracts low-intent/freebie traffic, so two layers filter it:

- **Per-campaign SG/PR gate** — `design_config.sgPrOnly` (shipped `622fd2e`). When on, `CampaignSignupForm.jsx` renders a Yes/No "Singapore Citizen or PR?" screening card before the form ("No" blocks); toggle it in the campaign designer's **Content** panel. It is **client-side and self-declared** (the answer is not POSTed to the backend): it deters honest non-residents and — because the Pixel `Lead` event only fires on a completed submit — keeps unqualified people out of CAPI + Meta's conversion optimization, but won't stop a motivated false answer.
- **Meta-side audience filters** (ad-account config, not in this repo): Meta offers no occupation/citizenship targeting, so the ad set instead targets **"people who live in Singapore"** (`geo_locations.location_types:["home"]`, not the default "everyone in this location"), bounds age, and **excludes a customer-list Custom Audience** of known industry contacts/advisors (plus a lookalike of it). Under **Advantage+ Audience**, excluded custom audiences are the *only* hard filter Meta honors — interest/inclusion targeting is treated as a suggestion. Specific audience IDs live in the ad account.

### Meta Customer-List "Redeemed" exclusion sync (`redeemedAudienceService`)

The pixel-based "Already redeemed (Lead)" audience (`6981883288829`, subtype PLATFORM) under-captures — it only holds people whose **browser pixel fired AND matched an account** (~20 of ~50 real redeemers in the $10+$20 campaigns), so repeat-redeemers (e.g. the 4 phones incl. `+6596176848` that redeemed in **both** campaigns) slipped into the next campaign despite the exclusion. Fix: a **hashed customer-list** audience synced from our own `prospects` table, used as a *second* ad-set exclusion alongside the pixel one (browser-tag-independent; matches on email **and** phone).

- **Audience:** `52506028688033` "Already redeemed (customer list) — exclude" (subtype CUSTOM, `customer_file_source=USER_PROVIDED_ONLY`) on `act_2170132703771607`. Seeded manually 2026-06-22 with **49 consenting redeemers** (raw email+phone hashed via the Meta MCP; `num_invalid_entries:0`), attached as an **Exclusion** (with the advisor list) on the live **$10** ad set `52503146294833` in Ads Manager. The $20 campaign/ad set is PAUSED.
- **Code:** `backend/src/services/redeemedAudienceService.js` — select non-`call_bot` prospects → consent-gate → hash email+phone via `piiHashing` → batch ≤10k → `POST /{audience_id}/users` with an `Authorization: Bearer` header (never `?access_token=`). 21 unit tests: `test/redeemedAudienceService.test.js`. Shared `backend/src/utils/sentryInit.js` (extracted from `server.js`) gives any entrypoint PII-scrubbed Sentry.
- **Schedule = IN-PROCESS (not a Render cron):** `backend/src/database/bootstrap.js` runs the sync inside the single-instance backend (gated by `REDEEMED_AUDIENCE_SYNC_ENABLED`; initial run ~60s after boot + every `REDEEMED_AUDIENCE_SYNC_INTERVAL_HOURS`, default 24). Chosen over a separate Render Cron Job because the Render MCP can't create Docker cron jobs **and** a standalone cron would have to duplicate the backend's `DB_*` secrets — in-process inherits DB + Meta creds for free, and the job is idempotent + single-instance so there's no double-fire. `backend/scripts/sync-redeemed-audience.js` + the `RUN_MODE=cron-redeemed-audience` entrypoint branch remain for manual/ad-hoc runs.
- **Mode:** `REDEEMED_AUDIENCE_SYNC_MODE=add` (additive `/users`, **verified**) by default; `replace` → `/usersreplace` (authoritative full replace — handles removals/PDPA-erasure) is **PROBE-PENDING** (its exact contract wasn't primary-verifiable; confirm against the live API before switching the default). Additive is safe for a suppression list: nightly re-ADD is idempotent at the person level and refreshes retention.
- **Env (backend):** `REDEEMED_AUDIENCE_SYNC_ENABLED` (master switch, default `false`), `META_ADS_MANAGEMENT_TOKEN` (System User token w/ `ads_management` — already on Render; NOT the CAPI or Page token), `META_REDEEMED_AUDIENCE_ID=52506028688033`, `REDEEMED_AUDIENCE_REQUIRE_CONSENT` (default `true`), `META_AD_ACCOUNT_ID` (create/probe only — the sync is audience-scoped). Graph version via the shared `META_GRAPH_API_VERSION` (default `v21.0`).
- **Deploy status (2026-06-22):** code in **PR #56** (`feat/redeemed-audience-sync` → main). Config env staged on `mktr-backend-jo6r` (`srv-d2s9p0emcj7s73acd9lg`) via the Render MCP. **On merge → Render auto-deploys → the in-process scheduler activates**; verify via `mktr-backend-jo6r` logs (`redeemed_audience.sync.done`). Full design: `docs/plans/meta-redeemed-audience-sync.md`.
- **Caveats:** match-rate ceiling (email/phone that don't map to a Meta account stay unmatched), small audience applies less reliably, freshness lag = sync interval + Meta processing. Does **not** stop re-redemption via form/QR/shared link (needs a submit-time repeat-redeemer block — future Phase 2) or TikTok (needs its own customer-file list — Phase 3).

---

## TikTok Ads — Pixel & Events API

The TikTok counterpart of the Meta funnel — a browser **Pixel** (`ttq`) plus a server-side **Events API** (TikTok's CAPI equivalent). Built for the quiz/lead-capture funnel and **live in production** (shipped via PRs **#21** quiz-funnel + tracking and **#22** audit fixes; migration `034-add-campaign-tiktok-pixel-id.js` applied 2026-06-04). Deliberately mirrors `metaPixel.js` / `metaCapiService.js` so the two platforms behave identically (stable shared `event_id` → Pixel⇄server dedup, consent-gated PII, origin-gated dispatch).

**Pixel:** TikTok pixel code `D8GJ6T3C77UDLID6746G`. Browser Pixel **+** Events API, both receiving events. (The TikTok ad-account / Business Center topology is not yet documented here — only the pixel + code path is confirmed.)

### Tracking code

- `index.html` — `ttq` base stub, gated on `VITE_TIKTOK_PIXEL_ID` (defines the queue + `ttq.load` injector but does NOT call `ttq.load()`/`ttq.page()`; the guard `PIXEL_ID.charAt(0)==='%'` no-ops cleanly when the var is unset, so an unset host shows no broken pixel).
- `src/lib/tiktokPixel.js` — `initTikTokPixel` (injects the SDK only on the live `/LeadCapture` page), `ViewContent` / `CompleteRegistration` / `Lead` trackers carrying the stable `event_id` for Pixel⇄Events-API dedup; `captureTtclidFromUrl` (persists `ttclid`), `readTtp` (reads the `_ttp` cookie). Suppression via shared `src/lib/pixelSuppression.js` (`isTrackableLeadCapture`, kept in lock-step with the Meta pixel).
- `backend/src/services/tiktokEventsService.js` — fire-and-forget `sendConversionEvent` (wrappers `sendTikTokLeadEvent` / `sendTikTokCompleteRegistrationEvent`) → `POST business-api.tiktok.com/open_api/v1.3/event/track/`. Guard `shouldFireTikTok` skips Retell + Meta-Lead-Ads-origin prospects (mirrors `shouldFireCapi`). Hashed email/phone/external_id via `backend/src/utils/piiHashing.js` — email/phone only with marketing consent (`sourceMetadata.consent_contact === true`); `ttclid`/`ttp`/ip/ua always sent. TikTok returns HTTP 200 with a non-zero `code` on logical failure, so success requires `res.ok && body.code === 0` (logged as `tiktok.lead.sent` / `tiktok.complete_registration.sent`).
- Wiring: `prospectService.js` fires both senders post-commit alongside the Meta senders, with `pixelIdOverride: sourceCampaign?.tiktokPixelId`; `prospectController.js` threads `ttclid`/`ttp` from `req.body`. Per-campaign override = `Campaign.tiktokPixelId` (column `tiktok_pixel_id`, migration 034), else the env pixel id.

### TikTok env vars

(pixel id is public — embedded in page source; the access token is the only secret)

| Var | Component | Value / Notes |
|---|---|---|
| `VITE_TIKTOK_PIXEL_ID` | Frontend build (both static sites) | `D8GJ6T3C77UDLID6746G` — on `redeem-frontend` and (2026-06-17) `mktr-platform` |
| `TIKTOK_PIXEL_ID` | Backend (Events API) | `D8GJ6T3C77UDLID6746G` — per-campaign `Campaign.tiktokPixelId` overrides |
| `TIKTOK_ACCESS_TOKEN` | Backend | **Secret** — never commit |
| `TIKTOK_EVENTS_API_ENABLED` | Backend | Must be `"true"` to dispatch |
| `TIKTOK_TEST_EVENT_CODE` / `VITE_TIKTOK_TEST_EVENT_CODE` | Both | Routes events to Test Events (staging/dev) |

**Live status (verified 2026-06-17):** browser Pixel live on **redeem.sg** and **mktr.sg** (both static sites bake `VITE_TIKTOK_PIXEL_ID`); backend Events API firing `Lead` + `CompleteRegistration` successfully — `tiktok.lead.sent` appears continuously in `mktr-backend-jo6r` Render logs (2026-06-04 → 2026-06-16). Note: `.env.example` ships `TIKTOK_EVENTS_API_ENABLED=false` + blank ids — that is the example default, NOT prod state; check the live deploy/logs.

**TODO:** add TikTok's **domain verification** for `redeem.sg` in TikTok Events Manager (the Meta `facebook-domain-verification` TXT is already present; TikTok needs its own record). Not required for the Events API to fire, but it improves pixel attribution / event match quality.
