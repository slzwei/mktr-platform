# Plan — Meta Customer-List "Redeemed" Exclusion Sync

**Status:** DRAFT v3 (Codex-reviewed + self-audited against code) — not yet implemented
**Author:** Claude (with Shawn); reviewed by Codex (gpt-5.5, xhigh)
**Date:** 2026-06-22

## 0. Changelog

### v3 — second pass, re-verified against real code (do-not-assume audit)
- **Redaction guidance corrected (was mechanically wrong).** Pino redact paths
  match **keys in logged objects**, not env-var names — adding
  `META_ADS_MANAGEMENT_TOKEN` as a path does nothing. `logger.js:16-24` already
  redacts `req.headers.authorization`, `token`, `access_token`, `accessToken`,
  `meta_capi_access_token`. Real safeguard: **never log the outbound request
  options / Authorization header / token / `invalid_entry_samples`.**
- **Sentry must use a shared `initSentry()` helper, not a bare `Sentry.init()`.**
  `server.js:14-26` guards on `SENTRY_DSN` **and** wires `beforeSend: scrubEvent` /
  `beforeBreadcrumb: scrubBreadcrumb` (`utils/sentryScrub.js`). A naive init in the
  cron script would ship **unscrubbed PII**.
- **`usersreplace` is intended but NOT primary-verified.** The edge exists (doc
  page heading confirms) but its exact payload/session/batch-completion contract
  could not be read from primary docs (truncation) and a community thread reports
  errors. **Probe-confirm before relying on it;** fallback = additive `/users` +
  explicit `DELETE /users`. The "removals/PDPA-erasure for free" benefit is
  **contingent** on `usersreplace` behaving as assumed.
- Line-cite fix: `META_PAGE_ACCESS_TOKEN` is `metaLeadService.js:100` (not :99).
  And `metaLeadService.js:108` already uses an `Authorization: Bearer` header —
  the **in-repo precedent** for this plan's auth approach.
- `backend/.env.example` is the file for the new backend vars (root `.env.example`
  mirrors backend Meta vars too).
- `META_AD_ACCOUNT_ID` is used only for **create (D1) + the read-probe**, not the
  `usersreplace` POST (audience-scoped) — keep it optional in the guard.
- `v25.0` default / "SDK v25.0.2" is **Codex's claim, not independently verified**;
  env-overridable so low-risk.

### v2 — Codex review (all claims verified against code)
- Switched from additive `/users` to `usersreplace` (see v3 caveat above).
- Multi-key schema `["EMAIL","PHONE"]` pre-hashed (NOT `*_SHA256`); omit `is_raw`;
  `estimated_num_total` optional.
- Graph version read from env directly (existing CAPI/lead services hardcode
  `v21.0` — `metaCapiService.js:5`, `metaLeadService.js:15`; mirror
  `verificationService.js:18`).
- Sentry in cron; `Authorization` header not `?access_token=`; consent default →
  `true`; don't rely on person-level dedup.

## 1. Goal

Automated, scheduled job that pushes everyone who has redeemed (hashed email +
phone, from our own DB) into a **Meta Customer-List custom audience**
(`subtype=CUSTOM`, `customer_file_source=USER_PROVIDED_ONLY`), used as an
**ad-set exclusion** so redeemers stop seeing our Facebook/Instagram ads. Runs on
a schedule. **Complements, does not replace** the existing pixel-based exclusion.

## 2. Why (evidence)

Existing audience `6981883288829` "Already redeemed (Lead) — exclude" is a
**pixel-rule** audience (`subtype=PLATFORM`, pixel `1402034528611431`,
`event=Lead`, 180-day retention) that under-captures: DB has **~50 distinct
redeemers** but it holds **~20**. A cookie/pixel audience only contains people
whose **browser tag fired AND** whom Meta could **match to an account**; ad
blockers / iOS ITP / consent kill the tag for a big share, and the CAPI backup
rescues *reporting* but is weak at *audience membership*. Proof: 4 phones (incl.
Hongyu `+6596176848`) redeemed in **both** the $20 and $10 campaigns — the $10 ad
set has the exclusion attached, yet they were never in the ~20, so they were
re-served and re-redeemed. A customer list from our DB skips the browser-tag
dependency and matches on email **and** phone. (Not a silver bullet — §14.)

