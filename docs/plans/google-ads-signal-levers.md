# Google Ads signal levers — Enhanced Conversions, exclusion audiences, offline outcomes, audience signal

**Status:** PLANNED v8 — **PASSED Codex round 8 (no findings)**; rounds 1–7 logged in §10. Ready to implement.
**Prereq state:** browser tag LIVE since #457 / 2026-08-12 (`AW-18385034255`, lead label `rbiQCMf8q-AcEI-41b5E`, proven firing on `/flow/*`). Demand Gen campaign built PAUSED (draft 10209636999), awaiting identity verification + Enable.
**Owner refs:** account `182-916-3947` (admin@mktr.sg), customer id for API destinations `1829163947`.

## 0. What this plan is

PR #457 shipped the deliberate "just enough to start spending" tier: browser
conversion tag only. This plan scopes the deferred server/account-side levers,
as independently shippable phases, each env-gated and shipping dark (same
discipline as #457).

**Architecture constraint that shaped v2 (verified against live Google docs
2026-08-18):** the classic Google Ads API upload surfaces are CLOSED to new
integrations — *"Since April 1, 2026, OfflineUserDataJobService and
UserDataService requests for Customer Match fail if the developer token hasn't
previously sent requests for Customer Match"* and *"Starting June 15, 2026,
UploadClickConversion requests will fail if the developer token hasn't
previously sent requests to upload offline conversions or enhanced conversions
for leads."* MKTR has no developer token, so it cannot be grandfathered. All
server-side upload work targets the **Data Manager API**: no developer token,
no MCC.

| Phase | Lever | Surface | Depends on | Size |
|---|---|---|---|---|
| 1 | Enhanced Conversions (user-provided data on the browser conversion) | Frontend + account setup | nothing | ~½ day |
| 0 | Data Manager API access (OAuth only) | Ops + one bootstrap script | nothing | ~¼ day |
| 2a | Meta customer-list sync — population audit, then env flip | Audit + env | Shawn decision (§7.2) | ~½ day audit |
| 2b | Google Customer Match exclusion list (Data Manager ingest) | Backend service + ops | Phase 0 | ~1.5 days |
| 3 | Offline outcome upload (ConfirmedResident/ClosedWon) + click-id capture | Backend + small frontend | Phase 0 | ~3 days |
| 4 | First-party audience signal | Ops only | tag traffic | ~30 min |

**Non-goals:** GA4 linkage; bidding-strategy changes (ops, not code); Consent
Mode v2 (decision recorded in §1); score-weighted conversion values (cut —
§4.2); a durable outcome outbox table (deliberately deferred — §4.3). The
Meta/TikTok dispatch paths keep their behavior, with ONE mechanical exception
now in scope (rounds 3–4, §10): every non-erasure whole-object
`sourceMetadata` writer converts to the atomic JSON write helper Phase 3
introduces — write-style only, zero behavior change, required because any
surviving read-spread-save site can silently delete the new keys (§4.3).

## 1. Phase 1 — Enhanced Conversions on the browser tag

**What it buys:** Google matches user-provided data (auto-normalized and
SHA-256-hashed by the tag itself — no client-side hashing code) against
signed-in users and recovers conversions that cookie loss would otherwise
drop. On a brand-new low-volume account every recovered conversion
accelerates Smart Bidding's learning phase. Highest value-per-effort lever.

### Frontend changes

- **`src/lib/googleAds.js`** — new exports:
  - `toE164Sg(phone)` — **idempotent** E.164 normalizer, because the two
    funnels submit different shapes: the marketplace flow holds the 8-digit
    local number (`+65` separate), while the classic funnel's
    `CampaignSignupForm` already submits E.164 (`getFullPhoneNumber()` =
    `` `+65${formData.phone}` ``, `CampaignSignupForm.jsx:128`) which
    `LeadCapture` forwards. Naive `+65${digits}` would double-prefix the
    classic path (`+6565…`). Rule: strip non-digits; 10 digits starting `65`
    → `+` + digits; 8 digits starting 8/9 → `+65` + digits; anything else →
    `undefined` (skip the field, never send a malformed hash input).
  - `setGoogleUserData({ email, phone })` — builds
    `{ email, phone_number: toE164Sg(phone) }`, drops empty fields, calls
    `gtag('set', 'user_data', ...)`. No-op if both empty or `gtag` missing.
  - `clearGoogleUserData()` — sets `user_data` to `null`. **Required after
    every conversion**: `gtag('set')` applies to all subsequent events on the
    page, so without the clear, later SPA tag events inherit the submitter's
    PII. Test asserts a post-conversion event carries no `user_data`.
  - Gated by `VITE_GOOGLE_ADS_EC_ENABLED === 'true'` (ship-dark flag,
    greppable in the lazy chunk for deploy verification).
- **`src/pages/marketplace/MarketplaceFlow.jsx`** + **`src/pages/LeadCapture.jsx`** —
  in the existing `shouldTrackGoogle` block of the submit-success handler:
  `setGoogleUserData(...)` → `trackGoogleLead(...)` → `clearGoogleUserData()`.
  (`set` must precede the event to ride it.)

### Consent position (stated once, then execute)

The agree-all consent copy (`src/lib/consentCopy.js` — MKTR contact for offers
+ sponsor disclosure for sponsored campaigns) does **not** name third-party ad
platforms for measurement/matching. This is not new to Google: the LIVE Meta
CAPI path already sends hashed em/ph/fn/ln under the same copy, gated by the
same ledger. Phase 1 adopts **exact parity with that accepted practice**:
PII rides only on the submit-success path, which requires the agree-all block
(`CampaignSignupForm.jsx:362` and the marketplace flow both submit
`consent_contact: true` unconditionally — a failed/abandoned form never
fires). The residual gap — consent copy that names ad-measurement partners —
is assigned to the already-queued real-lawyer pass (data-powerhouse
follow-up), not gated here. **Consent Mode v2 is deliberately NOT adopted:**
traffic is SG-only (no EEA serving), Google does not require it outside
enforcement regions, and default-denied tagging would cut the exact signal
this plan exists to add. Revisit only if serving expands into a consent-mode
region.

### Account-side (Shawn or claude-in-chrome)

Google unified the enhanced-conversions setup in 2026 — old two-toggle
(web action + "EC for leads") instructions are stale. Follow the **current
unified Enhanced Conversions setting** at account/conversion-action level:
turn on user-provided data collection for the "Submit lead form" action
(ctId 7718239815), accept the customer-data terms, confirm auto-tagging is
on, and check the action's Diagnostics tab afterwards. Exact click-path per
the current UI at execution (support.google.com/google-ads/answer/16884284).

### Tests

- `src/lib/__tests__/googleAds.test.js`: `toE164Sg` idempotence
  (`'91234567'` and `'+6591234567'` → same output; garbage → undefined),
  empty-field stripping, flag-off no-op, dataLayer ordering (`set` before
  `conversion`), clear-after-fire leaves no `user_data` on later events.
- Funnel tests: called with submitted email/phone on success only, and only
  when `shouldTrackGoogle` passes.

### Verify live

Tag Assistant on `/flow/airpods-pro-draw` shows user-provided data on the
conversion; within ~72h the action's Diagnostics shows enhanced conversions
recording. Grep the **lazy** chunk for the flag marker (entry-chunk grep is a
known false negative per the deploy-verification memory).

## 2. Phase 0 — Data Manager API access (gates 2b + 3)

No developer token, no MCC. But the credential must be **durable**, which
depends on OAuth publishing mode — an external app left in "Testing" issues
refresh tokens that expire after 7 days, which would silently kill both
services a week after launch:

1. Google Cloud project on the **mktr.sg Workspace org** (admin@mktr.sg is a
   Workspace account) → enable the Data Manager API.
2. OAuth consent screen: **User type INTERNAL** (available because the org is
   Workspace) → refresh tokens are durable and the sensitive
   `https://www.googleapis.com/auth/datamanager` scope needs no verification.
   Fallback if Internal is unavailable: publish to Production and accept the
   unverified-app warning during the one-time consent (tokens durable;
   verification only matters at user-count scale we will never hit).
3. OAuth client type **Desktop** (required for a local loopback flow) →
   one-off local script **`backend/scripts/google-dm-oauth-bootstrap.mjs`**
   mints the refresh token as admin@mktr.sg. Never deployed
   (`backend/.dockerignore:21` strips `scripts/*` from the image).
4. Data Manager requests name the Ads account as the destination's
   `operatingAccount` (verified: *"the operating_account of the destination
   must be the Google Ads conversion customer"*) — admin@mktr.sg has admin on
   `182-916-3947`.

**Client decision:** prefer Google's official Node client for Data Manager if
it stays slim, else raw REST mirroring `metaCapiService`'s bare-`fetch` style
— either way behind **`backend/src/utils/googleDataManagerClient.js`** (token
refresh with expiry cache, request helper, normalized error surface,
request-ID extraction, `validateOnly` support). Decide at build after
inspecting the package; call sites depend only on the util.

**New backend env vars:** `GOOGLE_DM_OAUTH_CLIENT_ID`,
`GOOGLE_DM_OAUTH_CLIENT_SECRET`, `GOOGLE_DM_REFRESH_TOKEN`,
`GOOGLE_ADS_CUSTOMER_ID=1829163947`.

## 3. Phase 2 — stop paying to re-acquire people we already have

The funnel's dedupe blocks a repeat entrant **after** the click is paid for —
and only per campaign: `prospectService.js` enforces *"a phone can register
once per campaign, but can register for different campaigns"*. Exclusion
lists kill the impression upstream, and must respect that per-campaign
eligibility or they over-exclude.

### 2a. Meta customer-list sync — audit, THEN flip (was "env flip only")

The built-but-dark `redeemedAudienceService.js` is **misnamed**: its
`selectRedeemers()` selects **every non-`call_bot` prospect** (no redeemed
filter — consent/suppression filtering happens after selection). Flipping it
attaches an *all-entrants* list, which cross-campaign suppresses people still
eligible for other campaigns. Also, `docs/reference/ads-and-tracking.md`
records the list (52506028688033) as already attached to one live ad set —
audit actual attachments before assuming a clean slate. **Decision for Shawn
(§7.2):** accept global suppression as the product rule (defensible while one
draw runs at a time), or add a campaign predicate before flipping. The flip
itself stays cheap once decided: `REDEEMED_AUDIENCE_SYNC_ENABLED=true`,
`META_ADS_MANAGEMENT_TOKEN`, `META_REDEEMED_AUDIENCE_ID=52506028688033`.

### 2b. Google Customer Match exclusion — `backend/src/services/googleCustomerMatchService.js`

Structural mirror of the Meta service's guard/chunk shape, uploading via
**Data Manager `audienceMembers:ingest`** into a Customer Match list created
once in the Ads UI (Audience Manager → customer list — no list-creation API
needed; id → env).

- **`shouldSync()`**: `GOOGLE_CM_SYNC_ENABLED === 'true'` + Phase-0 creds +
  `GOOGLE_CM_USER_LIST_ID` + `GOOGLE_CM_CAMPAIGN_ID`. Missing → clean no-op.
- **Population:** prospects of **`GOOGLE_CM_CAMPAIGN_ID` only** (per-campaign
  lists match the dedupe rule: campaign X's entrants are un-convertible for
  campaign X and no one else), phone-verified under the **shared binding
  semantic** — `phoneVerifiedAt` present AND (`phoneVerifiedFor` absent OR
  equal to the current phone), i.e. reuse/mirror the `consumerService.js:41`
  helper rather than a bare `phoneVerifiedAt` check, so a stale stamp on an
  edited number is never uploaded. Retell-synthetic `@calls.mktr.sg` emails
  skipped; erased rows excluded (`sourceMetadata.erased`).
- **Consent gate:** `contactGrantAllows` row-level, **always on — no
  `REQUIRE_CONSENT=false` escape hatch** (the Meta service's hatch also
  removes its only verified-contact filter; not replicated).
- **Request contract (pinned per round-2/3 doc checks):**
  - Identifiers: Google-specific email normalization is REQUIRED before
    hashing — trim, lowercase, strip inner whitespace, and canonicalize
    `gmail.com`/`googlemail.com` local parts (remove dots, drop `+suffix`).
    The existing `hashEmail` only trims/lowercases → new
    `hashEmailGoogle` in `piiHashing.js`. Phone: **`hashPhoneE164`** (E.164
    with `+` — NOT Meta's digits-only `hashPhone`).
  - Hashed `userData` requires **`encoding: "HEX"`** on both ingest and
    remove requests.
  - Consent enums: `adUserData`/`adPersonalization = "CONSENT_GRANTED"` —
    truthful because rows are ledger-gated (rows failing the gate are never
    uploaded at all, so no mixed-consent batches exist here).
  - Customer Match ingest must carry
    `termsOfService.customerMatchTermsOfServiceStatus: "ACCEPTED"`.
- **Job lifecycle:** ≤10,000 members per request; capture each returned
  request ID and poll diagnostics to a terminal state, **deduplicating polls
  by request ID**; classify retries (429/5xx backoff, 4xx → Sentry);
  in-process single-flight lock (single-instance backend) so scheduler runs
  can't overlap. `PARTIAL_SUCCESS` on an audience batch needs no per-row
  settle: diagnostics reports aggregate error counts only, membership is not
  tracked per-row locally, and the nightly additive re-ingest self-heals —
  log the counts (never PII) and alert on wholesale failure.
- **Membership duration:** set FINITE on the list **in the Ads UI** —
  default proposal 180 days (platform max/default 540) — so anything the
  removal path misses ages out. This is a list setting, not an env var.
- **Removal path:**
  - **Erasure:** `erasureService` runs ONE transaction (locks at
    `erasureService.js:138`, scrub inside, commit at `:761`) and already has
    a **post-commit outbox step** ("fire the persisted lead.deleted outbox
    rows"). Hook there: **collect** the hashed identifiers inside the
    transaction (cheap reads, no I/O), **execute** `audienceMembers:remove`
    (with `encoding: "HEX"`) post-commit beside the existing outbox dispatch
    (bounded retry + Sentry; erasure success never depends on Google
    availability). Process death between commit and the call loses that
    removal — the finite membership duration is the documented backstop.
  - **Consent withdrawal:** post-commit of `consentService.applyUnsubscribe`
    (`consentService.js:562`) — a direct call beside (NOT inside) the
    webhook-suppression reconciler it currently invokes, which owns
    subscriber projection state, not ad audiences.
  - **Rollback (honest version):** unsetting the flag stops future syncs; it
    does NOT unshare accepted data. Real rollback = detach the list from
    campaigns, remove members / delete the list in the UI, lifespan expiry
    mops up.
- **Scheduler:** same in-process interval block in `bootstrap.js` beside the
  Meta one (24h default via `GOOGLE_CM_SYNC_INTERVAL_HOURS`; 90s initial — deliberately offset from the Meta block's 60s so the two ledger scans never land together).
- **Eligibility caveat:** Customer Match exclusions are available without the
  90-day/USD 50k *targeting* threshold, but the account must be policy- and
  payment-compliant — check the account's Customer Match status page as a
  **precondition**; a policy/payment block is not cured by more spend.
- **Ops after first sync:** attach as campaign-level exclusion on the Demand
  Gen campaign. Expect up to 24–48h list processing and 30–60% match rates.

### Tests

Population predicates (campaign, verified-binding semantic, non-bot,
non-erased), consent gating (no hatch), `hashEmailGoogle` canonicalization
(gmail dots/plus, googlemail, non-gmail untouched), E.164 assertion,
envelope fields (`encoding`, terms-of-service, consent enums) as mocked
golden-envelope tests, batching at the cap, request-ID status handling incl.
stuck/aggregate-partial/terminal-failure + poll dedup, single-flight overlap,
erasure-hook ordering (collect in-txn, execute post-commit, erasure completes
when Google errors), withdrawal-hook dispatch. All client-mocked.

## 4. Phase 3 — down-funnel outcomes (the "CAPI parity" arc)

Teaches Google what a *good* lead is. Hangs off the same webhook as Meta's
down-funnel events, uploading via **Data Manager `events:ingest`**.

### 4.1 Frontend: capture the click ids (now WITH the upload, per #457's rule)

- **`src/lib/googleAds.js`**: `captureGclFromUrl(search)` + `readGcl()` —
  capture `gclid`, `gbraid`, `wbraid` URL params into sessionStorage
  (`_mktr_gcl`), stored as `{ gclid, gbraid, wbraid, capturedAt }` (the
  timestamp is load-bearing — §4.2 age guard). **Call sites: the existing
  unconditional early capture effects** where `captureFbcFromUrl` /
  `captureTtclidFromUrl` already run on mount (`LeadCapture.jsx:94` area,
  `MarketplaceFlow.jsx:130` area, and `MarketplaceOffer`'s capture effect) —
  **independent of the `firedGoogle` view guard**, which only gates
  config/view firing and may already be set on a later reload.
- **Recovery fallback (async-correct, idempotent):** `gtag('get', AW_ID,
  'gclid', cb)` is an async callback API and gtag is only configured after
  campaign resolution — so the recovery attempt runs inside
  `initGoogleAds()` post-`config`, and the callback **re-checks storage
  before writing**: it fills `gclid` only if still absent (a stale recovery
  must never overwrite a fresher URL capture). No `_gcl_aw` cookie parsing
  (not a published contract). `gtag('get')` covers `gclid` only; gbraid/
  wbraid are URL-param capture only.
- **Submit payloads** (`MarketplaceFlow.jsx`, `LeadCapture.jsx`): spread
  `gclid`/`gbraid`/`wbraid`/`gclCapturedAt` keys beside `ttclid`.
- **`backend/src/middleware/validation.js`**: whitelist the four keys beside
  `ttclid` (`Joi.string().max(512)`; `gclCapturedAt` ISO-date). The
  stripUnknown middleware logs a contract-drift warning naming dropped keys —
  forgetting this is loud in logs, not silent, but still loses the data.
- **`backend/src/services/prospectService.js`**: extract in the meta block
  (~line 183) and persist in `capiSourceMetadata` (~line 253) beside
  `fbc`/`ttclid`.

### 4.2 Backend: `backend/src/services/googleOfflineConversionsService.js`

- **Account prerequisite:** two import-type conversion actions created in the
  Ads UI ("MKTR – Confirmed Resident", "MKTR – Closed Won"), **action type
  `UPLOAD_CLICKS`**, category Qualified lead / Converted lead, **SECONDARY
  from birth** (promotion rule §4.6), default values matching env. Their ids
  are the `productDestinationId` on the ingest destination
  (`operatingAccount = 1829163947`).
- **`shouldFireGoogleUpload(prospect, eventKey)`** — Google-specific rule,
  NOT a clone of `shouldFireCapi` (whose Retell/Meta-Lead-Ads skips are
  Meta-attribution reasoning): `GOOGLE_ADS_UPLOADS_ENABLED === 'true'` +
  Phase-0 creds + at least one usable identifier + prospect not erased.
  (Action-id presence is NOT part of this fact-eligibility gate — it is the
  separate per-key configuration preflight below, shared by inline dispatch
  and the worker sweeps.) Skip
  `call_bot` for data quality (synthetic contact data).
  **Meta-Lead-Ads-origin leads are NOT skipped** — Google's guidance is to
  upload all outcomes; unmatched events are expected and free. Permanently
  ineligible facts — properties of the FACT itself: call_bot origin, no
  identifier ever, age window expired — are **terminally marked**
  (`skippedPermanent`, §4.3) so the worker stops revisiting them. A
  **missing conversion-action id is deployment config, NOT a fact
  property** (round 5): it is a per-event-key worker PREFLIGHT — alert and
  abort that key's sweep pass without mutating any row marker, so supplying
  the env later sends the untouched facts.
- **One event per ingest request.** Outcome volume is tiny (lifetime today:
  4 CR / 0 CW on the Meta side); single-event requests make every
  `requestId` map to exactly one prospect marker, which kills the
  `PARTIAL_SUCCESS` per-row-attribution problem outright (diagnostics
  reports aggregates only, with no event/transaction ids). The ≤2,000-event
  batch ceiling is irrelevant at this volume; revisit only if volume ever
  makes it matter, using single-event replay to settle partials.
- **Event build (all identifiers, no preference chain):** one event carrying
  **every** available identifier: ad identifiers for whichever of
  gclid/gbraid/wbraid were captured, AND `userData` (hashed
  `hashEmailGoogle` email + `hashPhoneE164` phone, `encoding: "HEX"`) — the
  latter **only when `canMarketTo`** (same ledger call, same fail-closed
  posture as Meta's em/ph). Click ids ride regardless (session identifiers).
  No identifier at all → `skippedPermanent` with a structured log.
- **Fields:** **`eventSource: "OTHER"`** (offline CRM status change —
  required field); `eventTimestamp` RFC3339 from the validated status-change
  time (§4.3); `transactionId` = stable `confirmed_resident:{prospectId}` /
  `closed_won:{prospectId}` (provider-side dedup); **`conversionValue` +
  `currency: 'SGD'`** (the API's field names — not `currencyCode`).
  **Consent is event-conditional:** `CONSENT_GRANTED` enums ride ONLY when
  the ledger authorized `userData` for this event; click-only events **omit
  the consent block entirely** (a granted declaration on a
  consent-refused/withdrawn person would be false — `canMarketTo` returns
  false for erased/suppressed consumers).
- **Value:** static per event only — `GOOGLE_VALUE_QUALIFIED` (placeholder
  S$40), `GOOGLE_VALUE_WON` (placeholder S$500). **Score weighting is CUT
  from this arc** (`prospect.buyScore` is 0–100 per person × campaign; a
  sane mapping needs calibration against the live distribution + a NULL
  policy). Parked with its own calibration step (§7.1).
- **Age guard:** import windows run from the **click**, not the conversion.
  Proxy: `gcl.capturedAt` (capture happens on the landing that carried the
  click id). Skip (terminally) when `now − capturedAt >
  GOOGLE_CONV_MAX_AGE_DAYS` (default 60). PII-only events use signup
  `createdAt` as the proxy.

### 4.3 Durable facts, atomic JSON writes, marker state machine, workers (rebuilt across rounds 2–4)

Facts this design rests on (all round-2/3/4 verified): the Lyfe webhook path
never persists the status change locally, **and its Supabase trigger cannot
retry** — it queues ONE async `net.http_post`, discards the request id, and
never observes the response (`docs/plans/lyfe-leads-outcome-webhook.sql:102`;
pg_net has no automatic response-based retry), so HTTP status codes buy no
durability from Lyfe. `events:ingest` is asynchronous (HTTP 2xx returns a
`requestId`; terminal `SUCCESS`/`FAILED`/`PARTIAL_SUCCESS` can land hours
later; failed HTTP requests return NO requestId). `sourceMetadata` is a
**nullable JSON column** whose existing writers do whole-object
read-spread-save from possibly-stale loaded instances. Erasure rebuilds
`sourceMetadata` as a skeleton carrying `erased: true`
(`erasureService.js:86`).

#### Atomic JSON write helper (`backend/src/utils/prospectJsonPatch.js`)

Three operations — **path-based and transaction-aware** (round 5: the
converted writers include ROOT-level fields like `recordingUrl` and
`phoneVerifiedAt`, which parent/child-shaped ops cannot express, and some
must join a caller's transaction). Each is ONE SQL statement on
`COALESCE("sourceMetadata"::jsonb, '{}'::jsonb)` with the JSON↔JSONB cast
(precedent: migration `097:51`), carries the erased guard
`COALESCE(...->>'erased','false') <> 'true'` plus any caller CAS predicate,
accepts `{ transaction, cas }`, and returns the affected-row count (0 =
blocked or CAS-lost — reload to classify; never assume success). `path: []`
addresses the root; deeper paths are ancestor-ensured (each level
`jsonb_set(..., COALESCE(...,'{}'))` — a naive deep `jsonb_set` no-ops on
missing parents):

1. **`mergeFirstWins(id, path, patch, opts)`** — for outcome facts:
   the merge at the target is `:patch::jsonb || COALESCE(<existing>,'{}')`
   — **patch on the LEFT, existing on the RIGHT**, so existing keys win
   (write-once/first-wins) while absent keys insert together. No
   key-absence CAS (it would block `won` adding `closed_won` when
   `confirmed_resident` already exists); "all requested keys already
   present" is idempotent success, not failure. Also serves redemption's
   nested `['capi','voucherRedeemed']` map — ancestor-ensured, preserving
   `capi` siblings AND other entitlement keys.
2. **`setPath(id, path, value, opts)`** — for marker state transitions and
   the Retell root-level recording cache: ancestor-ensured replace at the
   target with a CAS predicate on its current content (state and/or
   `requestId` match, or absent) so stale transitions lose.
3. **`removePaths(id, paths[], opts)`** — `#-` removal (used by the admin
   phone-edit verification-stamp removal; JSON `null` is not key-absence
   for existence predicates).

**Writer conversion audit (expanded rounds 4–5 — "two writers" was not
enough):** grep every `sourceMetadata` assignment; convert ALL non-erasure
whole-object writers to the helper: Meta markers
(`leadOutcomeService.js:183` → `setPath(['capi', key], ...)`), redemption
markers (`redemptionOutcomeService.js:141` →
`mergeFirstWins(['capi','voucherRedeemed'], ...)`), the admin phone-edit
verification-stamp removal (`prospectMutationService.js:59` →
`removePaths([['phoneVerifiedAt'],['phoneVerifiedFor']], { transaction })`),
the Retell recording cache (`retellService.js:535` →
`setPath(['recordingUrl'], ...)`). **`updateProspect` must open ONE managed
transaction for phone changes and for mapped status transitions** — today
only demographics edits get the managed transaction
(`prospectMutationService.js:133`) and phone/status edits autocommit, so
"admin facts inside the status-update transaction" needs that transaction to
exist; the model update and the helper calls both receive it. **Inside that
transaction, lock/reload the prospect and re-check `sourceMetadata.erased`
before the model update** (round 6): today the erased check runs on the
initial pre-transaction read (`prospectMutationService.js:35`), so an
erasure committing in between lets a stale phone edit re-attach a phone to
a scrubbed row. Blocked-after-reload → the same `410` the pre-check
already returns. Erasure keeps
TWO exempt writers, both inside its `FOR UPDATE` row-locked transaction:
the erased-skeleton rebuild (full replacement is the point) and the
referral-name removal on other prospects' rows (`erasureService.js:234` —
may optionally convert to `removePaths` later, but is already lock-safe).
Interleaving tests run against these REAL converted writers.

#### Durable outcome facts

`sourceMetadata.outcomes.{eventKey} = <RFC3339>` recorded when a mapped
status arrives, BEFORE any dispatch, via `mergeFirstWins` — **all facts
for one status in ONE call** (a `won` patch carries `confirmed_resident` +
`closed_won` together, same timestamp; first-wins keeps an earlier
`qualified` timestamp intact). `occurred_at` is validated RFC3339; invalid/
absent → the signed webhook header timestamp, passed explicitly as
`processLeadOutcome(payload, { signedWebhookAt })` (the controller already
validates and holds it but today forwards only the body), else receipt time.

**Fact durability per inbound path:**
- **Admin path:** facts written **inside the status-update transaction**
  (`prospectMutationService`); dispatch stays post-commit fire-and-forget.
- **External path:** fact write precedes its existing CAPI fold; its
  503-driven sweep semantics are unchanged.
- **Lyfe webhook:** the controller keeps its 200-always contract (nothing
  upstream reads the status anyway — see trigger facts above). The loss
  window (fact write fails on the single notification) is closed by the
  **Lyfe outcome reconciler** below, not by HTTP codes.

#### Lyfe outcome reconciler (replaces the false "non-2xx → retry" coupling)

MKTR already reads Lyfe's Supabase with the service-role key
(`backend/src/integrations/adapters/lyfe/lyfeClient.js`). A low-frequency
job (every `GOOGLE_LYFE_RECONCILE_INTERVAL_HOURS`, default 6) queries the
`leads` REST endpoint for `source_name=eq.mktr` rows, maps `external_id` →
prospect, and writes any **missing** outcome facts via `mergeFirstWins`.
**Status mapping (round 6 — pinned against Lyfe's real vocabulary,**
`lyfe-app/types/shared/lead.ts:6`: `new | contacted | qualified | proposed |
won | lost`**):** the trigger fires on transitions and persists no history,
so an equality scan misses leads that moved on — but implication from
successor statuses is UNSAFE: Lyfe's status picker lets an agent select any
status, and the SC/PR confirmation dialog fires only when selecting
`qualified`, so `proposed` alone does not prove prior qualification. Rule:
- **Current-status evidence first:** `qualified` → `confirmed_resident`;
  `won` → `confirmed_resident` + `closed_won` (the one implication Lyfe's
  own semantics commits to, mirrored in `eventKeysForStatus`).
- **Then history-fill EVERY still-missing event key, regardless of current
  status** (round 7: statuses regress too — Lyfe permits `won → qualified`,
  so a missed `won` webhook followed by regression would otherwise lose
  `closed_won` forever): for leads with any missing key, one batched
  `lead_activities` query —
  `?type=eq.status_change&lead_id=in.(…)&select=lead_id,created_at,metadata`
  (the column is **`type`**, NOT `activity_type`; transitions live in
  **`metadata.from_status` / `metadata.to_status`** —
  `lyfe-app/lib/leads/crud.ts:204`) — filter `metadata->>to_status` for
  `qualified`/`won`; found → write the fact with the activity's
  `created_at`. A `proposed` lead with NO qualifying transition in history
  gets nothing (no false CR). This closes the round-5 "qualified → lost"
  residual instead of accepting it. This
job (a) closes the fact-write-failure window, (b) heals missed/never-
delivered webhooks (pg_net is fire-and-forget), and (c) **backfills pre-arc
outcomes** — today's existing CR leads get facts, and uploads then apply the
normal age guard. `occurred_at` for reconciled facts: the Lyfe row's
status-change timestamp if the schema exposes one, else its `updated_at`
(approximation, documented; exact column pinned at build — §9). First-wins
merge makes webhook and reconciler writes converge; the reconciler never
overwrites.

#### Google marker state machine (`sourceMetadata.gads.{eventKey}`)

Every transition an atomic CAS `setPath`. **Key absence is never the
retry ledger** — retry accounting always lives in a present state object:

- `{ state: 'pending', requestId, sentAt, nextPollAt, retryCount }` — on
  HTTP accept. **`retryCount` rides through `pending`** (round 5): virgin
  send = 0; a due resend increments once at dispatch and the accepted
  pending marker RETAINS that value, so an accepted-then-FAILED cycle can
  never reset the count.
- `{ state: 'retryWait', retryCount, nextSendAt, lastReason }` — on
  synchronous transient exhaustion (network/429/5xx after the bounded
  in-request retries; NO requestId exists in this case) and on asynchronous
  transient `FAILED` reasons (which copy `retryCount` back from the pending
  marker). The resend job selects due `retryWait` rows (and virgin facts
  with no `gads` key at all); **the cap is checked BEFORE dispatch**:
  `retryCount ≥ GOOGLE_SEND_MAX_RETRIES` (default 5) → `failedPermanent`
  instead of another send.
- `{ state: 'delivered', requestId, deliveredAt }` — terminal `SUCCESS`,
  CAS on the same `requestId` (a stale poll of a superseded request or a
  late pending write can never regress this). Duplicate-transaction
  evidence in error reasons **counts as delivered** (consistent with
  `transactionId` dedup).
- `{ state: 'failedPermanent', reason, at }` — synchronous permanent
  rejection (4xx validation), permanent async `FAILED` reasons, retry-cap
  exhaustion, or pending past `GOOGLE_PENDING_MAX_DAYS` (default 7) after
  one final status retrieval. Sentry; never retried.
- `{ state: 'skippedPermanent', reason, at }` — permanently ineligible
  facts (§4.2): call_bot, no identifier, age window expired. Excluded by
  worker queries forever. (Missing action id is NOT in this list — it is a
  worker preflight, §4.2.)
- Non-terminal `PROCESSING` poll results **CAS-advance `nextPollAt`**
  (backoff), so in-flight requests are not re-polled every tick.

#### Workers (one interval block in `bootstrap.js`, gated on `GOOGLE_ADS_UPLOADS_ENABLED`; in-process single-flight; single-instance backend; house pattern = the redemption-CAPI sweep)

- **(a) re-send:** rows with an `outcomes.{key}` fact and either no
  `gads.{key}` or a due `retryWait` → dispatch.
- **(b) settle:** rows with `pending` markers past `nextPollAt` → poll
  diagnostics by `requestId` (deduped), apply the state machine.
- **(c) reconcile:** the Lyfe outcome reconciler above, on its own longer
  interval.
- Worker queries filter on JSON predicates over `prospects` — fine at
  current row counts (~10³); if it ever measures slow, a partial expression
  index is the fix, not a schema change.

#### Integration

`leadOutcomeService.js`: extend `defaultDeps` with the Google dispatcher;
per event key run Meta then Google **sequentially** (bounded in-process
retry via the existing `dispatchWithRetry` shape for the synchronous HTTP
leg). Google failure never blocks the Meta send, the other network's marker,
or the 200 to Lyfe. **A durable outbox table** remains the gold-plated
alternative — **deliberately deferred**: facts + reconciler + atomic CAS
writes + workers give restart durability without a migration; revisit if
real contention shows up.

### 4.4 Tests

Payload builder (all-identifier union, consent block present ONLY with
authorized `userData` — click-only/withdrawn fixture asserts omission,
`eventSource`, RFC3339, `transactionId` stability,
`conversionValue`/`currency` field names, one-event-per-request). Golden
mocked envelopes for ingest/remove (unit); **separate opt-in credentialed
`validateOnly` smoke script** (`backend/scripts/google-dm-validate-smoke.mjs`,
never CI) — validate-only runs are not executed and never create pending
markers. Gate matrix (`call_bot` → skippedPermanent, Meta-Lead-Ads NOT
skipped, no-identifier/age-expired → skippedPermanent, missing action id →
abort key + alert + NO marker,
erased skip). Atomic helper: NULL column, absent parent, first-wins merge
direction (later `won` never rewrites `confirmed_resident`; `closed_won`
still inserts), multi-key single-call `won` write, nested-path `mergeFirstWins`
preserves sibling entitlements + `capi` siblings, CAS regression cases
(stale poll vs newer requestId; late pending vs delivered; retryWait CAS),
`#-` removal, erased-guard 0-row classification. Interleaving tests against
the REAL converted writers (Meta markers, redemption, admin phone-edit,
Retell cache). Timestamp chain: invalid `occurred_at` → `signedWebhookAt`
context arg → receipt time; admin facts inside the status txn. State
machine: sync-transient → retryWait (no requestId), sync-permanent →
failedPermanent, **retry cap across accepted-then-FAILED cycles (retryCount
rides through pending and never resets)**, cap checked before dispatch,
PROCESSING advances nextPollAt, pending timeout final-retrieval,
duplicate-transaction → delivered, **missing-action-id preflight: no row
mutated, facts send once the env appears**. Reconciler: missing-fact
backfill, **history recovery (a lead now at `proposed` or `lost` with a
missed `qualified` webhook gets its `confirmed_resident` fact from the
`status_change` activity; a currently-`qualified` lead with a prior `won`
activity recovers `closed_won`; a `proposed` lead with NO qualifying
transition in history gets nothing — no false CR; the actual PostgREST
query string asserted, `type=eq.status_change` + `metadata->>to_status`)**,
first-wins non-overwrite, `source_name` scoping, idempotence. Helper:
root-path (`[]`) operations, transaction pass-through, **phone-edit
`removePaths` inside the new managed transaction**, **erasure-wins
interleaving (erasure commits between updateProspect's read and its
transaction → the edit 410s and the phone stays scrubbed)**. Worker: re-send +
settle + reconcile paths, poll dedup, single-flight. Fan-out isolation
across the three inbound paths.

### 4.6 Promotion rule (documented, ops)

Outcomes stay **secondary** until they sustain ≈30 conversions/30 days
(today: 4 CR / 0 CW lifetime on Meta's side — nowhere near). Until then the
campaign optimizes on the phone-verified lead. Value-based bidding is a later
ops decision on top of the recorded values.

## 5. Phase 4 — first-party audience signal (renamed; was "remarketing")

With optimized targeting ON, an attached audience **guides** delivery, it
does not restrict it — so this phase is accurately an *audience signal*, not
remarketing. Ops only: Audience manager → confirm the Google Ads tag source
is collecting (expected account-side toggle, no code); build "Flow visitors
(30d)", "Converters", "Visitors minus converters"; attach to the Demand Gen
ad group as a signal. If true exclusive remarketing is ever wanted, that is a
separate manually-targeted ad group with optimized targeting OFF — out of
scope here. Do after Enable + real traffic.

## 6. Rollout order

1. **Now:** Phase 1 PR (ship dark → account EC setup → flip
   `VITE_GOOGLE_ADS_EC_ENABLED` after deploy-verify). Phase 0 (Cloud project
   on the Workspace org, INTERNAL OAuth app, bootstrap script). Phase 2a
   audit + Shawn's §7.2 decision.
2. **Next:** Phase 2b PR → UI list creation (finite membership duration) →
   first sync → status-verified → attach exclusion. Phase 3 PR (frontend
   capture may ride the Phase 1 PR if timing collapses) → create import
   actions (`UPLOAD_CLICKS`, secondary) → flip `GOOGLE_ADS_UPLOADS_ENABLED`.
3. **After campaign Enable + traffic:** Phase 4 signal segments.

No migrations anywhere (new state lives in the existing `sourceMetadata` JSON
column + env). Flags stop all future sends; §3's rollback note covers what
flags cannot undo (data already accepted by Google).

## 7. Open decisions (Shawn)

1. **Outcome values** — CR/CW static numbers (placeholders S$40/S$500).
   Score weighting is out of this arc; green-light a later calibration item
   if wanted.
2. **Meta list population (2a)** — accept the existing all-entrants global
   suppression as product behavior, or add a campaign predicate to the Meta
   service before flipping. (Google's 2b is per-campaign either way.)
   Includes probing Meta's remove/replace contract for the erasure hook.
3. **Customer Match membership duration** (list setting in the Ads UI) —
   180-day default ok?
4. **Consent copy follow-up** — confirm routing the ad-measurement-partner
   disclosure line into the queued real-lawyer pass.

## 8. New env vars

| Var | Phase | Purpose |
|---|---|---|
| `VITE_GOOGLE_ADS_EC_ENABLED` | 1 | Browser user-provided data on/off |
| `GOOGLE_DM_OAUTH_CLIENT_ID` / `GOOGLE_DM_OAUTH_CLIENT_SECRET` / `GOOGLE_DM_REFRESH_TOKEN` | 0 | Data Manager OAuth |
| `GOOGLE_ADS_CUSTOMER_ID` | 0 | Destination operating account (1829163947) |
| `GOOGLE_CM_SYNC_ENABLED` / `GOOGLE_CM_USER_LIST_ID` / `GOOGLE_CM_CAMPAIGN_ID` / `GOOGLE_CM_SYNC_INTERVAL_HOURS` | 2b | Customer Match sync |
| `GOOGLE_ADS_UPLOADS_ENABLED` / `GOOGLE_CONV_ACTION_QUALIFIED` / `GOOGLE_CONV_ACTION_WON` / `GOOGLE_VALUE_QUALIFIED` / `GOOGLE_VALUE_WON` / `GOOGLE_CONV_MAX_AGE_DAYS` / `GOOGLE_PENDING_MAX_DAYS` / `GOOGLE_SEND_MAX_RETRIES` / `GOOGLE_LYFE_RECONCILE_INTERVAL_HOURS` | 3 | Outcome ingest + settle + reconcile |
| (Meta flip) `REDEEMED_AUDIENCE_SYNC_ENABLED` / `META_ADS_MANAGEMENT_TOKEN` / `META_REDEEMED_AUDIENCE_ID` | 2a | Existing service |

## 9. Verify-at-build list (assertions to re-pin against current docs; flag deltas in the PR)

- Data Manager: exact `events:ingest` / `audienceMembers:ingest|remove`
  envelopes against the live reference (pinned so far: `eventSource`
  required + `"OTHER"` for CRM outcomes, `CONSENT_GRANTED` enums,
  `conversionValue`+`currency`, `encoding: "HEX"`,
  `customerMatchTermsOfServiceStatus: "ACCEPTED"`, `UPLOAD_CLICKS` action
  type, aggregate-only diagnostics with `FAILED` enum + `PROCESSING`
  non-terminal, requestId only on accepted requests, requestId-scoped
  status retrieval, 10k members / 2k events caps), official Node client
  fitness, documented error-reason taxonomy (esp. duplicate-transaction;
  transient-vs-permanent classification).
- Import/attribution window under Data Manager (drives
  `GOOGLE_CONV_MAX_AGE_DAYS`).
- Whether `leads` exposes a status-change timestamp (reconciler
  `occurred_at` source for current-status evidence; else `updated_at`
  approximation). Status vocabulary and the `lead_activities` payload shape
  are both pinned already (rounds 6–7): statuses `new | contacted |
  qualified | proposed | won | lost`; activities column `type`, transitions
  in `metadata.from_status`/`to_status`.
- Current unified Enhanced Conversions UI states + customer-data terms.
- Customer Match status page + exclusion eligibility for this account.
- Whether the tag's audience collection (Phase 4) needs any config param
  (expected: account-side only).

## 10. Review log

**Round 1 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 17 findings.**
All codebase claims verified true against the repo (score scale 0–100 on the
prospect row; `sourceMetadata` = JSON not JSONB; per-campaign dedupe;
`selectRedeemers` selects all non-bot prospects; erasure scrubs before any
external removal could use identifiers; Lyfe controller always-200s; admin
path fire-and-forget; reconciliation sweep is redemption-only; stripUnknown
warns). The gating platform claim — classic Google Ads API uploads closed to
new developer tokens (Apr 1 / Jun 15, 2026) with Data Manager API as the
successor — **confirmed verbatim against live Google docs**, driving the v2
rearchitecture (MCC/dev-token cut, 2b/3 retargeted to Data Manager). Applied:
all-identifier event build, capturedAt-based age guard, unified EC setup,
`gtag('set')` scope clearing, Google-specific upload gate, per-campaign +
verified CM population, consent-hatch removal, erasure/withdrawal removal
hooks + finite membership duration, CM job lifecycle controls, score
weighting cut, Phase 4 renamed. Resolved differently, rationale recorded:
consent posture = parity with live Meta CAPI practice + lawyer-pass routing
instead of Consent Mode v2 (§1); durable outbox deferred (§4.3).

**Round 2 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 10 findings
(2 blockers). All verified and applied in v3:** durable-outcome-fact +
two-stage pending/delivered markers + diagnostics-settling worker replace the
v2 sweep, whose `leadStatus` scan had no durable fact on the Lyfe path (it
never persists status locally) and would re-select erased rows; atomic JSON
writes replace read-spread-save for new `sourceMetadata` state; Data Manager
contract corrections; idempotent `toE164Sg` (classic funnel already submits
E.164 — naive prefixing would produce `+6565…`); OAuth app pinned INTERNAL on
the Workspace org (Testing-mode refresh tokens die in 7 days); erasure
removal re-anchored collect-in-txn → execute-post-commit beside the existing
lead.deleted outbox step, withdrawal removal anchored post-commit of
`applyUnsubscribe`; `gtag('get')` fallback made async-correct; CM population
uses the `phoneVerifiedFor` binding semantic.

**Round 3 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 11 findings
(6 blockers). All verified (erased-flag shape confirmed at
`erasureService.js:86`; redemption whole-object write at
`redemptionOutcomeService.js:141`) and applied in v4:** required
`eventSource` + `UPLOAD_CLICKS` pinned; atomic writes must COALESCE NULL
columns and merge top-level children (naive nested `jsonb_set` silently
no-ops on missing parents); existing whole-object marker writers convert to
the atomic helper (their stale-instance saves would delete new keys within a
single invocation); outcome facts write-once, one statement per status,
`occurred_at` validated; fact durability coupled per inbound path; one event
per ingest request (diagnostics is aggregate-only); full marker state
machine; erased-guard predicates everywhere; consent block event-conditional;
`validateOnly` reclassified as smoke script; click-id capture anchored to the
unconditional early capture effects.

**Round 4 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 6 findings
(2 blockers). All verified (pg_net `perform net.http_post` discards the
response — `lyfe-leads-outcome-webhook.sql:102`; admin phone-edit and Retell
recording-cache whole-object writes confirmed) and applied in v5:** the
round-3 "Lyfe returns non-2xx so the trigger retries" coupling was FALSE —
pg_net never observes responses; replaced by the **Lyfe outcome reconciler**
riding the existing `lyfeClient.js` service-role REST access (closes the
fact-write window, heals undelivered webhooks, backfills pre-arc outcomes);
the state machine no longer uses key absence as its retry ledger — explicit
`retryWait` (holds retryCount/nextSendAt; covers sync failures that have no
requestId) + `skippedPermanent` (permanently ineligible facts stop
re-entering the worker) + PROCESSING polls CAS-advance `nextPollAt`; the
merge SQL direction fixed to `patch || existing` so existing keys win
(first-wins) while `won` still inserts `closed_won` beside an earlier
`confirmed_resident`, with no key-absence CAS; `deepEnsureMerge` added for
redemption's nested entitlement map (a shallow child patch would clobber
sibling entitlements); the writer-conversion audit expanded to ALL
non-erasure whole-object `sourceMetadata` writers (admin phone-edit → atomic
`#-` in its txn; Retell cache → atomic patch; erasure rebuild exempt);
`signedWebhookAt` passed as an explicit trusted context argument.

**Round 5 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 5 findings
(1 blocker). All verified and applied in v6:** the reconciler's equality
scan on current `leads.status` could not heal a missed `qualified` webhook
once the lead advanced — replaced with **successor-status implication**
(`proposal_sent`/`negotiating`/`won` imply confirmed_resident, the same
logic `eventKeysForStatus` already applies to `won`; the `qualified → lost`
double-failure edge documented as accepted, `lead_activities` history named
as the escalation); `retryCount` now rides through the `pending` marker so
accepted-then-FAILED cycles cannot reset the cap (checked before dispatch);
missing conversion-action id reclassified from `skippedPermanent` (a fact
property) to a per-event-key worker preflight (deployment config — fixing
the env later still sends untouched facts); the helper operations made
path-based (`path: []` = root — Retell's `recordingUrl` and the
verification stamps are root-level) and transaction-aware, with
`updateProspect` required to open a managed transaction for phone changes
and mapped status transitions (today only demographics edits get one); the
referral-name removal inside erasure acknowledged as a second row-lock-safe
exempt writer.

**Round 6 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 3 findings
(0 blockers; first cross-repo round — it read lyfe-app). All verified and
applied in v7:** the round-5 implication map used statuses that DO NOT
EXIST in Lyfe (`proposal_sent`/`negotiating`; the real vocabulary is
`new|contacted|qualified|proposed|won|lost`, `lyfe-app/types/shared/
lead.ts:6`) and was unsafe anyway — Lyfe's status picker allows jumping to
any status with the SC/PR confirmation firing only on `qualified`, so
`proposed` does not imply qualification; replaced with direct mapping for
`qualified`/`won` plus a `lead_activities` `status_change` history lookup
for every other status (which also CLOSES the round-5 `qualified → lost`
residual instead of accepting it — and never mints a false CR); the
missing-action-id preflight made internally consistent (removed from the
fact-eligibility gate and from the `skippedPermanent` test matrix); the new
managed transaction must lock/reload and re-check `erased` before the model
update (the pre-transaction check leaves a window where a phone edit
re-attaches a phone to a freshly scrubbed row → 410 + erasure-wins
interleaving test).

**Round 7 — Codex gpt-5.6-sol xhigh, 2026-08-18: NEEDS CHANGES, 2 findings
(0 blockers). Both verified against lyfe-app and applied in v8:** the
history-lookup query named a nonexistent column — `lead_activities` stores
the enum in **`type`** (not `activity_type`) with transitions in
`metadata.from_status`/`to_status` (`database.types.ts:1649`,
`lib/leads/crud.ts:204`; as written the query would have failed and
silently disabled all history recovery) — exact PostgREST query now pinned
in the plan and asserted by test; and history recovery generalized to fill
EVERY still-missing event key regardless of current status (Lyfe permits
`won → qualified` regression, which would have lost `closed_won` under the
non-mapped-statuses-only rule).

**Round 8 — Codex gpt-5.6-sol xhigh, 2026-08-18: PASS, no findings.**
Convergence: 17 → 10 → 11 → 6 → 5 → 3 → 2 → 0 findings across eight rounds,
every codebase claim verified against the repo(s) (rounds 6–7 cross-repo
into lyfe-app) and every load-bearing platform claim verified against live
Google documentation before being applied.
