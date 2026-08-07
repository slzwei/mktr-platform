# Connect Facebook — self-serve agent onboarding (v2, post-codex)

**Status: REVIEWED DESIGN — build from this.** v1 verdict: "should not start
unchanged" (8 areas). v2 folds in every finding. Green-lit by Shawn
2026-08-07; the ONE gate that stays human is the Tech Provider submission.
Foundation: the live Meta pipe (`docs/plans/meta-lead-ads-native-pipe.md`).

## 0. Constraints (recon + review, verified)

- App side is OTA-only: `Linking.openURL` + existing `mktrleads://` scheme +
  broker polling (HitPay precedent). NO new native deps, no scheme changes.
- Brokers: signed raw-body POST to `/api/external/*` — body `timestamp`,
  ≤5 min age, ≤2 min future skew, `X-Webhook-Signature: sha256=<hex>`
  (`externalBillingController.js:40` is the reference). Shared HMAC
  middleware gets EXTRACTED, not copied a fourth time.
- Graph work NEVER runs synchronously inside a public GET — the callback
  enqueues; a worker provisions (the leadgen-inbox lesson, reused).
- `meta_form_mappings` POST is create-only (409 on dup) — provisioning uses
  service-level idempotent upserts, not the admin HTTP surface.
- QR creation via `qrCodeService` (phone-lookup, caller-owned) is NOT
  reusable here — a trusted internal `ensureMetaAgentQr()` is new work.
- `Meta — Agent Ads` exists only as data (created 2026-08-07, id
  `6ff250ab-…`) — bootstrap must ensure/validate it like `[Meta] Unmapped`:
  active + `is_active` + `enforceLeadQuota=false` + `leadPriceCents` null
  (either quota trigger must be off for "agents pay with ad spend").

## 1. Data model — a real connection entity (migrations 116+)

### `meta_agent_connections` — the state machine row

| column | notes |
|---|---|
| id UUID PK | |
| userId UUID NOT NULL FK users ON DELETE RESTRICT | LOCAL identity is ownership; `mktrLeadsId` is only the lookup key at start-time |
| agentMktrUserId STRING | audit snapshot of the app-side id |
| status | `awaiting_callback → provisioning → needs_page_selection → waiting_for_agent → connected → reauth_required → disconnected → failed` |
| statusDetail TEXT | taxonomy code + redacted context |
| fbUserIdAppScoped STRING | Meta app-scoped user id — required to service deauth/data-deletion callbacks |
| pageId STRING NULL | set on selection; UNIQUE WHERE status='connected' (one active connection per page) |
| metaPageRowId UUID NULL FK meta_pages | |
| qrTagId UUID NULL / formId STRING NULL / mappingId UUID NULL | step receipts |
| stateNonce STRING UNIQUE | single-use; consumed at callback |
| attempts INT / nextAttemptAt / lastError (redacted) | worker backoff, leadgen-inbox pattern |
| grantedScopes JSONB / pageTasks JSONB / leadsAccessOk BOOL | validation receipts |
| tokenExpiresAt / dataAccessExpiresAt / lastTokenCheckAt | health probe fields |
| connectedAt / disconnectedAt / disconnectReason | lifecycle |
| createdAt/updatedAt (DB defaults) | |

Partial unique: one row per user WHERE status IN
('awaiting_callback','provisioning','needs_page_selection',
'waiting_for_agent','connected','reauth_required') — 1:1 v1 (one active
connection per agent AND per page).

### `meta_pages` deltas (migration)

`accessTokenEnc` → NULLABLE (disconnect wipes the token; the inactive row
stays as a tombstone DENY — deleting it would re-arm the env fallback);
add `connectionId UUID NULL`, `connectedVia STRING NULL`. Page tokens ONLY
are stored (no user token in v1 — smaller blast radius; long-lived page
tokens from a long-lived-user exchange, but treated as REVOCABLE, see §6).

## 2. Flow — enqueue, provision, select, connect

### 2.1 `start` (broker EF `mktr-agent-facebook`, action `start`)

