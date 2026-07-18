# Codex review — SOURCE_ATTRIBUTION_PLAN.md (v1)

_Codex gpt-5.5 (xhigh), 2026-06-12, prompt: CODEX_REVIEW_SOURCE_ATTRIBUTION_PROMPT.md, branch feat/sg-pr-gate-and-fixes._

Read-only review completed. I did not modify files.

Could not verify from repo alone: live DB schema/data or existing lead rows, Ads Manager URL parameters, actual Render deploy ordering/cache behavior/live edge rules, link-preview bot behavior in production, and external Lyfe/CSV/PDF consumers outside this repo. The repo docs describe the two static sites plus one backend, but there is no deploy manifest that proves ordering (`CLAUDE.md:11-19`).

**1. Capture Path**

Confirmed: backend `POST /prospects` already accepts `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` (`backend/src/middleware/validation.js:128`, `backend/src/middleware/validation.js:185-189`) and stashes truthy values into `sourceMetadata.utm` before Sequelize create (`backend/src/services/prospectService.js:91-119`, `backend/src/services/prospectService.js:121`). Existing test coverage locks this in (`backend/src/tests/quizProspectWiring.test.js:67-74`).

Confirmed: `LeadCapture.jsx` does not send UTM today. Its Meta import list has no UTM helper (`src/pages/LeadCapture.jsx:14-24`), and `basePayload` only includes contact fields, consent, lead source, IDs, Meta fbp/fbc/event URL, and quiz result (`src/pages/LeadCapture.jsx:191-217`).

Confirmed: spreading `readUtms()` into `basePayload` would preserve key names. The filter uses `Object.entries` / `Object.fromEntries` and only drops `null`, `undefined`, and empty-string values, except empty `lastName` (`src/pages/LeadCapture.jsx:219-223`).

**nice-to-have** — Mount-time session capture is sound for the quiz gate/re-render case because the existing fbc capture runs once on mount (`src/pages/LeadCapture.jsx:47-52`) and the quiz/form remain inside the same page state (`src/pages/LeadCapture.jsx:333-340`). It will not capture UTM changes if the SPA changes only `location.search` without remounting; mirror the `_mktr_fbc` pattern only if that limitation is acceptable.

**2. Detection Soundness**

Confirmed: `fbc` is only created from `fbclid` (`src/lib/metaPixel.js:54-62`). `fbp` is not ad evidence: `ensureFbp()` returns or mints `_fbp` for tracked visitors (`src/lib/metaPixel.js:94-105`) and `LeadCapture` calls it for eligible tracked page views (`src/pages/LeadCapture.jsx:59-65`).

**blocker** — The plan’s fbc/fbclid fallback is “Meta click” evidence, not “Meta ad” evidence. Any Facebook/Instagram organic share or manually tagged URL with `fbclid`/`utm_source=facebook` would be labeled `META AD` under §2e, even though `leadSource` would otherwise be just `website`/`referral` (`src/pages/LeadCapture.jsx:186`, `src/pages/LeadCapture.jsx:202`). Recommendation: label fbc/fbclid-only rows as `META CLICK` or require paid UTM evidence for `META AD`.

**should-fix** — `eventSourceUrl` is reliable only when the SPA sends it. The client sends current `window.location.href` (`src/pages/LeadCapture.jsx:210`), but the server fallback is just `{proto}://{host}/LeadCapture` with no query string (`backend/src/controllers/prospectController.js:10-15`). A Meta lead can be missed if the client omits `eventSourceUrl`, the ad/link strips `fbclid`, or a Meta ad targets a `/share/{slug}` URL whose request query is discarded when redirecting to stored `targetUrl` (`backend/src/controllers/shortlinkController.js:30`).

**3. List Payload**

Confirmed: the list endpoint can render attribution without N+1 detail fetches. `listProspects` has no `attributes` whitelist on the Prospect row (`backend/src/services/prospectService.js:880-899`), the controller returns the service result directly (`backend/src/controllers/prospectController.js:18-24`), and the frontend entity client returns paginated `response.data` intact (`src/api/client.js:386-392`).

