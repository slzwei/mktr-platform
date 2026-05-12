# Meta Pixel + Conversions API — Implementation Plan

**Owner:** Shawn Lee
**Status:** Draft, awaiting Phase 0 approval
**Last updated:** 2026-05-11
**Architect mode:** lead architect, precision-first, no hallucinations, test gates at every phase.

---

## 1. Goals & non-goals

### In scope
- Browser Pixel firing `PageView`, `ViewContent`, `Lead` on the public lead-capture funnel.
- Server CAPI dispatching the `Lead` event for web-form-originated prospects only.
- Event-ID-based dedup between Pixel and CAPI so Meta counts one event per real conversion.
- Forward-compatible schema for per-campaign Pixel ID override (nullable column added; env var is the fallback).
- Strict suppression on preview / staff / test-data routes.
- PII handling: SHA-256 hashed email/phone, hashed external ID. Never log the access token.
- Sentry-wrapped, fire-and-forget CAPI errors; the prospect creation response is unaffected by CAPI failures.
- Test Events Manager–first verification at every phase that ships traffic.

### Explicit non-goals (v1)
- Per-campaign CAPI access tokens. Single env-var token only.
- CAPI dispatch for `Retell` source (no ad-attribution chain).
- CAPI dispatch for `Meta Lead Ads` source (originated inside Meta — would double-count).
- Downstream lifecycle events (`SubmitApplication`, `Purchase`, etc.).
- Pixel/CAPI on admin pages, marketing site, or staff dashboards.
- ViewContent CAPI server-mirror (Pixel-only for ViewContent in v1).
- Aggregated Event Measurement (AEM) priority configuration — Meta UI setting, done in Phase 6.
- Privacy-policy copy. Disclosure obligation flagged; legal review tracked outside this plan.

---

## 2. Locked scope decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Pixel ID: env var (`META_PIXEL_ID` / `VITE_META_PIXEL_ID`) with nullable `Campaign.metaPixelId` override column | One advertiser today. Forward-compat for future agencies without committing to encrypted-token complexity now. |
| 2 | CAPI access token: env var only (`META_CAPI_ACCESS_TOKEN`) | No per-campaign tokens v1; revisit on second agency. |
| 3 | CAPI sources: web-form / QR only. Skip Retell, skip Meta Lead Ads. | No attribution chain for Retell; double-count risk for Meta Lead Ads. |
| 4 | Events: `PageView`, `ViewContent`, `Lead` only. Skip `Contact`, `CompleteRegistration`. | Conserve iOS AEM slots; quality > quantity. |
| 5 | `Lead` event fires post-OTP-verification AND post-201-response only. | Optimize ad delivery for verified leads, not raw submissions. |
| 6 | Phase 4 also persists `consent_contact` and `consent_terms` to `Prospect.sourceMetadata`. | Closes adjacent PDPA gap (form collects consent but backend drops it). sourceMetadata avoids a migration; promote to first-class columns later if audit needs require it. |
| 7 | CAPI payload includes hashed `external_id` (Prospect.id, sha256). | Strong match signal; privacy delta is small (Meta can already match via hashed email/phone). |

---

## 3. Architecture (added paths only)

### Server-side
```
POST /api/prospects
  ├─ controller extracts: req.ip, req.get('user-agent'), body.{eventId, fbp, fbc, eventSourceUrl}
  ├─ prospectService.createProspect(body, user, { meta, cookies, headers })
  │   ├─ Strip meta-fields out of body before Sequelize create
  │   ├─ Transaction: Prospect + ProspectActivity (+ existing side effects)
  │   ├─ Stash { eventId, fbp, fbc, clientIp, clientUserAgent, eventSourceUrl } in sourceMetadata
  │   ├─ COMMIT
  │   ├─ dispatchEvent('lead.created', ...)                  [existing, untouched]
  │   └─ metaCapiService.sendLeadEvent(prospect, ctx)        [new, fire-and-forget]
  │        ├─ shouldFireCapi(prospect) guard
  │        ├─ build payload (hashed em/ph, fbp/fbc/ip/ua, event_id, external_id)
  │        ├─ POST https://graph.facebook.com/v21.0/{PIXEL_ID}/events
  │        └─ Sentry-wrap + structured log; never throw
  └─ res.status(201)
```

### Client-side
```
Visit /lead-capture/:slug?fbclid=XYZ
  ├─ index.html base loader (gated; no init yet — per-campaign pixel ID is unknown)
  ├─ React boots → LeadCapture.jsx
  │   ├─ shouldTrack() guard
  │   ├─ Generate viewEventId, leadEventId on refs
  │   ├─ captureFbcFromUrl() → sessionStorage._mktr_fbc
  │   ├─ Fetch campaign
  │   └─ On campaign load:
  │       ├─ initPixel(campaign.metaPixelId || env.VITE_META_PIXEL_ID)
  │       └─ trackEvent('ViewContent', {...}, { eventID: viewEventId })
  ├─ User fills form → OTP step
  ├─ OTP verified → POST /api/prospects with body augmented with
  │   { eventId: leadEventId, fbp: readFbp(), fbc: readFbc(), eventSourceUrl: location.href }
  └─ On 201:
      └─ trackEvent('Lead', {...}, { eventID: leadEventId })
```

### File inventory

**New files:**
- `backend/src/utils/piiHashing.js`
- `backend/src/services/metaCapiService.js`
- `backend/test/piiHashing.test.js`
- `backend/test/metaCapiService.test.js`
- `backend/scripts/meta-capi-smoke.js`
- `backend/src/database/migrations/026-add-campaign-meta-pixel-id.js` *(Phase 5)*
- `src/lib/metaPixel.js`
- `src/lib/__tests__/metaPixel.test.js`

**Modified files:**
- `backend/src/controllers/prospectController.js` — capture IP/UA + body meta-fields
- `backend/src/services/prospectService.js` — strip meta-fields, stash in sourceMetadata, call `metaCapiService.sendLeadEvent`
- `backend/src/models/Campaign.js` *(Phase 5)* — add `metaPixelId` field
- `backend/src/services/campaignService.js` *(Phase 5)* — surface in serialization
- `backend/test/prospects.test.js` — extend with eventId/fbp/fbc/CAPI-dispatch assertions
- `.env.example` — add frontend + backend env vars
- `index.html` — base Pixel loader (gated)
- `src/pages/LeadCapture.jsx` — ViewContent + meta-field plumbing
- `src/components/campaigns/signup/OTPVerification.jsx` OR `src/components/campaigns/CampaignSignupForm.jsx` *(Phase 4, file TBD by tracing OTP-success → submit chain)* — fire `Lead` event