EF: JWT + live-row gate (403 `not_linked` WITHOUT calling the platform);
signed POST → platform `/api/external/facebook-connect` `{action:'start',
timestamp, requestId, agentMktrUserId}` (EF injects the id — app body never
controls it). Platform: resolve `users.mktrLeadsId = agentMktrUserId` — on
miss, trigger a targeted mirror sync once; still missing → 503
`agent_sync_pending` (NOT `not_linked`). On hit: create/reuse the
connection row (`awaiting_callback`, fresh `stateNonce`), return
`{startUrl}` where state is **OPAQUE** — the nonce only; everything else
lives server-side on the row. Dialog URL built from centralized config:
`META_APP_ID` + `FB_LOGIN_CONFIG_ID` + `META_GRAPH_API_VERSION` (ONE
validated setting — env.example still says v21 elsewhere; unify) +
`redirect_uri = https://api.mktr.sg/api/meta/oauth/callback`.

### 2.2 `GET /api/meta/oauth/callback?code&state` (public, declared, rate-limited)

Does the MINIMUM: look up connection by nonce (single-use — consume
atomically), stash `code` on the row, flip to `provisioning`, kick the
worker, **302 to the HTTPS completion page** — never Graph work inline, and
the redirect carries NOTHING but a coarse status (no page names, no
details: URLs leak via history/referrers). Error dialogs (user denied etc.)
→ `failed` with taxonomy, same redirect shape.

Completion page: `https://redeem.sg/fb-connected` (tiny static page):
"Return to the MKTR Leads app" **button** (`mktrleads://facebook`) +
manual instructions — because a direct 302 to a custom scheme is unreliable
on Android browsers, and another app could squat the scheme. The deep link
is ONLY a "go refresh" prompt; the app renders state exclusively from the
authenticated broker.

### 2.3 Provisioning worker (SKIP LOCKED claims, fenced, backoff — the inbox pattern)

Per `provisioning` row: code→token→long-lived exchange (with
`appsecret_proof`), fetch `/me` (store `fbUserIdAppScoped`), paginate
`/me/accounts` FULLY. Then:

- 0 pages → `failed: no_pages`.
- ≥2 pages → `needs_page_selection` (store the candidate list server-side;
  the app screen shows it; broker action `select_page` — signed, validates
  the choice against the stored list — resumes provisioning).
- exactly 1 → auto-select.

For the selected page, VALIDATE before wiring (permission ≠ usability):
granted granular scopes cover the page; page `tasks` include lead-management
/ advertising; `has_lead_access` / Lead Generation Terms accepted (surface a
taxonomy code telling the agent exactly what to accept where if not).
Then idempotent steps, each with a receipt on the row, each resumable:

1. upsert `meta_pages` (page token sealed, `connectionId` linked).
2. `POST /{page}/subscribed_apps?subscribed_fields=leadgen` — verify by
   reading back.
3. `ensureMetaAgentQr({userId, campaignId})` — NEW trusted service: sets
   `assignedAgentId` directly (no phone lookup), explicit owner, idempotent
   per (userId, campaignId), asserts the QR resolves to that exact agent.
4. Form: search the page's existing forms for our deterministic marker
   (name prefix + connectionId in a field) BEFORE creating — an uncertain
   Graph response on retry must never mint duplicates. Create with the full
   payload (questions, locale, privacy_policy, pinned PDPA disclaimer).
5. Mapping upsert (service-level, not the 409-ing admin POST).
6. `connected` + notify the agent (existing push machinery, type
   `facebook_connected`).

If at any step the local user has vanished (mirror hard-delete/deactivate):
`waiting_for_agent` with bounded retries; provenance conflict or upstream
deactivation → terminal. Agent deactivation/deletion flows gain a hook:
active connections auto-disconnect first (and hard-delete eligibility
refuses users with active connections until then).

### 2.4 `status` / `disconnect` (broker actions)

`status` → `{enabled, status, pageName, formName, lastLeadAt,
needsSelection?: candidates}` — `enabled:false` when `META_OAUTH_ENABLED`
off (screen hides itself; stop polling on blur/unmount/backoff — an old
deep link must not strand a hidden screen polling 404s).
`disconnect` → ONE transaction: connection `disconnected`, mapping
inactive, `meta_pages.isActive=false` (tombstone DENY stays), THEN
best-effort `DELETE /{page}/subscribed_apps` and token wipe
(`accessTokenEnc=NULL`). Defined semantics for in-flight leads: inbox rows
for a disconnected page dead-letter with `page_disconnected` (deliberate,
documented — "no black hole" becomes "no SILENT black hole"); the app copy
tells the agent that disconnecting MKTR does not stop their Meta ads or the
form itself.

