# Phase 6 Runbook — Meta CAPI Production Rollout

**Owner:** Shawn
**Companion to:** `meta-tracking-implementation.md` section 5 → Phase 6.
**Last updated:** 2026-05-12

This runbook is a flat checklist for the production rollout. Phase 1–5 code is complete on `main` (uncommitted). The 6b privacy-policy section is shipped as part of the same uncommitted change. Everything below is procedural — Meta UI clicks, Render env-var changes, staging verification, observation windows.

If anything below diverges from the plan, the plan wins. Log deviations into section 8 of the plan when the phase closes.

---

## 6a — Meta-side prerequisites

Owner-only. Sequence matters: domain verification can run in parallel with the Pixel move, but the long-lived CAPI token can only be generated **after** the Pixel is on a Business Manager.

### 6a.1 — Move Pixel `1690392415464750` to a Business Manager

Background: the Pixel sits on personal ad account `act_1931760067413088` because the prior BM ToS check failed with `error_subcode 1784018`.

1. Decide which BM owns this Pixel: VoxaLabs AI or a new MKTR BM. (Existing decision: VoxaLabs AI unless Shawn creates a dedicated MKTR BM in the meantime.)
2. Visit https://business.facebook.com/settings → **Brand Safety** → **Data Sources** → **Pixels** → **Add** → **Add existing pixel**.
3. If a Pixel ToS modal appears, accept it for the BM. This is what failed the first time around; it should now surface here.
4. Enter Pixel ID `1690392415464750`. Confirm.
5. Verify on Events Manager (https://business.facebook.com/events_manager2) that the Pixel now appears under the BM's data sources.

Success: Pixel ID unchanged (`1690392415464750`), owner column shows the BM, not the personal ad account.

### 6a.2 — Verify mktr.sg in the Business Manager

Required for iOS 14+ Aggregated Event Measurement attribution. Without this, Lead events from iOS users won't attribute to ad campaigns and Match Quality will be capped.

1. Events Manager → **Brand Safety** → **Domains** → **Add** → enter `mktr.sg`.
2. Choose a verification method:
   - **DNS TXT record** (recommended for production domains — survives platform changes).
   - **HTML meta tag** in `<head>` (would require a code change in `index.html`).
   - **HTML file upload** to `/.well-known/` (would require a code change to serve the file).
3. If DNS TXT: copy the `meta-domain-verification=...` value, add it as a TXT record on the `mktr.sg` zone (Vercel DNS or wherever it lives), then click **Verify** in Meta. Propagation can take up to 72h but is typically minutes.
4. Confirm the domain shows **Verified** in Meta's Domains list.

Success: `mktr.sg` listed as verified under the BM.

### 6a.3 — Generate long-lived CAPI access token

Replaces the current short-lived Graph API Explorer token in `META_CAPI_ACCESS_TOKEN`.

1. Events Manager → Select Pixel `MKTR Lead Capture` → **Settings** → **Conversions API** → **Generate access token**.
2. **Copy the token immediately and save in your password manager.** It is not retrievable later — only re-generable.
3. Update Render staging env var `META_CAPI_ACCESS_TOKEN` to this value.
4. (Defer production env update to 6f.)

Success: token stored in password manager + Render staging.

### 6a.4 — Clean up orphaned datasets (F3)

Optional but reduces confusion.

1. Events Manager → identify `MKTR Lead Gen` (App ID `1957456775175661`) and `MKTR_wa` (`941256445479495`) datasets.
2. If they have any traffic, ignore them (someone or something is using them — investigate first).
3. If they have zero traffic and zero events, delete via Events Manager UI. The Apps require deletion from https://developers.facebook.com (Settings → Basic → Delete App at the bottom).

Success: no stray datasets named MKTR-anything besides `MKTR Lead Capture`.

### 6a.5 — Capture a fresh Test Event code

The Test Event code rotates per session. Pull a fresh one for the staging soak.

1. Events Manager → Pixel `MKTR Lead Capture` → **Test Events** → copy the value shown under "Copy your unique test code".
2. Update Render staging env vars:
   - `META_TEST_EVENT_CODE=<copied value>`
   - `VITE_META_TEST_EVENT_CODE=<copied value>`

Success: both env vars set to the same fresh code.

---

## 6c — Staging deployment + deferred E2E gates

Prereq: 6a.1 + 6a.3 + 6a.5 complete (6a.2 domain verification can lag; doesn't block staging).

### 6c.1 — Deploy + verify migration

1. Commit and push the Phase 1–6 branch to a deploy branch tracked by Render staging (per existing deploy workflow).
2. After deploy boots, tail Render logs and grep for `Migration applied: 026-add-campaign-meta-pixel-id.js`. The migration runs automatically via `backend/src/database/bootstrap.js:33`.
3. Sanity check via Render shell (or psql):
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name='campaigns' AND column_name='meta_pixel_id';
   ```
   Expect: `meta_pixel_id`, `character varying`, `YES`.

### 6c.2 — Confirm staging env vars

On Render staging, confirm all five vars are set:
- `META_CAPI_ENABLED=true`
- `META_PIXEL_ID=1690392415464750`
- `META_CAPI_ACCESS_TOKEN=<long-lived from 6a.3>`
- `META_TEST_EVENT_CODE=<fresh code from 6a.5>`
- `VITE_META_PIXEL_ID=1690392415464750`
- `VITE_META_TEST_EVENT_CODE=<same as backend>`

### 6c.3 — Gate 1: Phase 2 (server CAPI dispatch via real HTTP)

```bash
# Replace HOST + TOKEN with staging values
HOST=https://<staging-host>
TOKEN=<admin JWT>
CAMPAIGN_ID=<existing campaign id>

curl -i -X POST "$HOST/api/prospects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: phase6-gate1/1.0" \
  -d "{\
    \"firstName\":\"Phase6\",\"lastName\":\"Gate1\",\
    \"email\":\"phase6-gate1@test.mktr.sg\",\
    \"phone\":\"+6588880001\",\
    \"leadSource\":\"website\",\
    \"campaignId\":\"$CAMPAIGN_ID\",\
    \"consent_terms\":true,\"consent_contact\":true,\
    \"eventId\":\"gate1-$(date +%s)\",\
    \"fbp\":\"fb.1.$(date +%s).gate1\",\
    \"fbc\":\"fb.1.$(date +%s).gate1fbclid\",\
    \"eventSourceUrl\":\"https://mktr.sg/LeadCapture\"\
  }"
```

Verify:
- Response: `201` with `success: true`.
- Render logs within 5s: `INFO ... capi.lead.sent { event_id: 'gate1-…', events_received: 1, fbtrace_id: '…', prospect_id: '…' }`.
- Events Manager → Pixel → Test Events: a `Lead` event with the `gate1-…` event_id appears within 30s, status **Processed**, `action_source: website`, user_data fields recognised: External ID, Email, Phone, Click ID, Browser ID, IP, User Agent (all 7 because `consent_contact:true`).

Fail-fast: if no log line, check `META_CAPI_ENABLED=true`. If 400 in log, check token validity.

### 6c.4 — Gate 2: Phase 3 (browser Pixel + suppression)

1. Browser → load `https://<staging-host>/LeadCapture?campaign_id=<test campaign id>&fbclid=TEST123`.
2. DevTools → Network → filter `facebook`. Verify:
   - GET to `https://connect.facebook.net/en_US/fbevents.js` (the loader).
   - POST to `https://www.facebook.com/tr/` with form-encoded fields including `ev=ViewContent`.
3. DevTools → Application → Storage → Session Storage: `_mktr_fbc` populated with `fb.1.<unix-ms>.TEST123`.
4. Events Manager → Test Events: a `ViewContent` event appears within 30s.
5. **Suppression check**: load `https://<staging-host>/preview/AtelierPreview` (or any `/preview/*` route). DevTools Network should show **no** request to `connect.facebook.net` and **no** `tr?ev=…` requests.

### 6c.5 — Gate 3: Phase 4 (Pixel + CAPI dedup)

This is the highest-risk gate. It proves the entire chain.

1. Browser → load `https://<staging-host>/LeadCapture?campaign_id=<test campaign id>&fbclid=GATE3FBCLID`.
2. Complete a real form submission:
   - First name, last name, email, phone, etc.
   - Phone OTP — complete the SMS verification flow.
   - Tick **both** consent checkboxes.
   - Submit.
3. DevTools Network → find the `POST /api/prospects` request → expand request body:
   - Verify `eventId` is present and looks like a UUID.
   - Verify `fbp` looks like `fb.1.<unix-ms>.<random>`.
   - Verify `fbc` looks like `fb.1.<unix-ms>.GATE3FBCLID`.
   - Verify `consent_contact: true`, `consent_terms: true`.
4. DevTools Network → find the Pixel `tr?ev=Lead` request → expand its body → confirm a query parameter `eventID` (note camelCase capital `ID`) matches the `eventId` from step 3.
5. Render logs: `capi.lead.sent` line with `event_id` matching the same UUID.
6. Events Manager → Test Events: a `Lead` event with that event_id appears with a **"Deduplicated"** badge — Meta has matched the Pixel-side and CAPI-side reports of the same event into one record.

If the badge is missing and there are two separate `Lead` events with different event_ids, the dedup is broken. Most likely cause: the Pixel-side `eventID` differs from the backend-side `event_id`. Trace `leadEventIdRef.current` in `LeadCapture.jsx` — it should be generated once on mount and used in both the POST body and the `trackLead` call.

### 6c.6 — Gate 4: Phase 5 (per-campaign Pixel override)

Need a second Pixel for this. Either reuse a sandbox Pixel from another property, or create a throwaway one for this test.

1. Create or identify second Pixel ID `<OVERRIDE_PIXEL>`. Generate a CAPI access token for it (this is for verification only — won't need it after Gate 4 passes).
2. Pick a test campaign that isn't carrying real leads. Note its UUID as `<TEST_CAMPAIGN_ID>`.
3. Set the override via SQL on the staging DB:
   ```sql
   UPDATE campaigns SET meta_pixel_id='<OVERRIDE_PIXEL>' WHERE id='<TEST_CAMPAIGN_ID>';
   ```
4. Run a `curl` like Gate 1, but with `campaignId: '<TEST_CAMPAIGN_ID>'` and a unique `eventId`.
5. Verify: Events Manager → switch to `<OVERRIDE_PIXEL>` → Test Events → the event appears under the override pixel, NOT under `MKTR Lead Capture`.
6. Cleanup:
   ```sql
   UPDATE campaigns SET meta_pixel_id=NULL WHERE id='<TEST_CAMPAIGN_ID>';
   ```

---

## 6d — AEM + Sentry alert

### 6d.1 — Configure AEM priorities

1. Events Manager → Pixel `MKTR Lead Capture` → **Aggregated Event Measurement** → **Configure Web Events**.
2. Add the verified `mktr.sg` domain (from 6a.2).
3. Set event priorities:
   - Slot 1: `Lead`
   - Slot 2: `ViewContent`
   - Slot 3: `PageView`
4. Save. Meta warns this takes ~24h to propagate.

### 6d.2 — Configure Sentry alert rule

In Sentry UI (https://sentry.io/organizations/<org>/alerts/rules/):

1. Click **Create Alert Rule** → **Issue Alert**.
2. **Environment:** staging (configure production later with the same rule).
3. **When**:
   - **An event is captured** with `tag:source` equal to `capi`.
4. **If**:
   - **The issue's frequency** is greater than **5** events in **1 hour**.
   (Tune from staging soak observation — start at 5, adjust if noisy.)
5. **Then**:
   - **Send a notification** to Shawn's email / Slack.
6. Name the rule: `CAPI Lead dispatch failures spike`.
7. Save.

Repeat for production environment after 6f.

---

## 6e — 48h staging soak

Observe but don't intervene unless something breaks.

Check daily:
1. Events Manager → Test Events: Lead volume should match real form-submit volume on staging (probably near zero if staging has no organic traffic; you can self-test 2-3x/day to keep the signal moving).
2. Render logs grep: `capi.lead.sent` count vs `capi.lead.failed` + `capi.lead.error` count. Failure rate should be < 5%.
3. Sentry: zero alerts triggered (or only known transient issues).
4. Browser self-check on staging `/LeadCapture` once a day — Pixel still loads, fbevents.js still 200s, sessionStorage `_mktr_fbc` still populates.

Success after 48h: zero unexplained failures, zero Sentry pages, dedup badge present on every test Lead.

If soak fails: don't proceed to 6f. Diagnose first.

---

## 6f — Production cutover

Prereq: 6e passed.

### 6f.1 — Production env vars

On Render production, set:
- `META_CAPI_ENABLED=true`
- `META_PIXEL_ID=1690392415464750`
- `META_CAPI_ACCESS_TOKEN=<long-lived token>` (same as staging is OK — Meta tokens aren't environment-scoped)
- `META_TEST_EVENT_CODE=` ← **explicitly unset** (or remove the env var). Production must not use Test Events filter.
- `VITE_META_PIXEL_ID=1690392415464750`
- `VITE_META_TEST_EVENT_CODE=` ← **explicitly unset**

### 6f.2 — Deploy

Push the same branch to production. Migration 026 auto-applies. Verify via the same SQL check from 6c.1.

### 6f.3 — Smoke after deploy

Within 30 minutes:
1. Open Events Manager → Pixel → **Overview** (not Test Events) → confirm Lead events are arriving from real form submissions.
2. Check Sentry production for any `source: capi` exceptions.
3. Self-submit one real lead (with a real consent ticked) and verify it appears in Events Manager Overview within ~1 min.

If anything looks wrong: **rollback by flipping `META_CAPI_ENABLED=false` on production** and redeploy. The Pixel will continue firing browser-side (it's gated on `VITE_META_PIXEL_ID`); only CAPI server dispatch turns off.

To kill the browser Pixel too: also unset `VITE_META_PIXEL_ID` and redeploy. The `index.html` loader short-circuits when the placeholder isn't substituted.

---

## 6g — 7-day Match Quality monitoring

1. Events Manager → Pixel → **Match Quality** tab. Match Quality score updates daily; needs ≥ 3 days of data to stabilize.
2. Target: ≥ 7.0 by day 7.
3. If < 7.0:
   - Events Manager → **Diagnostics**. Common warnings:
     - "Low match rate on email" → check phone/email normalization in `backend/src/utils/piiHashing.js`.
     - "Missing fbp/fbc on X%" → check whether ad-blockers or third-party-cookie blockers are dropping fbp; the server-side IP+UA should still attribute.
     - "Domain not verified" → re-check 6a.2.
   - Match Quality improvement levers (in order of effort): verify domain (done in 6a.2), confirm Aggregated Event Measurement is configured (6d.1), add optional fields (`zip`, `city`, `country`) to `_buildPayload` in `metaCapiService.js` — would require a small code change.

Acceptance gate per plan section 5:
- Production CAPI volume within ±5% of expected lead volume.
- Match Quality ≥ 7.0 after 7 days.
- Zero Sentry alerts on CAPI dispatch in steady state.
- Privacy policy updated (shipped in 6b — done).

When the gate passes, append the Phase 6 entry to section 8 of the main plan.

---

## Rollback playbook

Each rollback is reversible.

| What broke | Action | Effect |
|---|---|---|
| CAPI throwing exceptions in production | Set `META_CAPI_ENABLED=false` on Render production, redeploy | CAPI off. Pixel still fires. Conversion data continues server-side **not** going to Meta. |
| Pixel itself misbehaving (e.g. CSP block, fbevents.js error) | Unset `VITE_META_PIXEL_ID` on Render production, redeploy | Pixel loader short-circuits in `index.html`. Server CAPI keeps running (if flag is true). |
| Migration 026 breaks deploy | Run `node src/database/migrate.js` against the staging DB to confirm; if it fails, revert to a deploy before migration 026 | Schema rolls back. Code still works because `metaPixelId` field on the Sequelize model is nullable — accessing `campaign.metaPixelId` on a row from a pre-migration table returns `undefined`. |
| Match Quality stuck below 7.0 with no obvious diagnostic | Tune `_buildPayload` to add zip/city/country (would require Prospect schema changes — separate workstream) | Higher match rate. |