**should-fix** — This is not admin-only at the API layer. The route is authenticated but not `requireAdmin` (`backend/src/routes/prospects.js:23-27`), and agents are scoped to assigned leads (`backend/src/middleware/prospectScope.js:10-19`). Because list rows include full `sourceMetadata`, agents can receive fbp/fbc/IP/UA/consent/utm metadata (`backend/src/services/prospectService.js:109-118`), Meta native raw fields (`backend/src/services/metaLeadService.js:240-248`), and Retell call metadata (`backend/src/services/retellService.js:261-270`). Prefer a minimal list serializer or derived `sourceAttribution` shape.

**4. normalizeProspect Consumers**

Confirmed: adding `ad`, `referral`, and `sourceMetadata` to `normalizeProspect` is structurally backward-compatible because current consumers read existing keys (`src/utils/normalizeProspect.js:28-50`). `AdminProspects` uses `prospect.source` for the Source cell (`src/pages/AdminProspects.jsx:391-394`) and CSV/PDF export (`src/pages/AdminProspects.jsx:161-175`).

**should-fix** — Rendering will be inconsistent unless more surfaces are updated. `MyProspects` displays raw `prospect.leadSource` (`src/pages/MyProspects.jsx:253-255`), `AdminAgentDetail` displays raw `prospect.leadSource` (`src/pages/AdminAgentDetail.jsx:257-260`), and `ProspectDetails` header prefers `details.leadSource` over normalized source (`src/components/prospects/ProspectDetails.jsx:130`). The plan’s detail rows help, but the visible badges will still say `WEBSITE`/`FORM`.

**nice-to-have** — Tests must be updated because `AdminProspects.test.jsx` mocks `normalizeProspect` and currently returns only `source`, not `ad`/`referral`/`sourceMetadata` (`src/pages/__tests__/AdminProspects.test.jsx:67-78`).

**5. Referral Loop**

Confirmed: `&ref={uuid}` survives the shortlink path without schema/controller changes. The dialog posts `targetUrl: longShareUrl` and re-mints on `[open, longShareUrl, campaignId]` (`src/components/campaigns/ShareCampaignDialog.jsx:17-41`); `targetUrl` is TEXT (`backend/src/models/ShortLink.js:15-18`), guarded only by path/host (`backend/src/services/shortlinkService.js:53-67`), stored verbatim (`backend/src/services/shortlinkService.js:72-79`), and redirected verbatim (`backend/src/controllers/shortlinkController.js:30`).

Confirmed: current share URL is only `ref=1` (`src/pages/LeadCapture.jsx:298-301`), inbound `ref`/`refshare` already mark a submit as `referral` (`src/pages/LeadCapture.jsx:171-186`, `src/pages/LeadCapture.jsx:202`), and the current submit does not forward any ref identity (`src/pages/LeadCapture.jsx:191-217`).

Confirmed: I found no current production QR/campaign-copy producer that appends `ref=`. Campaign copy uses only `customerLeadCaptureUrl(campaignId)` (`src/pages/AdminCampaigns.jsx:95-99`), QR redirects emit `campaign_id` plus `slug` (`backend/src/services/trackerService.js:98-102`), and generated QR links are `/t/{slug}` (`backend/src/services/qrCodeService.js:176-178`). `customerLeadCaptureUrl` can accept extra params, but current verified caller does not pass any (`src/lib/brand.js:58-65`).

**should-fix** — Existing hand-made `?ref=anything` links already change `leadSource` to `referral`; the new server logic would additionally store arbitrary non-UUID `ref` values if implemented as planned. Keep raw `ref` storage bounded and only attach referral metadata when `leadSource === 'referral'`.

**6. Server Resolve + Stash**

**should-fix** — The merge point is safe only if implemented exactly as planned. `referralRef` must be added to the strip destructure before `bodyWithoutMeta` (`backend/src/services/prospectService.js:99-107`) so it cannot reach `Prospect.create` (`backend/src/services/prospectService.js:381-383`). Add a test for that.