**Untouched (per scope decision #3):**
- `backend/src/services/retellService.js`
- `backend/src/services/metaLeadService.js`

---

## 4. Cross-cutting concerns

**Security**
- `META_CAPI_ACCESS_TOKEN` is server-only. Never logged, never returned in any API response. Pino redaction must cover it.
- `VITE_META_PIXEL_ID` and `Campaign.metaPixelId` are NOT secrets — embedded in page source.
- PII hashing happens server-side. Raw email/phone never leaves MKTR systems for Meta.

**Observability**
- CAPI failures → `Sentry.captureException` with tags `{ source: 'capi', event_name, prospect_id }`. Fire-and-forget contract.
- CAPI successes → `logger.info({ event_id, fbtrace_id, prospect_id }, 'capi.lead.sent')` for forensic trace.
- Sentry alert rule (Phase 6): notify on `capi.lead.failed` rate > 5% over 1h.

**Compliance**
- PDPA disclosure obligation flagged at Phase 6. Hashed PII to Meta is generally permissible under Consent + Legitimate Interest, but must be disclosed in privacy policy.
- Consent gating: `MarketingConsentDialog` already collects consent. If a prospect did not consent to marketing, strip `em`/`ph` from CAPI user_data and rely on `fbp`/`fbc`/IP/UA only. Implementation in Phase 4 (small flag check; needs the consent field source confirmed during Phase 4 step 1).

**Feature flag**
- `META_CAPI_ENABLED` boolean env. Default `false`. Set `true` in staging at Phase 2 acceptance gate; `true` in production at Phase 6 rollout.

**Performance**
- CAPI runs post-commit, fire-and-forget. Zero added latency to user-facing response.

---

## 5. Phase breakdown

Each phase is independently mergeable, has its own test gate, and a documented rollback. Do not start phase N until phase N−1's gate passes.

---

### Phase 0 — Foundations & Meta-side prerequisites

**Objective:** Validate the Meta-side setup, env-var plumbing, and verification path before writing functional code.

**Steps:**
1. (Owner) Confirm or create the Pixel in Meta Business Manager → Events Manager. Capture Pixel ID.
2. (Owner) Generate CAPI access token: Pixel → Settings → Conversions API → "Generate access token". Save in secrets manager / Render env.
3. (Owner) Generate a test event code: Pixel → Test Events → copy code.
4. (Code) Add env-var skeleton:
   - `.env.example`: `VITE_META_PIXEL_ID=` and `VITE_META_TEST_EVENT_CODE=`
   - Backend `.env.example`: `META_CAPI_ENABLED=false`, `META_PIXEL_ID=`, `META_CAPI_ACCESS_TOKEN=`, `META_TEST_EVENT_CODE=`
5. (Code) Verify or add Pino redaction for `META_CAPI_ACCESS_TOKEN`. Grep existing logger config; add token name to the redaction paths list.
6. (Code) Write `backend/scripts/meta-capi-smoke.js`: one-shot script that POSTs an empty event with `test_event_code` and asserts `events_received: 1` in the response. No DB or model dependencies.

**Tests:**
- Smoke script returns success when invoked locally with staging tokens (manual run).

**Acceptance gate:**
- All env vars defined, documented, and present (empty) in `.env.example`.
- Smoke script runs green from local shell pointing at staging.
- Pino redaction verified — run smoke, then grep stdout for the token value; must not appear.

**Rollback:** Phase 0 ships no production-path code. Revert env vars if misconfigured.

**Risks:**
- Render egress / firewall might block `graph.facebook.com`. Smoke script catches this before Phase 2 ships.

---

### Phase 1 — Server utilities (no behavior change)

**Objective:** Ship `piiHashing` + `metaCapiService` with full unit coverage. Not wired to any caller.

**New files:**
- `backend/src/utils/piiHashing.js` — `hashEmail`, `hashPhone`, `hashExternalId`
- `backend/src/services/metaCapiService.js` — `sendLeadEvent`, `shouldFireCapi`, `_buildPayload` (exported with leading underscore for test access)
- `backend/test/piiHashing.test.js`
- `backend/test/metaCapiService.test.js`

**Tests — `piiHashing.test.js`:**
- `hashEmail` returns `undefined` for `null`, `''`, `undefined`, non-string.
- `hashEmail('Shawn@MKTR.sg  ')` === `hashEmail('shawn@mktr.sg')`.
- `hashPhone('+65 8123 4567')` === `hashPhone('6581234567')` === `hashPhone('65-8123-4567')`.
- `hashPhone(null)` returns `undefined`.
- `hashExternalId(123)` === `hashExternalId('123')` (string coercion).
- Output is a 64-char hex string for all happy-path inputs.

**Tests — `metaCapiService.test.js`:**
- `shouldFireCapi`:
  - false when `META_CAPI_ENABLED !== 'true'`
  - false when `META_CAPI_ACCESS_TOKEN` absent
  - false when `META_PIXEL_ID` absent
  - false for `leadSource: 'call_bot'`
  - false when `retellCallId` present
  - false when `sourceMetadata.metaLeadgenId` present
  - true for a clean web-form prospect with all env vars set
- `_buildPayload`:
  - hashes email and phone
  - drops `user_data` keys whose values are `undefined`/`null`/`''`
  - includes `test_event_code` when env set, omits when unset
  - uses `ctx.eventId` as `event_id`
  - falls back to `prospect.sourceMetadata.fbp` when `ctx.fbp` is missing (and same for fbc/ip/ua/eventSourceUrl)
- `sendLeadEvent`:
  - returns `{ sent: false, reason: 'guarded' }` when `shouldFireCapi` false (and does NOT call fetch)
  - calls injected `deps.fetch` with the correct URL, method, JSON body, content-type header
  - returns `{ sent: true, status: 200 }` on a 200 response
  - returns `{ sent: false, status: 400 }` and calls `Sentry.captureException` on a non-200
  - catches network errors and resolves to `{ sent: false, error }` without throwing

**Test infrastructure:**
- Inject `deps.fetch` for mocking (mirror `webhookService.js` pattern).
- `jest.unstable_mockModule('@sentry/node', ...)` for Sentry mocking under ESM.
- `beforeEach`/`afterEach` snapshot/restore `process.env` for each test.

**Acceptance gate:**
- `cd backend && npm test -- piiHashing metaCapiService` → green.
- Full suite `cd backend && npm test` → green (no regression).
- Coverage on the two new files ≥ 90% lines / branches.

**Rollback:** Delete the four new files. No callers exist.

**Risks:**
- Jest ESM mocking quirks. Mitigation: copy the working pattern from `backend/test/retell.test.js`.

---

### Phase 2 — Server wiring (flag-gated)

**Objective:** Wire `metaCapiService.sendLeadEvent` into `prospectService.createProspect`. Thread the request context fields through controller → service → sourceMetadata. Gated by `META_CAPI_ENABLED`.

**Files modified:**
- `backend/src/controllers/prospectController.js` — extract `req.ip`, `req.get('user-agent')`, body `eventId`/`fbp`/`fbc`/`eventSourceUrl`, add to context object (third arg is already a context bag).
- `backend/src/services/prospectService.js`:
  - Destructure meta-fields out of incoming body before Sequelize create to avoid attribute collision.
  - Stash them in `sourceMetadata` on `Prospect.create`.
  - After existing `dispatchEvent('lead.created', ...)` near line 299, call `metaCapiService.sendLeadEvent(prospect, ctx.meta).catch(() => {})`.

**Tests (extend `backend/test/prospects.test.js`):**
- POST `/api/prospects` with `eventId`, `fbp`, `fbc` in body → assert these are persisted to `sourceMetadata` (read back via GET).
- Mock `metaCapiService.sendLeadEvent`; assert called with the expected `prospect` shape and `ctx` object.
- Mock `metaCapiService.sendLeadEvent` to reject → assert response still 201 (fire-and-forget contract).
- Defence-in-depth: assert `sendLeadEvent` would return `{ sent: false, reason: 'guarded' }` for `leadSource: 'call_bot'` (the guard test belongs in Phase 1 unit tests; this is just confirming the wire-up doesn't bypass it).

**Acceptance gate:**
- Test suite green.
- Manual: with `META_CAPI_ENABLED=true` and `META_TEST_EVENT_CODE=...` on staging, POST a test prospect → event visible in Meta Test Events within 30 s.
- With `META_CAPI_ENABLED=false`, no CAPI traffic (verify via network capture or by setting an invalid token and confirming no Sentry alerts fire).

**Rollback:**
- Operational: flip `META_CAPI_ENABLED=false`. Instant.
- Code: revert the single-line `metaCapiService.sendLeadEvent(...)` call in `prospectService.js`. Other changes (sourceMetadata stashing, controller context extraction) are additive and harmless.

**Risks:**
- Body field name collision with existing `Prospect` schema. Mitigated by explicit destructure.
- IP behind Render proxy. Mitigated by `trust proxy: 1` already set in `server_internal.js:63`.

---

### Phase 3 — Client base Pixel + ViewContent + suppression

**Objective:** Load Pixel on public lead-capture pages, fire `ViewContent` on campaign load, capture `fbclid` → `_fbc`. Strict suppression on preview/test routes.

**New files:**
- `src/lib/metaPixel.js` — `shouldTrack`, `generateEventId`, `captureFbcFromUrl`, `readFbc`, `readFbp`, `initPixel`, `trackEvent`
- `src/lib/__tests__/metaPixel.test.js`

**Files modified:**
- `index.html` — base Pixel loader, gated on `VITE_META_PIXEL_ID` being non-empty. (If Vite's `%VITE_*%` substitution in `index.html` proves unreliable, fall back to deferred init from `src/main.jsx`; verify in Phase 3 step 1.)
- `src/pages/LeadCapture.jsx`:
  - On mount: `captureFbcFromUrl()`, generate `viewEventId` + `leadEventId` on refs.
  - After campaign fetch + `shouldTrack({ campaign })`: `initPixel(campaign.metaPixelId || import.meta.env.VITE_META_PIXEL_ID)`, `trackEvent('ViewContent', {...}, { eventID: viewEventId.current })`.

**Tests — `metaPixel.test.js`:**
- `shouldTrack`:
  - false when `VITE_META_PIXEL_ID` empty
  - false on `/preview` and `/preview/*` paths (design prototypes — PreviewHub, Atelier, Aurora, Specimen)
  - false on `/LeadCapture/demo` (demo route)
  - false on `/p/:slug` (PublicPreview — QR/share preview)
  - false when `?preview=true` in querystring
  - false when `context.campaign.is_test_data` is true
  - false in non-production mode without `VITE_META_TEST_EVENT_CODE`
  - true on production `/LeadCapture` path with all conditions met
- `captureFbcFromUrl`:
  - extracts `fbclid` and returns `fb.1.{timestamp}.{fbclid}` format
  - persists to sessionStorage as `_mktr_fbc`
  - returns null when no `fbclid`
- `readFbc` returns sessionStorage value (uses `vi.stubGlobal('sessionStorage', ...)`).
- `readFbp` parses `_fbp` cookie from `document.cookie`; returns null when absent.
- `generateEventId` returns a 36-char UUID or fallback string.

**Acceptance gate:**
- `npm test -- metaPixel` green.
- `npm run build` green.
- Manual:
  1. Load `/lead-capture/{slug}?fbclid=TEST123` with `VITE_META_PIXEL_ID` + `VITE_META_TEST_EVENT_CODE` set.
  2. DevTools Network: request to `connect.facebook.net/en_US/fbevents.js` + request to `facebook.com/tr?ev=ViewContent`.
  3. `sessionStorage._mktr_fbc` populated with `fb.1.<ts>.TEST123`.
  4. Meta Test Events Manager shows ViewContent within 30 s.
- Manual suppression: load `/preview/AtelierPreview` — NO Pixel network traffic.

**Rollback:**
- Operational: clear `VITE_META_PIXEL_ID`, rebuild — Pixel inert.
- Code: revert `LeadCapture.jsx` changes; the base loader in `index.html` does nothing without an `init` call.

**Risks:**
- Vite `%VITE_*%` substitution behavior in `index.html`. Phase 3 step 1 verifies; fallback is to init from `src/main.jsx`.
- Ad-blocker blocks `fbevents.js`. Acceptable — server CAPI still fires in Phase 4.

---

### Phase 4 — Client `Lead` event + dedup contract

**Objective:** Fire `Lead` event after OTP verification AND successful prospect POST. Send the matching `eventId`, `fbp`, `fbc`, `eventSourceUrl` to the backend so CAPI uses the same `event_id`.

**Step 1 (no code yet):**
- Trace the OTP-success → form-submit chain. Identify the single point where (a) OTP is verified AND (b) `POST /api/prospects` returns 201.
- Decide: do we fire `Lead` from `OTPVerification.jsx` or `CampaignSignupForm.jsx` or `LeadCapture.jsx`? Record the decision in the phase log when complete.

**Step 1b (paired sub-task: consent persistence — Decision #6):**
- Update `backend/src/controllers/prospectController.js` to extract `consent_contact` and `consent_terms` from `req.body` and pass into the service context.
- Update `backend/src/services/prospectService.js` to stash both flags in `sourceMetadata` on `Prospect.create`.
- Update `backend/src/services/metaCapiService.js`: in `_buildPayload`, if `prospect.sourceMetadata.consent_contact !== true`, strip `em` and `ph` from `user_data`. Always keep `fbp`/`fbc`/`client_ip_address`/`client_user_agent`/`external_id` regardless of marketing consent.
- Add test cases: prospect with `consent_contact=true` → user_data has em/ph; prospect with `consent_contact=false` → user_data does NOT have em/ph but still has fbp/fbc/ip/ua/external_id.

**Files modified:**
- `src/lib/metaPixel.js` — add `trackLead(params, eventId)` convenience.
- `src/pages/LeadCapture.jsx` OR `src/components/campaigns/signup/OTPVerification.jsx` OR `src/components/campaigns/CampaignSignupForm.jsx` *(TBD by Step 1)*:
  - Augment the `POST /api/prospects` body with `eventId: leadEventId.current`, `fbp: readFbp()`, `fbc: readFbc()`, `eventSourceUrl: window.location.href`.
  - On a 201 response, `trackEvent('Lead', { content_name: campaign.name, value: 0, currency: 'SGD' }, { eventID: leadEventId.current })`.

**Tests:**
- Mock `fetch` for `POST /api/prospects` — assert request body contains `eventId`, `fbp`, `fbc`, `eventSourceUrl`.
- On 201 response, assert `window.fbq` called with `'track', 'Lead', {...}, { eventID: <known-id> }`.
- On non-201 response, assert `window.fbq('track', 'Lead', ...)` NOT called.
- Negative: when OTP not verified, assert no `Lead` fires regardless of form state.

**Acceptance gate:**
- Unit tests green.
- E2E manual on staging:
  1. Complete a full lead-capture flow with OTP.
  2. Network: Pixel `Lead` fires.
  3. Network: POST body has `eventId`, `fbp`, `fbc`.
  4. Backend logs: `capi.lead.sent` with the same `event_id`.
  5. Meta Test Events Manager: shows ONE Lead event (deduplicated) with matching `event_id`.
- E2E manual negative: failed OTP → no Lead anywhere (Pixel or CAPI).

**Rollback:** Revert client changes. Backend Phase 2 continues to function with weaker match data.

**Risks:**
- Dedup failure (event_id mismatch between Pixel and CAPI) — would double-count. Acceptance gate above explicitly requires the matching-ID verification.
- Consent-not-given case: confirm in Step 1 whether `MarketingConsentDialog` blocks the form submit. If consent is required to submit, no conditional logic needed in CAPI. If consent is optional, Phase 4 also wires the consent flag into the request body so the server-side CAPI knows to strip PII.

---

### Phase 5 — Per-campaign Pixel ID forward-compat (no behavior change without DB data)

**Objective:** Add nullable `Campaign.metaPixelId` column + migration. Surface in campaign GET response. Client and server use the override when present, fall back to env var when null.

**New files:**
- `backend/src/database/migrations/026-add-campaign-meta-pixel-id.js`

**Files modified:**
- `backend/src/models/Campaign.js` — add `metaPixelId: { type: DataTypes.STRING, allowNull: true }`.
- `backend/src/services/campaignService.js` — include `metaPixelId` in any campaign serializer the public lead-capture flow consumes. (Strip on admin-listing serializers if necessary — but it's not a secret, so probably fine to leave.)
- `backend/src/services/metaCapiService.js` — `sendLeadEvent` accepts `pixelId` override from the prospect's loaded campaign, falls back to `process.env.META_PIXEL_ID`.
- `backend/src/services/prospectService.js` — ensure `prospect.campaign` (or equivalent) is loaded before calling `sendLeadEvent` so the override is available; or query the campaign explicitly and pass through ctx.
- `src/pages/LeadCapture.jsx` — already uses `campaign.metaPixelId || env fallback` from Phase 3 (no change beyond confirming the field is in the API response).

**Migration shape:**
```javascript
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('campaigns', 'meta_pixel_id', {
    type: Sequelize.STRING(64),
    allowNull: true,
    comment: 'Per-campaign Meta Pixel ID; overrides env META_PIXEL_ID. NOT a secret — exposed in API.',
  });
}
export async function down(queryInterface) {
  await queryInterface.removeColumn('campaigns', 'meta_pixel_id');
}
```

**Tests:**
- Extend `backend/test/migrations.test.js` — assert column appears after up, disappears after down.
- Extend `backend/test/metaCapiService.test.js` — when prospect's loaded campaign has `metaPixelId` set, the override is used in the URL.
- Manual: set `meta_pixel_id` on a test campaign in DB, submit a lead, verify the event lands under that pixel rather than the env-var pixel.

**Acceptance gate:**
- Migration runs green up + down on a fresh test DB.
- All existing tests still green (column is additive and nullable).
- Override test passes.

**Rollback:** Migration `down`. Code falls back to env var (already the case for `NULL` rows).

**Risks:**
- None. Additive nullable column with no default; instant on any table size.

---

### Phase 6 — Production rollout

**Objective:** Flip the flag in production. Configure AEM. Update privacy policy. Set up alerts.

**Steps:**
1. Staging: `META_CAPI_ENABLED=true`, leave `META_TEST_EVENT_CODE` set, soak 48 h. Verify Test Events Manager volume matches expected lead volume.
2. Configure AEM in Meta Events Manager: `Lead` priority 1, `ViewContent` priority 2, `PageView` priority 3.
3. Privacy policy: add Meta Pixel + CAPI disclosure. (Document the obligation; legal review tracked outside this plan.)
4. Production: clear `META_TEST_EVENT_CODE`, set `META_CAPI_ENABLED=true`, deploy.
5. Sentry alert rule: notify when `capi.lead.failed` rate > 5 % over a 1 h window.
6. Monitor Meta Events Manager Match Quality score for 7 days. Target ≥ 7.0.

**Acceptance gate:**
- Production CAPI volume within ±5 % of expected lead volume.
- Match Quality ≥ 7.0 after 7 days.
- Zero Sentry alerts on CAPI dispatch in steady state.
- Privacy policy updated (or task tracked).

**Rollback:** `META_CAPI_ENABLED=false`. No code revert needed.

**Risks:**
- Low Match Quality: diagnose via Events Manager Diagnostics tab. Usually normalization. Triage by adding optional fields (`zip`, `city`, `country`) or fixing existing hashing.
- AEM misconfiguration suppresses iOS optimization. Re-verify in Events Manager after configuring.

---

## 6. Verification matrix

| Phase | Unit tests | Integration / smoke | Manual E2E gate |
|---|---|---|---|
| 0 | — | smoke script returns `events_received: 1` | — |
| 1 | piiHashing + metaCapiService ≥ 90 % | — | — |
| 2 | prospects.test.js extended | — | Test Events Manager shows server `Lead` event |
| 3 | metaPixel ≥ 90 % | — | Pixel `ViewContent` visible; preview routes silent |
| 4 | client form handler tests | — | One deduplicated `Lead` with matching event_id from both sides |
| 5 | migration up/down + override test | — | Override pixel routes a test campaign's events to a different pixel |
| 6 | — | Sentry alert wired | Match Quality ≥ 7.0 after 7 days production |

---

## 7. Open questions — resolved 2026-05-11

1. **Pixel provisioned?** NO. Owner action required before Phase 0 acceptance: create pixel in Meta Business Manager → Events Manager → Connect data sources → Web → Meta Pixel. Generate CAPI access token (Pixel → Settings → Conversions API → Generate access token; save once, can't view again). Generate Test Event code (Pixel → Test Events tab).
2. **Consent gating model?** Two consent fields exist in `CampaignSignupForm.jsx`:
   - `consent_terms` is REQUIRED — form submit is blocked at line 280 if false. Every prospect that reaches the backend has T&C consent.
   - `consent_contact` is OPTIONAL — marketing contact opt-in. This is the gate for CAPI PII (em/ph).
   - **Adjacent finding (not blocking, separate workstream)**: backend grep for `consent_contact` / `consent_terms` returns zero hits. The form sends both fields and `LeadCapture.jsx:143-144` forwards them, but they are dropped at Sequelize because no matching column exists on `Prospect`. Recommend a follow-up workstream to persist these (Prospect column or sourceMetadata field). NOT a blocker for this plan — Phase 4 will thread `consent_contact` through the request body alongside `eventId`/`fbp`/`fbc`, and CAPI dispatch decides at call time whether to include em/ph based on the live value.
3. **Canonical lead-capture URL?** `/LeadCapture` (react-router path with capital L, capital C). Demo at `/LeadCapture/demo`. PublicPreview at `/p/:slug`. Design prototype routes at `/preview` and `/preview/{atelier|aurora|specimen}`. All non-`/LeadCapture` routes suppressed (see Phase 3 `shouldTrack` spec).
4. **Render egress to `graph.facebook.com`?** Unknown — Phase 0 smoke script will answer this when it runs from Render. If it fails, troubleshoot then; no upfront blocker.

---

## 8. Phase log

To be appended at the end of each phase. Format:

```
### Phase N — YYYY-MM-DD
**Status:** complete | rolled-back | partial
**What shipped:** ...
**Test results:** ...
**Deviations from plan:** ...
**Followups created:** ...
```

### Phase 0 — 2026-05-12 (complete)
**Status:** complete
**What shipped (code):**
- Frontend `.env.example`: added `VITE_META_PIXEL_ID`, `VITE_META_TEST_EVENT_CODE`, plus backend-side `META_CAPI_ENABLED`, `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE` to the backend section of the unified file.
- `backend/.env.example`: added Meta Conversions API section with the four backend env vars.
- `backend/src/utils/logger.js`: extended Pino redaction `paths` to include `access_token`, `accessToken`, `meta_capi_access_token`. Existing `token` path already covered some shapes.
- `backend/scripts/meta-capi-smoke.js`: one-shot smoke script. Reads `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` + `META_TEST_EVENT_CODE`, POSTs a minimal Lead event with `test_event_code`, asserts `events_received === 1`. Exit codes documented in script header.

**Provisioning outcome:**
- Pixel ID: **`1690392415464750`** (named "MKTR Lead Capture").
- Owner: created under Shawn's **personal** ad account `act_1931760067413088`. Not yet attached to a Business Manager (see F1 below). VoxaLabs AI Business Manager rejected the create call with `error_subcode 1784018` ("Business has not accepted Pixel Terms of Service"); rather than chase that ToS prompt through Events Manager's unified Pixel/Dataset wizards (which kept routing Pixel-creation through the existing App-backed dataset `1957456775175661 "MKTR Lead Gen"`), the Pixel was created via Graph API against the personal ad account, where the ToS check was already satisfied.

**Gate (passed):**
- Smoke script ran green: `events_received: 1`, exit 0, token redacted in stdout (`access_token=[REDACTED]`).
- Manual UI verification: server-side Lead event visible in Events Manager → MKTR Lead Capture → Test Events with status **Processed**, URL `https://mktr.sg/`, `action_source: website`, all four `user_data` keys (em/ph/client_ip_address/client_user_agent) processed.

**Test event code behavior (learned in flight):**
- `test_event_code` is just a string at the API level — Meta returns `events_received: 1` for any non-empty value. But the Test Events **UI filters by the code shown in the "Copy your unique test code" panel** (per-session, rotates). The first smoke run used `TEST_MKTR_001` (arbitrary) — API accepted, UI ignored. Re-running with the UI-shown code (`TEST21092` for that session) made events visible. `META_TEST_EVENT_CODE` env will need to be the live code when Shawn manually verifies Phase 2's wire-in.

**Pino redaction half of gate (deferred to Phase 2):**
- Smoke script does its own hardcoded `[REDACTED]` string in `console.log` (line 65). The Pino redaction config in `logger.js` doesn't get exercised until something calls `logger.info/...({ access_token: ... }, ...)`. That happens in Phase 2 when `metaCapiService.sendLeadEvent` is wired through `prospectService.createProspect` and the real logger logs an outgoing CAPI call. Phase 2 manual gate will grep that log line for the literal token.

**Deviations:**
- Pixel ended up on personal ad account, not VoxaLabs AI as originally implied by the plan. Functionally identical for Phases 1–5; needs cleanup before Phase 6 production rollout.

**Followups:**
- **F1 (must close before Phase 6):** Move Pixel `1690392415464750` to VoxaLabs AI (or a future dedicated MKTR Business Manager). Requires accepting the Pixel ToS on that business first (the prompt should surface via business.facebook.com/settings → Business assets → Data sources → Pixels → Add → Add existing pixel).
- **F2 (must close before Phase 6):** After F1, generate a long-lived CAPI access token from Events Manager → Pixel → Settings → Conversions API → Generate access token. Replace the short-lived user token currently in `META_CAPI_ACCESS_TOKEN`.
- **F3 (optional):** Delete or rename the orphaned `MKTR Lead Gen` (App ID `1957456775175661`) and `MKTR_wa` (`941256445479495`) datasets in Events Manager — they were artefacts of the wizard misrouting and aren't used. Apps must be deleted from `developers.facebook.com`.

---

### Phase 1 — 2026-05-11 (complete)
**Status:** complete
**What shipped:**
- `backend/src/utils/piiHashing.js` — `hashEmail`, `hashPhone`, `hashExternalId`. SHA-256 over normalized inputs. Returns `undefined` for falsy/invalid inputs so empty-string hashes never leak into payloads.
- `backend/src/services/metaCapiService.js` — `shouldFireCapi` guard, `_buildPayload` (exported with `_` for test access), `sendLeadEvent` (fire-and-forget, Sentry-wrapped, dependency-injected fetch). Implements Decision #6 (consent-conditional em/ph) and Decision #7 (always include hashed external_id). Supports `ctx.pixelIdOverride` for Phase 5 forward-compat.
- `backend/test/piiHashing.test.js` — 16 tests covering normalization, null/empty/non-string handling, hex output shape, reference SHA-256 values.
- `backend/test/metaCapiService.test.js` — 27 tests across `shouldFireCapi` (9), `_buildPayload` (11), `sendLeadEvent` (7). Uses `jest.unstable_mockModule` for `@sentry/node` and `logger.js` (required pattern under Jest ESM).

**Test results:**
- Phase 1 suite: **43/43 passing** in 0.096s.
- Coverage instrumentation: Istanbul + Jest ESM + `--experimental-vm-modules` doesn't produce numbers (tooling limitation, unrelated to this code). Coverage by inspection: every function exercised, every branch in `shouldFireCapi` covered individually, both consent paths in `_buildPayload` covered, all four sendLeadEvent outcomes (guarded / 200 / non-2xx / network error) covered.

**Deviations from plan:**
- Initial test attempt used `jest.spyOn(Sentry, 'captureException')` — failed with "Cannot assign to read only property" because ESM module exports are frozen. Switched to `jest.unstable_mockModule()` pattern. Logger also mocked the same way to keep test output clean.
- No callers wired yet — Phase 2 work.

**Followups:**
- None. Module is ready for Phase 2 wire-in.

---

### Phase 2 — 2026-05-12 (complete)
**Status:** complete — unit tests green, manual E2E gate verified end-to-end against Meta Test Events UI

**What shipped:**
- `backend/src/controllers/prospectController.js`: extended `createProspect` to capture `req.ip`, `req.get('user-agent')`, and `req.body.{eventId,fbp,fbc,eventSourceUrl}` into a `meta` object passed as part of the third-arg context bag. No behavioural change for callers that don't post meta-fields.
- `backend/src/services/prospectService.js`:
  - New import of `sendLeadEvent` from `metaCapiService.js`, exposed via `defaultDeps.sendLeadEvent` for test DI.
  - `createProspect` signature now accepts `{ cookies, headers, meta }`; reads CAPI meta-fields from `meta` with body fallback (defence-in-depth), strips them from the body to avoid Sequelize attribute collision, and merges them into `incoming.sourceMetadata` before `Prospect.create`.
  - After the existing post-commit `dispatchEvent('lead.created', ...)`, fires `d.sendLeadEvent(prospect, capiCtx)` fire-and-forget. Logger captures any unexpected throw with `[CAPI] sendLeadEvent error` — `sendLeadEvent` itself is designed never to throw, so this is belt-and-suspenders.
- `backend/test/prospectServiceCapi.test.js` (new): 7 unit tests using the `makeProspectService` DI seam with mocked models + sequelize. Verifies sourceMetadata merge (meta-first / body-fallback), body stripping, sendLeadEvent invocation shape, fire-and-forget contract against a rejecting mock, and the no-meta-fields path.
- `backend/test/prospects.test.js`: 3 new supertest integration tests in a `Prospect CAPI meta-fields (Phase 2)` describe block. Verifies sourceMetadata persistence end-to-end, no-meta-fields still creates successfully, and no leakage of meta-fields onto Prospect attributes.

**Test results:**
- Phase 1 + Phase 2 unit suite: **50/50 passing** in 0.31s (`jest prospectServiceCapi metaCapiService piiHashing`).
- Phase 2 integration suite (in `prospects.test.js`): not run locally — requires Postgres on `localhost:5433` per `test/setup.js`. Will run on next `npm test` against a working DB.

**Deviations from plan:**
- Plan specified extending `prospects.test.js` for the unit-style mock test ("Mock `metaCapiService.sendLeadEvent`; assert called…"). Implemented as a separate `prospectServiceCapi.test.js` instead so the wire-up can be verified DB-free. The supertest integration tests in `prospects.test.js` cover the persistence + 201 contract.
- Found and fixed a real bug mid-Phase 2: first wiring read meta-fields exclusively from `body` (matching the plan's literal "destructure meta-fields out of incoming body" wording), but the controller passes them in the `meta` context. Unit test caught it; final implementation prefers `meta`, falls back to `body`. Strips body fields in both cases.

**Manual E2E gate (passed via wire-up script — full HTTP-layer deferred to staging):**
- Local env has neither Postgres nor Docker; per scope decision we used a wire-up E2E script in lieu of a true HTTP-server E2E. The skipped layers (Express middleware, dotenv loading, route-level joi validation in the live chain) are deferred to the staging deploy in Phase 6.
- `backend/scripts/meta-capi-wire-e2e.js`: imports `makeProspectService` with mocked DB models + sequelize, but uses the REAL `metaCapiService.sendLeadEvent` and REAL Pino logger. Constructs a realistic body + meta context and calls `createProspect`, then waits 3 s for the fire-and-forget CAPI dispatch.
- Run: `DB_HOST=localhost DB_USER=x DB_NAME=x DB_PASSWORD=x META_CAPI_ENABLED=true META_PIXEL_ID=1690392415464750 META_CAPI_ACCESS_TOKEN='…' META_TEST_EVENT_CODE='…' node scripts/meta-capi-wire-e2e.js 2>&1 | tee /tmp/wire-e2e.log`. (DB_HOST is a no-op placeholder — connection.js's module-load guard requires it, but the mocked deps mean Sequelize never connects.)
- Observed Pino output: `INFO: capi.lead.sent { event_id: "wire-e2e-…", events_received: 1, fbtrace_id: "AIEDM066hW5xYG1y799X5qI", prospect_id: "wire-…" }`.
- Token-leak check: `grep -cF "$META_CAPI_ACCESS_TOKEN" /tmp/wire-e2e.log` → 0. The Pino redaction config defends, and the code paths themselves don't attempt to log the token (defense in depth).
- Meta UI verification: Test Events tab showed the Lead with matching `event_id` (`wire-e2e-1778573759507`), status **Processed**, URL `https://mktr.sg/`, action_source `website`. User-data keys recognized by Meta: External ID (hashed external_id), Click ID (fbc), Browser ID (fbp), IP address, User agent. Email + Phone correctly absent because `consent_contact` is not yet persisted — this is the designed safe-default until Phase 4 wires consent.

**Validation rule update (mid-Phase 2 discovery):**
- The route's joi schema (`backend/src/middleware/validation.js:121`) doesn't allow unknown keys by default. The integration tests revealed this would 400 on the meta-fields. Added `eventId`, `fbp`, `fbc`, `eventSourceUrl` as optional string fields on `schemas.prospectCreate` (with sensible max lengths and a URI constraint on `eventSourceUrl`).

**Followups:**
- Full HTTP-layer E2E will be exercised on staging deploy in Phase 6 (as originally specified by the plan).
- Phase 4 will persist `consent_contact` and `consent_terms` to sourceMetadata. Currently the `_buildPayload` guard correctly omits em/ph because consent isn't recorded — safe-by-default.

---

### Phase 3 — 2026-05-12 (complete; manual E2E deferred to Phase 4/staging)
**Status:** complete — 34 unit tests green; production build + gate behaviour verified

**What shipped:**
- `src/lib/metaPixel.js` — pure-function utility module: `shouldTrack`, `generateEventId`, `captureFbcFromUrl`, `readFbc`, `readFbp`, `initPixel`, `trackEvent`. All SSR-safe (defensive guards for window/document/sessionStorage/crypto). `initPixel` is idempotent via a module-level Set; `trackEvent` is a thin pass-through to `fbq` with optional `eventID` for Pixel/CAPI dedup.
- `src/lib/__tests__/metaPixel.test.js` — 34 Vitest tests (jsdom env) across all branches: shouldTrack (13 cases incl. dev-mode gate, all suppression paths, allowlist), generateEventId (3), captureFbcFromUrl (4), readFbc (2), readFbp (3), initPixel (5), trackEvent (4).
- `index.html` — added Meta Pixel base loader script in `<head>`, gated on `%VITE_META_PIXEL_ID%`. Substitution verified: with env var set, becomes `var PIXEL_ID = '1690392415464750';` and loads fbevents.js; without env var, placeholder stays literal `'%VITE_…%'` and the `charAt(0) === '%'` check short-circuits → no fbevents.js network request, no Pixel state.
- `src/pages/LeadCapture.jsx` — added three refs (`viewEventIdRef`, `leadEventIdRef`, `viewContentFiredRef`), two new `useEffect`s:
  - Mount effect: generates stable event ids + `captureFbcFromUrl(location.search)`.
  - Campaign effect: once `campaign` loads + `shouldTrack({ campaign, pathname, search })` passes, resolves the pixel id (`campaign.metaPixelId || env`), calls `initPixel(...)`, then `trackEvent('ViewContent', {content_name, content_category}, { eventID })`. Fire-once via ref.

**Test results:**
- `npx vitest run src/lib/__tests__/metaPixel.test.js` → 34/34 passing in 0.5 s.
- `VITE_META_PIXEL_ID=… VITE_META_TEST_EVENT_CODE=… npm run build` → green; verified `PIXEL_ID = '1690392415464750'` in built `dist/index.html`.
- `npm run build` (no env) → green; verified `PIXEL_ID = '%VITE_META_PIXEL_ID%'` literal preserved in built `dist/index.html`, gate correctly short-circuits.

**Deviations from plan:**
- None substantive. Plan was followed; `pathname` allowlist + suppression rules match section 7 question 3.
- `generateEventId()` uses `crypto.randomUUID()` (available in modern browsers and Node 14.17+); fallback path preserved for completeness but not exercised in tests (jsdom provides crypto).

**Manual E2E gate (deferred):**
- Plan called for a manual check (load `/LeadCapture?campaign_id=…&fbclid=TEST123`, verify fbevents.js loads, sessionStorage `_mktr_fbc` populates, Meta Test Events shows ViewContent). This requires a running backend with a seeded campaign — same blocker as Phase 2's manual gate, so deferring to either (a) Phase 4 E2E once we have an integrated browser-flow test, or (b) staging deploy in Phase 6. The Vitest + build verification covers the suppression matrix and Vite substitution behaviour, which are the highest-risk pieces.

**Followups:**
- None. Per-campaign pixel id override (`campaign.metaPixelId`) is read by the component but the column doesn't yet exist on `Campaign` — that's Phase 5. The `||` fallback to `import.meta.env.VITE_META_PIXEL_ID` means Phase 3 behaviour is unaffected.
### Phase 4 — 2026-05-12 (complete; manual E2E deferred to Phase 6 staging)
**Status:** complete — 55 backend tests + 36 frontend tests green; build + gate behaviour verified.

**Step 1 (trace + decision):**
- Form flow: `CampaignSignupForm.handleSubmit` validates OTP state (`line 187`) and `consentTerms` (`line 215`) before calling `props.onSubmit(dataToSubmit)`, which is `LeadCapture.handleSubmit` (`line 166`). LeadCapture builds the request body and calls `apiClient.post('/prospects', …)`.
- **Decision: fire `Lead` from `LeadCapture.jsx`.** It already owns `leadEventIdRef` (Phase 3), holds the campaign reference for `content_name`, and is the point where the POST 201 result is observed. OTP verification is enforced upstream so any code path reaching the success branch represents a real conversion.

**What shipped (backend — consent persistence, Decision #6 paired sub-task):**
- `backend/src/middleware/validation.js` — added `consent_contact: Joi.boolean().optional()` and `consent_terms: Joi.boolean().optional()` to `schemas.prospectCreate`. Closes the adjacent PDPA gap noted in section 7 question 2 of the plan.
- `backend/src/services/prospectService.js` — extended the Phase 2 destructure block in `createProspect` to also strip `consent_contact`/`consent_terms` from `body` and merge them into `sourceMetadata`. Uses `!== undefined` so explicit `false` (user opted out) is preserved. Falls into the same `incoming.sourceMetadata` blob as the meta-fields, so a single `Prospect.create` call writes everything together.
- `backend/test/prospectServiceCapi.test.js` — 5 new tests covering: consent_contact=true persisted, consent_contact=false explicit opt-out preserved, consent fields absent → no sourceMetadata pollution, consent fields stripped from top-level Prospect attributes (no Sequelize leakage), consent merges cleanly with the existing meta-field blob.

**What shipped (frontend — Lead event + dedup):**
- `src/lib/metaPixel.js` — added `trackLead(params, eventId)` convenience: wraps `trackEvent('Lead', params, eventId ? { eventID: eventId } : undefined)`. Falls back to fbq's 3-arg form when no eventId is supplied.
- `src/pages/LeadCapture.jsx`:
  - Imports extended with `readFbc`, `readFbp`, `trackLead`.
  - `handleSubmit` body augmented with `eventId: leadEventIdRef.current`, `fbp: readFbp()`, `fbc: readFbc()`, `eventSourceUrl: window.location.href`. The existing falsy-filter strips null values from absent cookies, leaving `consent_contact: false` (which the filter correctly preserves since `false !== null && false !== undefined && false !== ''`).
  - On 201 response: `shouldTrack` re-evaluated (defence-in-depth — same logic as Phase 3), pixel id resolved (`campaign?.metaPixelId || env`), `initPixel(...)` (idempotent), then `trackLead({...}, leadEventIdRef.current)` fires with the matching eventID. Pixel + CAPI now share an event_id → Meta deduplicates.
- `src/lib/__tests__/metaPixel.test.js` — 2 new tests for `trackLead`: full path with eventID (asserts `fbq('track', 'Lead', params, { eventID })`), and fallback path without eventID (asserts 3-arg fbq form).

**Test results:**
- Backend: `npx jest prospectServiceCapi metaCapiService piiHashing` → **55/55 passing** (Phase 1: 43 + Phase 2: 7 + Phase 4: 5).
- Frontend: `npx vitest run src/lib/__tests__/metaPixel.test.js` → **36/36 passing** (Phase 3: 34 + Phase 4: 2).
- Build: `VITE_META_PIXEL_ID=… VITE_META_TEST_EVENT_CODE=… npm run build` → green. Re-verified gate behaviour with env unset: `PIXEL_ID = '%VITE_META_PIXEL_ID%'` literal preserved, gate short-circuits, no fbevents.js loads.

**Deviations from plan:**
- None substantive. The consent gate condition discussed in section 7 Q2 — "form blocks submit if `consent_terms === false`" — confirmed by reading `CampaignSignupForm.jsx:215`. So every prospect that reaches the backend has `consent_terms=true`; persisting it is redundant but cheap and useful for audit/forensics. `consent_contact` is the optional marketing-contact gate that matters for the CAPI em/ph decision.
- Decided to **always fire `Lead`** regardless of `consent_contact`. The `_buildPayload` consent gate (Phase 1) already strips em/ph when `consent_contact !== true`, so PII never leaks. The Lead conversion event itself (without PII) is legitimate to send — the user has explicitly consented to T&C and completed the form.

**Manual E2E gate (deferred to Phase 6 staging):**
- Plan called for a manual flow: complete OTP-verified submission, verify Pixel Lead fires, verify request body contains eventId/fbp/fbc, verify backend logs `capi.lead.sent` with matching event_id, verify Meta Test Events shows ONE deduplicated Lead event. Same blocker as Phases 2 + 3: no local Postgres / Docker. The Phase 2 wire-up E2E already proved the CAPI side end-to-end; the Pixel side is verified by unit tests + the gated `index.html` loader. Full HTTP-layer + dedup verification runs on staging in Phase 6.

**Risk — dedup verification deferred:**
- The dedup contract (Pixel + CAPI sharing event_id) is the highest-risk piece. Verified by inspection: `leadEventIdRef.current` is generated once on mount (Phase 3), passed in the POST body as `eventId`, persisted to `sourceMetadata.eventId`, and `metaCapiService._buildPayload` uses `ctx.eventId` (which is sourced from the same body field via `prospectService`) as `event_id`. The Pixel `trackLead` call uses the same `leadEventIdRef.current`. The chain is correct; manual gate on staging confirms in practice.

**Followups:**
- Phase 6 manual E2E: full HTTP → joi → service → CAPI + Pixel dedup check.
- F1/F2 from Phase 0 still pending (move pixel to VoxaLabs AI BM, generate long-lived CAPI access token).
### Phase 5 — 2026-05-12 (complete; manual DB-up/down + override verification deferred to Phase 6 staging)
**Status:** complete — 58 backend unit tests + 6 migration static validation tests green; no regressions in adjacent suites.

**What shipped:**
- `backend/src/database/migrations/026-add-campaign-meta-pixel-id.js` (new) — adds nullable `campaigns.meta_pixel_id VARCHAR(64)` column with `.catch(() => {})` idempotency guards matching migrations 007 / 025 style. `down()` removes the column.
- `backend/src/models/Campaign.js` — adds `metaPixelId: { type: STRING(64), allowNull: true, field: 'meta_pixel_id' }`. The `field:` mapping bridges camelCase JS ↔ snake_case DB so the API response surfaces as `metaPixelId` (what `LeadCapture.jsx` and the test fixtures already read). Verified at runtime: `Campaign.rawAttributes.metaPixelId.field === 'meta_pixel_id'`, type `VARCHAR(64)`, `allowNull: true`.
- `backend/src/services/campaignPreviewService.js` — `getPublicCampaign` attributes whitelist gains `'metaPixelId'`. Used by `/api/previews/public/:id` (campaign_id-routed lead-capture path).
- `backend/src/services/trackerService.js` — `resolveSession` campaign-load whitelist gains `'metaPixelId'`. Used by `/api/qrcodes/session` (QR-routed lead-capture path). Both public-flow endpoints now surface the override so the browser Pixel uses the per-campaign id when present.
- `backend/src/services/prospectService.js` — `createProspect` now passes `pixelIdOverride: sourceCampaign?.metaPixelId || undefined` into the `sendLeadEvent` ctx. The pre-loaded `sourceCampaign` (line 192) was already a full `findByPk` with no `attributes:` restriction, so the new column is present without further query changes. `|| undefined` (rather than `?? null`) keeps the ctx shape clean for the existing fallback (`ctx.pixelIdOverride || process.env.META_PIXEL_ID`).
- `backend/test/prospectServiceCapi.test.js` — new `describe('createProspect → per-campaign Pixel override (Phase 5)')` block with 3 tests: override-present (Campaign.findByPk returns metaPixelId → ctx.pixelIdOverride matches), override-null (metaPixelId=null on campaign → ctx.pixelIdOverride undefined), no-campaign (campaignId not supplied → ctx.pixelIdOverride undefined).

**Already in place from forward-compat:**
- `metaCapiService.sendLeadEvent` accepts `ctx.pixelIdOverride` and routes to that pixel in the URL (Phase 1; tested at `metaCapiService.test.js:285-294`).
- `LeadCapture.jsx:74,213` reads `campaign.metaPixelId || import.meta.env.VITE_META_PIXEL_ID` for both ViewContent and Lead pixel init (Phase 3).
- `campaignService.listCampaigns` / `getCampaign` use `attributes: { include: [...] }` which preserves all model columns — `metaPixelId` surfaces automatically in admin endpoints. Create/update return `campaign.toJSON()` which serializes by model field name (`metaPixelId`). No work needed there.

**Test results:**
- Phase 1+2+4+5 unit suite: **58/58 passing** (`jest prospectServiceCapi metaCapiService piiHashing`, 0.5s) — 55 baseline + 3 new Phase 5 tests.
- Migration static validation: **6/6 passing** (`jest migrations.test.js -t "static validation"`) — confirms 026 exports up/down, follows `NNN-description.js` filename pattern, no duplicate numbering. Sequence now spans 002 to 026 with 23 files (gaps 019, 020 unchanged from baseline).
- Regression check: ran `jest unit` end-to-end against `main` (stashed Phase 5) and against the branch; both show identical 4 pre-existing test-suite failures (`unit/models.test.js`, `unit/retellService.test.js`, `unit/emailService.test.js`, `unit/observability.test.js`) totalling 4 failed / 83 passed. These are stale `users.email NOT NULL` expectations + unrelated Retell HMAC + emailService redirect + AppError statusCode assertions that pre-date Phase 5. **Phase 5 introduces zero new regressions.**

**Decisions confirmed mid-Phase (in scope review with Shawn):**
- DB column `meta_pixel_id` (snake_case) + JS field `metaPixelId` (camelCase) via Sequelize `field:` mapping. Matches plan; matches frontend's existing read pattern.
- Surface the column in BOTH `getPublicCampaign` AND `resolveSession` attribute whitelists — both serve the public lead-capture page (campaign_id direct link vs QR-attributed session). Adding to only one would leave a routing-mode gap.
- No additional serializer test added — the change is a one-element attribute-list addition. Risk is low and existing public-endpoint tests would catch regressions in response shape.

**Deviations from plan:**
- Plan section 5 only called out `campaignService.js` for serializer surfacing. The two endpoints that actually serve the public lead-capture page are `campaignPreviewService.getPublicCampaign` and `trackerService.resolveSession`. Edited those instead. `campaignService` admin endpoints surface `metaPixelId` automatically via `attributes: { include: [...] }` so no change needed there.
- Plan called for a migration up/down test on a fresh DB. Local has no Postgres (environment gotcha #1) so DB-integration migration testing is deferred to Phase 6 staging like prior phases. Static validation in `migrations.test.js` confirms the file structure; the `.catch(() => {})` guards match the codebase's idempotency pattern (007, 025).

**Manual gate (deferred to Phase 6 staging):**
- Plan called for: set `meta_pixel_id` on a test campaign in DB, submit a lead, verify the event lands under that pixel rather than the env-var pixel. Requires a real DB write + two-pixel verification in Meta Events Manager. Deferring to Phase 6 staging deploy alongside the F1/F2 followups from Phase 0.

**Followups:**
- Phase 6 staging: run `node src/database/migrate.js` to apply 026 on staging; verify column exists; set a `meta_pixel_id` value on a test campaign; submit a lead; confirm CAPI dispatches to the override pixel via Test Events Manager.
- Phase 6 prerequisites still pending: F1 (move Pixel `1690392415464750` to a Business Manager + accept Pixel ToS), F2 (generate long-lived CAPI access token), F3 (clean up orphaned `MKTR Lead Gen` / `MKTR_wa` datasets).

---

### Phase 6 — 2026-05-12 (partial — 6b code shipped; 6a/6c–g operational, tracked in runbook)
**Status:** partial — code-shippable work for this phase is done; rest is operational (Meta UI, staging soak, production cutover, Match Quality monitoring) and tracked in a dedicated runbook for owner execution.

**What shipped (code, 6b — privacy disclosure):**
- `src/pages/PersonalDataPolicy.jsx` — added a new "10. Analytics and Advertising Partners" section that names Meta explicitly, describes what's shared (hashed em/ph, fbp/fbc/IP/UA), describes the dual-channel Pixel + CAPI dispatch and event_id dedup, and lists opt-out paths (don't tick the consent checkbox, off-Facebook activity controls, browser cookie blocking). Renumbered Contact Us from 10 → 11. Bumped "Last Updated" January 2026 → May 2026.
- Legal review of the disclosure copy is tracked outside this plan per the original scope. Section accurately reflects the implemented behaviour (hashed PII only, consent-gated, dual Pixel + CAPI with shared event_id).

**Runbook for the operational work:** `docs/plans/phase-6-runbook.md` (single-purpose checklist for 6a Meta-side prereqs, 6c staging deploy + 4 deferred E2E gates from Phases 2–5, 6d AEM + Sentry alert, 6e 48h soak, 6f production cutover, 6g 7-day Match Quality monitoring). Includes rollback playbook for each failure mode.

**Decisions confirmed mid-Phase (in scope review with Shawn):**
- Move Pixel `1690392415464750` to a Business Manager (preserve ID) — chosen over creating a fresh Pixel. Plan section 7 followup F1.
- Add domain verification on `mktr.sg` to Phase 6 scope — not in the original plan, but required for iOS 14+ AEM attribution. Without it, the plan's Match Quality ≥ 7.0 acceptance gate is unrealistic.
- Sentry alert: Issue Alert in Sentry UI on `tag:source = capi` exception frequency > N events/1h. Simpler than emitting a ratio metric; tune N from staging soak data. No code change required.
- Privacy policy as a new dedicated section ("10. Analytics and Advertising Partners") rather than expanding the existing generic Cookies section.

**Deviations from plan:**
- Plan's 6f4 was "Sentry alert rule: notify when `capi.lead.failed` rate > 5% over a 1h window". Sentry Issue Alerts compute frequency, not ratio. Chose count-based threshold for v1 (simpler, no code change). Plan and runbook now agree on the operational reality. If ratio-based alerting becomes important, follow-up workstream emits success+failure counters via `Sentry.metrics.increment`.
- Plan's 6a-6g sub-phases collapsed into one Phase 6 entry with a separate runbook, since the work is largely Meta UI + Render env-var changes that don't lend themselves to git-tracked execution.

**Test results:**
- No new automated tests this phase (6b is a copy change with no behaviour; existing app builds — `npm run build` would confirm but is the same surface as Phase 3 / 4 builds which were verified). Privacy text was reviewed and approved by Shawn before shipping.

**Followups (tracked in runbook):**
- 6a Pixel move + domain verify + long-lived token (owner clicks).
- 6c Staging deploy + 4 deferred E2E gates (Phase 2/3/4/5 manual verification).
- 6d AEM priorities + Sentry alert rule.
- 6e 48h staging soak.
- 6f Production env flip + smoke check.
- 6g 7-day Match Quality monitoring; close acceptance gate.
- F3 (clean up orphaned `MKTR Lead Gen` + `MKTR_wa` datasets) — still optional; included in 6a.4.

**Acceptance gate (open):**
- Production CAPI volume within ±5% of expected lead volume.
- Match Quality ≥ 7.0 after 7 days.
- Zero Sentry alerts on CAPI dispatch in steady state.
- Privacy policy updated → shipped 2026-05-12.

When the gate closes, replace this entry with a final "Phase 6 — complete" log.