## 3. App (mktr-leads repo — all OTA-safe)

Profile row + `app/(tabs)/profile/facebook.tsx` (+ layout entry + typed
routes regen). States mirror the connection machine incl.
`needs_page_selection` (radio list → broker `select_page`) and
`reauth_required` ([Reconnect]). `hooks/useFacebookReturnLink.ts` — screen-
scoped `Linking.useURL()`, treated purely as refresh trigger; cold-start
deep link routes Profile→facebook with `withAnchor`. Component tests per
house pattern (react-test-renderer).

## 4. Meta app config + review pack (all drafted in-repo)

FB Login for Business **configuration** (config_id; user-access-token type)
with the 5 permissions; Valid OAuth Redirect URI = the callback; **App
domains + the completion-page domain registered**. NEW in v2 (review
finding): **Deauthorize callback URL + Data Deletion Request URL** —
`POST /api/meta/oauth/deauthorize` + `/data-deletion` (signed_request
verified with app secret; locate by `fbUserIdAppScoped`; deauth →
auto-disconnect; deletion → confirmation-code response + connection scrub
job). `docs/reference/meta-app-review-pack.md` (CREATED with this feature,
not referenced-only): per-permission justification ↔ screencast step map,
test credentials + scratch Page, data-retention/deletion answers, exact
domains. Review-pack lint test: every requested permission appears in the
pack.

## 5. Config

`META_OAUTH_ENABLED` (boolean-flag audited; prod-on requires ALL OF:
`META_LEAD_ADS_ENABLED=true`, `META_APP_ID`, `META_APP_SECRET`,
`FB_LOGIN_CONFIG_ID`, `META_STATE_SECRET` (dedicated — not
EXTERNAL_APP_SECRET reuse), `META_PAGE_TOKEN_ENC_KEY`,
`META_AGENT_ADS_CAMPAIGN_ID`, `EXTERNAL_APP_SECRET`,
`META_OAUTH_CALLBACK_ORIGIN` exact-https). EF env: `MKTR_FACEBOOK_URL`.
Graph version: single source (`META_GRAPH_API_VERSION`), env.example
unified.

## 6. Token health + reconciliation (new section, review finding)

Daily probe job over `connected` rows: `debug_token` (validity,
`data_access_expires_at`, scopes drift) + subscription read-back + page
tasks re-check. Failing → `reauth_required` + push to the agent + admin
visibility (existing inbox-ops pattern: `GET /api/meta/connections?status=`).
Metrics/logs: stuck `provisioning` age alarm, orphan-form detector, invalid
token count, `page_disconnected` dead-letters.

## 7. Tests

State machine unit (every transition + fences + nonce single-use + expiry);
Graph client (timeouts, error taxonomy, appsecret_proof, pagination);
provisioning idempotency (every step crash-resumed; duplicate-form guard);
page-selection matrix (0/1/N + invalid select); mirror-lag
(`agent_sync_pending`, `waiting_for_agent`, deactivation mid-flight);
disconnect transactionality + tombstone DENY + in-flight dead-letter
taxonomy; deauth/data-deletion callbacks (signed_request fixtures); broker
gate matrix; envValidation matrix; route-gate snapshot additions
(callback + deauth + data-deletion under meta.js). Integration: full
provision → simulated leadgen webhook for that page → routes to the agent.

## 8. Delivery plan

PR A (platform): schema + state machine + worker + broker endpoint + Graph
client + bootstrap ensure + deauth/deletion + tests (flag off, inert).
PR B (mktr-leads): EF broker + app screen + hook + tests; EF deploy;
OTA after PR A is live. Then: dev-mode e2e on a scratch Page → screencast →
review pack final → Shawn's ONE approval click for App Review → on grant,
flag on → **Tech Provider submission: Shawn's explicit final confirm**.