## 3. Scope

**In scope (Phase 1):** the Meta customer-list exclusion sync.
**Out of scope (future, §15):** submit-time repeat-redeemer block; TikTok
suppression audience; delta/high-water-mark optimization.

## 4. Open decisions (need Shawn) — defaults marked

- **D1 — Audience source.** *Default:* create a new `subtype=CUSTOM`,
  `customer_file_source=USER_PROVIDED_ONLY` audience via API now (ToS already
  accepted on `act_2170132703771607`); record its id in env. *Alt:* Shawn creates
  it in Ads Manager and gives the id.
- **D2 — Frequency.** *Default:* daily (~03:00 SGT). *Alt:* every 6h / hourly.
- **D3 — Scheduler.** *Default:* Render Cron Job, same image, `RUN_MODE=
  cron-redeemed-audience` (mirrors `cron-sa61`). *Alt:* in-process `setInterval`.
- **D4 — Consent gate (PDPA).** *Default:* `REDEEMED_AUDIENCE_REQUIRE_CONSENT =
  true` → only upload redeemers with `sourceMetadata.consent_contact === true`
  (matches CAPI's gate at `metaCapiService.js:61`; 52/54 consented). Flipping it
  off to suppress *all* redeemers is a **legal/DPIA** call, not an eng default.

## 5. Prerequisite / main blocker

**P1 — Meta token with `ads_management`.** Custom-audience management requires
`ads_management` and the (system) user must have access to `act_2170132703771607`.
The existing `META_CAPI_ACCESS_TOKEN` is a Pixel/CAPI token; `metaLeadService`
uses a *different* `META_PAGE_ACCESS_TOKEN` (`metaLeadService.js:100`) — **neither
is assumed to work**. Provision a dedicated **System User token**
(`META_ADS_MANAGEMENT_TOKEN`), narrowest scope that still grants `ads_management`,
and **verify with a read probe** (`GET /act_2170132703771607/customaudiences`)
before building. Build is blocked on this.

## 6. Verified Meta API contract (primary docs + Codex) + the one unverified bit

- **Sync method (intended): `POST /{custom_audience_id}/usersreplace`** —
  authoritative full replace (membership becomes exactly the uploaded set when the
  final batch lands). **NOT primary-verified** (see §0 v3): the edge exists, but
  confirm the exact body/session/completion semantics via the rollout probe before
  relying on it. **Fallback:** additive `POST /{id}/users` + explicit
  `DELETE /{id}/users` for removals.
- **Body:** `payload = { schema, data }` + `session`.
  - `schema`: **`["EMAIL","PHONE"]`** (multi-key), values **pre-hashed SHA-256**.
  - `data`: 2-D array `[[emailHash, phoneHash], …]`, blank string for a missing
    key (**probe blank-key acceptance — §9 fallback**).
  - Omit `is_raw`.
- **Session:** `{ session_id (int64), batch_seq (1-based), last_batch_flag (bool),
  estimated_num_total (int64, optional) }`; **≤10,000 users/request**. ~50 rows ⇒
  one batch (`batch_seq:1, last_batch_flag:true`).
- **Response:** `{ audience_id, session_id, num_received, num_invalid_entries,
  invalid_entry_samples }`. Do **not** treat `num_received` as a unique count.
- **Create:** `POST /act_{ad_account_id}/customaudiences` with `name`,
  `subtype:"CUSTOM"`, `customer_file_source:"USER_PROVIDED_ONLY"`, `description`.
- **Graph version:** read env, default `v25.0` (Codex says SDK v25.0.2,
  2026-06-08 — not independently verified; env-overridable).
- **Auth:** `Authorization: Bearer <token>` **header** (in-repo precedent:
  `metaLeadService.js:108`). Do **not** copy `metaCapiService.js:125`'s
  `?access_token=` URL style.

## 7. Normalization + hashing (reuse existing utils)

`backend/src/utils/piiHashing.js` matches Meta: `hashEmail` (trim→lowercase→
SHA-256 hex); `hashPhone` (strip non-digits, keep country code, drop `+`→SHA-256
hex). Correct **because** `Prospect.phone` is enforced E.164 `+65…`
(`Prospect.js:35`). Meta also wants leading zeroes removed — E.164 has none.
**Keep the E.164 assumption explicit and unit-test it.** No new hashing code.

## 8. Selection logic ("redeemed" = all form submitters; Shawn's pick)

Sequelize `Prospect.findAll`, equivalent to:
```sql
WHERE "leadSource" <> 'call_bot'                              -- exclude Retell voice bot
  AND ( (email IS NOT NULL AND email NOT LIKE '%@calls.mktr.sg') OR phone IS NOT NULL )
  AND ("sourceMetadata"->>'consent_contact') = 'true'         -- when REQUIRE_CONSENT (D4 default true)
```
Verify the `consent_contact` JSON predicate type (CAPI reads it as a JS boolean
`true`, so the column stores a JSON boolean — pick the matching Sequelize/JSON
where-clause). Rows with neither identifier are dropped pre-upload. No `is_test`
column on `prospects`; `@calls.mktr.sg` is the only known synthetic marker —
confirm no preview/demo prospects need excluding at impl.

## 9. Components

**New service — `backend/src/services/redeemedAudienceService.js`** (DI-style,
mirrors `metaLeadService.js`'s `defaultDeps`):
- `selectRedeemers(deps)` → rows (honors `REQUIRE_CONSENT`).
- `buildUsersPayload(rows)` → `{ schema:["EMAIL","PHONE"], data:[[em,ph],…] }`.
- `replaceAudience({ audienceId, payload, session }, deps)` → POST to
  `usersreplace` with an **`Authorization: Bearer` header**; returns
  `{ num_received, num_invalid_entries }`. **Never logs the options/headers/token.**
- `syncRedeemedAudience(deps)` → guard → select → (chunk ≤10k) → replace →
  aggregate + log. Reads `META_GRAPH_API_VERSION` from env directly.
- Guard `shouldSync()`: no-op unless `REDEEMED_AUDIENCE_SYNC_ENABLED==='true'` +
  token + `META_REDEEMED_AUDIENCE_ID` present (mirrors `shouldFireCapi`).
  `META_AD_ACCOUNT_ID` not required here (create/probe only).
- **Missing-key handling:** `usersreplace` is one authoritative session (can't
  split into two replace calls). Send `["EMAIL","PHONE"]` with blank for the
  missing key and **probe** acceptance; if blanks are rejected, fallback =
  `usersreplace` with both-key rows, then a follow-up additive `POST /{id}/users`
  for the few single-key stragglers.

**Shared Sentry helper — `backend/src/utils/sentryInit.js` (new, small refactor):**
extract the `SENTRY_DSN` guard + `Sentry.init({ … beforeSend: scrubEvent,
beforeBreadcrumb: scrubBreadcrumb … })` currently inline at `server.js:14-26`, and
import it in **both** `server.js` and the cron script. Prevents the script from
shipping **unscrubbed PII** and stops config drift.

**New script — `backend/scripts/sync-redeemed-audience.js`** (mirrors
`sa61-weekly-reminder.js`): `dotenv` → `initSentry()` → `syncRedeemedAudience()` →
log summary (counts only) → **close Sequelize** → `process.exit(0/1)`.

**`backend/entrypoint.sh`:** add
`elif [ "$RUN_MODE" = "cron-redeemed-audience" ]; then exec node scripts/sync-redeemed-audience.js`.

**`backend/.dockerignore`:** add `!scripts/sync-redeemed-audience.js` (line 21
`scripts/*` excludes the dir).

**Sync strategy:** authoritative `usersreplace` each run (adds + removes in one
shot). ~50 rows ⇒ single batch.

## 10. Config / env (no hardcoded tokens, ids, or versions)

| Var | Purpose | Default |
|---|---|---|
| `REDEEMED_AUDIENCE_SYNC_ENABLED` | master switch | `false` |
| `META_ADS_MANAGEMENT_TOKEN` | system-user token w/ `ads_management` (**secret**) | — |
| `META_AD_ACCOUNT_ID` | `2170132703771607` — **create + probe only** (code adds `act_`) | — |
| `META_REDEEMED_AUDIENCE_ID` | target customer-list audience id | — |
| `META_GRAPH_API_VERSION` | read directly in new code | `v25.0` |
| `REDEEMED_AUDIENCE_REQUIRE_CONSENT` | PDPA gate (§4 D4) | `true` |

Add to **`backend/.env.example`** (blank; root `.env.example` mirrors backend Meta
vars). **Redaction note:** `logger.js:16-24` already redacts
`req.headers.authorization` + `token`/`access_token`/`accessToken`; redact paths
match logged-object keys, **not** env names — so the only real safeguard is to
**not log** the request options, Authorization header, token, or
`invalid_entry_samples`.

## 11. Error handling / observability

- **Sentry via the shared `initSentry()`** (with scrubbers) — else captures
  no-op AND would leak PII. Tag `source:redeemed_audience_sync`.
- Pino: `redeemed_audience.sync.{start,batch,done,failed}` with **counts only**
  (`selected`, `num_received`, `num_invalid_entries`) — never raw PII / samples /
  token / headers.
- Script exits non-zero on failure ⇒ Render Cron marks the run failed.
- Audience count hidden < 1000 in UI — verify via API `num_received`.

## 12. Rollout

1. Provision + read-probe `META_ADS_MANAGEMENT_TOKEN` (P1).
2. Create the customer-list audience (D1) → set `META_REDEEMED_AUDIENCE_ID`.
3. Ship backend (service + shared `initSentry` + script + entrypoint +
   dockerignore; web behavior unchanged, flag default off).
4. Set env on Render; flip `REDEEMED_AUDIENCE_SYNC_ENABLED=true`.
5. Run once manually → **here, confirm `usersreplace`'s exact contract + blank-key
   acceptance** against the live API (small test batch first); fall back to
   `/users` + `DELETE` if `usersreplace` misbehaves. Confirm `num_received`.
6. Create Render Cron Job (same image, `RUN_MODE=cron-redeemed-audience`,
   schedule per D2).
7. Attach the audience as `excluded_custom_audiences` on both campaigns' ad sets
   (ops, alongside the pixel one) — MCP/Ads Manager, not code.
8. Update `TRACKER.md` + `mktr-platform/CLAUDE.md`.

## 13. Testing

Jest (injected `fetch`), mirroring `test/metaCapiService.test.js`: payload build
(hash correctness, **E.164 phone**, multi-key shape, blank-key, drop-no-id),
session (`batch_seq`, `last_batch_flag` on final, >10k chunking), guard
(disabled/missing creds → no-op), error handling (non-2xx, `num_invalid_entries`),
and **`Authorization` header present / token never in URL or logs**. Optional
smoke script gated on `META_TEST_*`. Run note: sandbox off + `JWT_SECRET` inline;
~5 suites fail on ECONNREFUSED without local Postgres (expected/pre-existing).

## 14. Honest caveats / residual leaks

- Token permission (P1) is the gating risk.
- `usersreplace` contract is probe-pending (§0 v3) — removal/PDPA-erasure benefit
  is contingent on it working as assumed; else use explicit `DELETE`.
- Match-rate ceiling: email/phone that don't map to a Meta account stay unmatched.
- Small audience: Meta applies tiny exclusion lists less reliably; grows over time.
- Freshness lag = sync interval + Meta processing.
- Does NOT stop: re-redemption via form/QR/shared link (needs §15 form block),
  TikTok/other channels (own list), a repeater using *different* details, or a new
  ad set launched without the exclusion attached.

## 15. Out of scope (future phases)

- Phase 2: submit-time repeat-redeemer block (cross-campaign dedupe at
  `/api/prospects`) — the actual fix for double-redemption.
- Phase 3: TikTok customer-file suppression audience (mirror this service).
- Phase 4: delta sync via high-water mark if volume outgrows full replace.