Confirmed: the explicit-campaign/QR guard only deletes `qrTagId`, `attributionId`, and `sessionId`; it does not touch `sourceMetadata` (`backend/src/services/prospectService.js:159-170`). The later quiz merge preserves existing metadata (`backend/src/services/prospectService.js:297`). So `sourceMetadata.referral` will not be overwritten if it is merged before the quiz block.

**should-fix** — The lookup must be wrapped in `try/catch`. Any uncaught referrer lookup failure before `Prospect.create` would block lead creation (`backend/src/services/prospectService.js:381-383`), violating the stated non-blocking requirement.

**7. Deploy Window**

Confirmed: unknown keys 400. `validate()` calls Joi without `stripUnknown` or `allowUnknown` (`backend/src/middleware/validation.js:4-7`), `POST /prospects` applies that schema (`backend/src/routes/prospects.js:27`), and the test suite explicitly expects unknown keys to reject (`backend/src/tests/quizLeadValidation.test.js:3-5`, `backend/src/tests/quizLeadValidation.test.js:25-28`).

**should-fix** — The “new SPA + old API is unreachable” argument is not airtight. The repo documents two Render static sites plus one backend from the same repo (`CLAUDE.md:11-19`), but does not prove deploy ordering. A new redeem SPA can create a `ref={uuid}` link after a successful first submit, while an old backend would reject the referred visitor’s later `referralRef`. Cached old bundles are the opposite failure mode: they would submit successfully but silently lose referral identity because old `LeadCapture` reads `ref` but never sends `referralRef` (`src/pages/LeadCapture.jsx:185-217`). Ship backend validation/strip/no-op support first, then frontend.

**8. Abuse / Privacy**

**should-fix** — Strip `sourceMetadata` from the public create response. The public route is unauthenticated (`backend/src/routes/prospects.js:26-27`), the controller returns the created prospect object (`backend/src/controllers/prospectController.js:57-60`), and Prospect IDs are UUIDv4 (`backend/src/models/prospect.js:5-8`). UUID guessing is impractical, but any known/forwarded UUID could cause the server to copy another prospect’s name into `sourceMetadata.referral` and echo it to the submitter. Return only the new prospect ID needed for sharing.

**9. Open Questions**

1. **should-fix** — Attach referral metadata only when `leadSource === 'referral'` and `referralRef` is present. The client’s own referral decision is `ref`/`refshare`-based (`src/pages/LeadCapture.jsx:185-202`), and the API is public (`backend/src/routes/prospects.js:26-27`).

2. **should-fix** — Cross-campaign referrals should store `{ ref, referrerProspectId, sameCampaign:false }` but not `referrerName`. The lookup can compare campaign IDs as planned because Prospect has `campaignId` (`backend/src/models/prospect.js:168-175`).

3. **nice-to-have** — Generalize `deriveAd` internally by `utm_source`, but only render `META AD` for Meta sources. The backend already preserves non-Meta UTM like TikTok (`backend/src/tests/quizProspectWiring.test.js:67-74`).

4. **should-fix** — Keep CSV/PDF `Source` enum stable and add a separate `Source Detail`/`Attribution` column unless external consumers confirm they tolerate `META AD — campaign`. Current export has one `Source` column from `p.source` (`src/pages/AdminProspects.jsx:161-175`).

5. **nice-to-have** — Use last-touch UTM persistence. It matches existing session attribution ordering by `lastTouchAt DESC` (`backend/src/services/prospectService.js:128-135`).

6. **should-fix** — Hover-only is not enough. Mobile AdminProspects cards do not render source at all today (`src/pages/AdminProspects.jsx:451-453`), so add a compact source/referral line there as well as the detail rows.

7. **should-fix** — Yes, stop echoing public `sourceMetadata`; return `{ id }` or a minimal prospect shape. Current response echoes the full created row (`backend/src/controllers/prospectController.js:57-60`).