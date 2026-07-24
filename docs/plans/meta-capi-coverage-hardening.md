# Meta CAPI Coverage Hardening + Tracking Cleanup

**Date:** 2026-07-24 · **Status:** ✅ **IMPLEMENTED 2026-07-24** on branch `feat/meta-capi-hardening` (6 commits, unpushed — awaiting review/merge). All 5 phases shipped as planned; every Codex R1 finding folded. Test state: backend 398/398 green across 23 affected suites; frontend 1896/1897 (the 1 failure is inherited `designConfigV2 screeningCall`, red at origin/main). All 3 brand builds compile.

**Commits:** `63701e1` consent 3sites base · `6eaab4c` Phase 1 payload · `ea403b0` Phase 2 VoucherRedeemed · `6de9522` Phase 3 won-atomicity + admin hook · `c3032fe` Phase 4 frontend · `eb9abd3` Phase 5 removal.

**Deviations from plan:** (a) the `is_test_data` guard stayed dropped (field doesn't exist — decision 6 confirmed at implementation); (b) `shouldTrack`'s new `pixelId` is OPTIONAL with an env fallback rather than required, so an un-threaded call site degrades to today's behaviour instead of silently suppressing; (c) `trackFunnelEvent` (lib/pixelCustom) replaced the planned inline helper in both funnels; (d) Phase 3's transaction repair also moved `conversionDate` inside the txn (it was a separate `save`).

**Post-merge owner actions:** set `META_EVENT_REDEEMED` (optional — defaults to `VoucherRedeemed`); Events Manager → turn off "Track events automatically"; create the VoucherRedeemed custom conversion after the first real event lands.
**Source:** full-journey CAPI audit 2026-07-24 (code + prod mktr-db + Meta dataset `1402034528611431`). Verified facts: 136 prospects, 4 `ConfirmedResident` sent (= all 4 qualified), 0 `ClosedWon`, 0 campaigns using pixel overrides, 0 Meta-Lead-Ads leads ever, waitlist = 1 signup (last 2026-06-04), only campaign type in prod = `lead_generation`.

## Goal

Close the highest-ROI server-side signal gaps (voucher redemption, admin-recorded outcomes, event match quality) and remove tracking code that is dead, desynced, or leaking — without touching the deferred items (see Non-goals).

## Locked scope decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Redemption event name = **custom `VoucherRedeemed`**, env-overridable `META_EVENT_REDEEMED` (mirrors `META_EVENT_QUALIFIED`/`META_EVENT_WON`) | Keeps standard `Purchase` reserved for policy wins. Codex R1 concurs ("reasonable semantic choice"). |
| 2 | `action_source: 'physical_store'` via new optional `ctx.actionSource` (default `'website'`); **`event_source_url` suppressed whenever `actionSource !== 'website'`** (R1 #3) | Truthful action_source; a physical event must not carry the months-old landing URL. |
| 3 | Delivery = deterministic `event_id` `voucher_redeemed:{entitlementId}` + marker `prospect.sourceMetadata.capi.voucherRedeemed[entitlementId]` + **attempt whenever the marker is absent (fresh AND `already:true` replays)** + **in-process reconciliation sweep** (R1 #2/#4) | Fresh-only fire had a permanent-loss window (crash between commit and send, replays returned early). Sweep + replay-retry close it with zero migrations. A transactional-outbox table is the escalation path if redemption volume ever makes the sweep expensive — not warranted at ~50 redemptions. |
| 4 | Redemption events are scoped to the **activation's campaign** for consent, pixel override, AND `custom_data.campaign_id` (new `ctx.campaignIdOverride`) (R1 #3) | Manual issuance (`entitlementService.issueManual:494-507`) deliberately allows an activation whose campaign ≠ `prospect.campaignId` — the event must not mix scopes. |
| 5 | EMQ fields `fn`/`ln`/`country` ride **inside the existing `marketingConsent` gate** (3sites — fail closed) | `Prospect` stores `firstName`/`lastName`; country constant `'sg'`. R1 verified no leak path. Meta-only (TikTok API has no name fields). |
| 6 | Admin hook fires for transitions into **both `qualified` and `won`** via existing `processLeadOutcome` — **after Phase 3 first repairs the transition to be atomic** (R1 #5) | Today `prospect.update()` autocommits the status BEFORE the System-Agent rejection and commission txn — a blocked `won` persists without commission and retries are inert (`oldStatus === 'won'`). Latent prod bug; the hook inherits it unless repaired. |
| 7 | Custom diagnostics: **delete** `dnc_gate_shown` + `dnc_consent_given`; **extend** `otp_sent`/`otp_verified`/`duplicate_blocked` to the classic funnel | **Codex dissent recorded (R1 #12):** prefers deleting all diagnostics or moving to first-party analytics (no named ads consumer). Decision stands — the extension is cheap, makes the two funnels comparable during paid pushes, and the events are documented droppable. Revisit if unused after the next campaign. |
| 8 | Meta Lead Ads webhook stack: **remove** route + controller + service, **surgically** strip the two mixed test suites (R1 #13) | 0 leads ever; public endpoint maintained for nothing. `metaLeadgenId` guards in both `shouldFire*` stay. |
| 9 | Pixel-override: **server guard fixed to late resolution** (mirror TikTok); **frontend gate takes the caller-resolved id with every call site enumerated** (R1 #8); **browser-side limitation documented, not engineered away** (R1 #9) | `index.html` loaders early-return without the env id, so a campaign-only pixel cannot fire browser-side without lazy SDK injection — deferred until a second advertiser actually exists. Both prod builds always set the env ids, so the override works today once the gate + server guard are fixed. |
| 10 | No new feature flags | Every new server send rides `META_CAPI_ENABLED` + creds; frontend changes are removals/parity fixes. |

---

## Phase 1 — CAPI payload foundations (backend, pure additive)

**`backend/src/utils/piiHashing.js`**
- `hashName(value)`: mirror Meta's `capi-param-builder` `getNormalizedName` — trim → lowercase → strip whitespace + punctuation, **keep digits and UTF-8 letters** (R1 #6) → sha256 hex; `undefined` on empty. Lock with compatibility vectors: UTF-8, apostrophes, hyphens, whitespace, digits.
- `hashCountry(code)`: sha256 of lowercased 2-letter code; callers pass `'sg'`.

**`backend/src/services/metaCapiService.js`**
- `_buildPayload`: inside the `marketingConsent` block add `fn = hashName(prospect.firstName)`, `ln = hashName(prospect.lastName)`, `country = hashCountry('sg')`.
- `_buildPayload`: `action_source: ctx.actionSource || 'website'`; when `actionSource !== 'website'`, omit `event_source_url` entirely.
- `_buildPayload`: `custom_data.campaign_id = ctx.campaignIdOverride || prospect.campaignId`.
- `shouldFireCapi`: drop the `META_PIXEL_ID` env requirement; `sendConversionEvent` resolves `ctx.pixelIdOverride || META_PIXEL_ID` and bails `no_pixel_id` if neither — exact mirror of `tiktokEventsService.js:118-127` (R1 #9).

**Tests — corrected inventory (R1 #7):** `backend/test/metaCapiService.test.js` is field-level (`:116-264`, no snapshots) and its fixture has no names — add names, assert exact normalized-hash inputs, actionSource default/override, event_source_url suppression, guard late-resolution. Extend `backend/test/integration/consentLedger.test.js:353-357` (the only other `_buildPayload` consumer) so the withdrawal case asserts ALL five contact fields (`em`/`ph`/`fn`/`ln`/`country`) are stripped.

## Phase 2 — `VoucherRedeemed` at partner redemption

**`backend/src/services/redeemOps/redemptionService.js`**
- `findByVoucherToken`: add `campaignId` to the activation include attributes (R1 #1 — currently `['id','campaignNameSnapshot','partnerOrganisationId']`, so `activation.campaignId` is `undefined` even though "preloaded").
- `complete()`: add `redemptionOutcome` to DI defaults; fire-and-forget `processRedemption({ entitlement })` on **every** return path where the entitlement is redeemed — fresh AND `already:true` replays (R1 #2: a re-scan retries a lost send; the marker/event_id make it idempotent).

**New `backend/src/services/redemptionOutcomeService.js`** (DI factory, `leadOutcomeService` shape):
- `processRedemption({ entitlement })`: bail if `entitlement.prospectId` null → marker-guard (`sourceMetadata.capi.voucherRedeemed[entitlementId]`) → load Prospect → resolve activation campaign: use `entitlement.activation.campaignId`, reload the Activation when the attribute is `undefined`, and treat an explicit `null` as unlinked → **PII fail-closed** (R1 #1: null campaign ⇒ `canMarketTo` scoped `campaignId:null`, which cannot see campaign-scoped grants — em/ph drop, event still fires) → `Campaign.metaPixelId` override → `sendConversionEvent(prospect, { eventId, actionSource:'physical_store', campaignIdOverride, marketingConsent, pixelIdOverride }, { eventName: META_EVENT_REDEEMED || 'VoucherRedeemed' })` with bounded retry → mark on success (`prospect.changed('sourceMetadata', true)`).
- Must go through `sendConversionEvent` (keeps `shouldFireCapi`'s `call_bot`/`retellCallId`/`metaLeadgenId` guards — R1 verified).
- `event_time` = now.

**Reconciliation sweep (closes the crash window — R1 #2):** in `database/bootstrap.js`, alongside the redeemed-audience pattern: when `META_CAPI_ENABLED === 'true'`, every 6 h query redeemed entitlements (with `prospectId`) whose prospect lacks the marker → `processRedemption` each. Single-instance backend ⇒ no double-fire; deterministic event_id ⇒ Meta-side safety anyway.

**Tests** (new `backend/src/tests/redemptionOutcomeService.test.js`, mock-model): marker dedup; prospect-less no-op; undefined-vs-null campaignId (reload vs fail-closed); consent stripping; guarded leaves marker unwritten; `complete()` fires on fresh AND replay; sweep picks up unmarked rows.

## Phase 3 — Admin-recorded outcomes fire down-funnel (with transition repair)

**`backend/src/services/prospectService.js` — repair first (R1 #5):**
- Move the System-Agent `won` validation (`:1414-1417`) BEFORE `prospect.update(safeUpdates)` (`:1390`).
- Put the status update + `conversionDate` + Commission create into ONE managed transaction (today status autocommits at `:1390`, then the commission txn runs separately at `:1419` — crash or rejection strands `won` with no commission). Behaviour change to call out in the PR: a System-Agent-blocked `won` now leaves the status **unchanged** (previously it persisted the status and threw).
- After that transaction commits: `if (['qualified','won'].includes(safeUpdates.leadStatus) && oldStatus !== safeUpdates.leadStatus)` → fire-and-forget `d.processLeadOutcome({ external_id: prospect.id, new_status: safeUpdates.leadStatus, occurred_at: new Date().toISOString() })`, injected via `defaultDeps` (cycle-safe — R1 verified `leadOutcomeService` imports only models/Meta/consent).
- Scoping verified (mine + R1): no bulk status writer exists; `externalLeadOutcomeService` bypasses `updateProspect` and already fires `processLeadOutcome` itself; markers dedup any overlap.

**Tests:** qualified → CR; won → CR+CW; **repeat transition → NO hook invocation** (R1 #5 — `oldStatus` already terminal); System-Agent-blocked won leaves status unchanged; commission + status atomicity.

## Phase 4 — Frontend truth-up

1. **Remove `value: 0, currency: 'SGD'`** from `trackLead`/`trackTikTokLead` in `src/pages/LeadCapture.jsx` (~`:376-393`).
2. **Delete** `dnc_gate_shown` (`MarketplaceFlow.jsx:307`) and `dnc_consent_given` (`:771`) — locations R1-verified exact.
3. **Diagnostics extension — fire from `CampaignSignupForm.jsx`, NOT `OTPVerification` (R1 #10):** the form owns `/verify/send` success (`:154-163`) and `/verify/check` success (`:200-211`); fire `otp_sent`/`otp_verified` there via a shared gated helper extracted to `src/lib/pixelCustom.js` (from `MarketplaceFlow.jsx:190-194`), guarded `!previewMode`. Covers classic, quiz, `guided_review`, and v2 (all reuse the form; no prop-drilling through `funnelAdapter.js`).
4. **`duplicate_blocked` via the structured 409** (R1 #11): LeadCapture currently regex-matches English error copy (`:401-415`); switch to `err.status === 409 && err.data?.alreadyRegistered` (client preserves it — `src/api/client.js:157-162`; backend sets it — `prospectService.js:599-602`), keep the regex as fallback; fire the event there. Marketplace already does this (`MarketplaceFlow.jsx:387`).
5. **Gate signature change with full caller enumeration (R1 #8):** `shouldTrack`/`shouldTrackTikTok` take the caller-resolved pixel id (`if (!resolvedPixelId) return false` replaces the env-only short-circuit). Callers to update — ALL of: `LeadCapture.jsx:113/130/152/163/372/386`, `MarketplaceOffer.jsx:51/68`, `MarketplaceFlow.jsx:144/157/192-193/368/374`, plus the new `CampaignSignupForm` diagnostics sites. Add a central `resolvePixelIds(campaign)` helper so gates, custom events, and conversion events all use identical ids. Update `metaPixel.test.js` + tiktok tests.
6. **Remove `Subscribe`**: delete the pixel block in `CTASection.jsx:28-32` + the `trackSubscribe` export (R1 verified: no other consumers).
7. **Document (not engineer) the loader limitation** (R1 #9): a campaign-only pixel id still cannot fire browser-side because `index.html:15/34` early-return without the env ids; note in `ads-and-tracking.md`. Lazy SDK injection = future work when a second advertiser exists.

Verify via `/verify` skill (Playwright, both brands): Lead without value; classic funnel emits otp events in test-events; no dnc_* anywhere; marketplace regression.

## Phase 5 — Dead-code removal (Meta Lead Ads webhook) — surgical list (R1 #13)

- Delete `backend/src/routes/meta.js` (auto-discovery unmounts — `routes/index.js:21`), `controllers/metaController.js`, `services/metaLeadService.js`, and their **dedicated** tests.
- **Surgically edit, do not delete**, the mixed suites: `backend/test/integration/consumerSpine.test.js` (import `:7`, Meta block from `:275`) and `backend/test/unit/inboundLeadQuota.test.js` (import `:4`, Meta describe `:104-107`) — the rest is Retell/consumer-spine coverage that must survive.
- Remove `META_APP_SECRET`/`META_VERIFY_TOKEN`/`META_PAGE_ACCESS_TOKEN` from **both** `.env.example:61-63` **and** `backend/.env.example:163-167`; update `README.md:73` + `backend/README.md:69` route/env tables. (`META_WA_*` is WhatsApp — keep.)
- Remove the `/api/meta/` raw-body OR-arm in `server_internal.js:158-160` (R1 verified independent — Retell/Lyfe/external unaffected).
- Keep `metaLeadgenId` guards; post-delete `grep -r metaLeadService backend/` must return empty.

## Owner actions (Meta UI, not code)

1. Events Manager → dataset settings → turn off "Track events automatically without code" (kills the misleading auto-PageView trickle). Skip if adopting deliberate PageView later.
2. After the first real `VoucherRedeemed` lands: create its custom conversion (audience seed / reporting).
3. Watch-item: "Financial service" categorization may strip `custom_data` on mktr.sg-host events — events + user_data matching unaffected.

## Testing & rollout

- Jest per repo recipe (sandbox off + inline `JWT_SECRET`; ECONNREFUSED suites = no local PG, expected). Suites: `metaCapiService` (field-level additions), `consentLedger` integration (five-field withdrawal), `prospectServiceCapi` (+ transition-repair cases), new `redemptionOutcomeService`, `metaPixel`/`tiktokPixel`, surgical edits to `consumerSpine` + `inboundLeadQuota`.
- Order: PR-A backend Phases 1→2→3 · PR-B frontend Phase 4 · PR-C removal Phase 5. Each green independently; no migrations; no new required env (`META_EVENT_REDEEMED` optional).
- Deploy verification per push≠live checklist; observe `capi.voucher_redeemed.sent` in Render logs + Meta Test Events (`META_TEST_EVENT_CODE` staging shot first).
- Prod sanity after PR-A: redeem a QA voucher end-to-end → event in Events Manager with `action_source: physical_store` and no `event_source_url`.

## Risks / accepted

- `sourceMetadata` read-modify-write races between outcome paths remain (pre-existing pattern); deterministic event_ids make double-sends Meta-side no-ops within 48 h, and the sweep re-heals a lost marker (R1 #4 residual accepted — marker map growth is bounded by real redemptions per person, ~1-2).
- Phase 3 changes error semantics for System-Agent-blocked `won` (status no longer persists) — that IS the fix; call out in PR.
- `reverse()` after a sent event is not un-sent (terminal-cancel + re-issue creates a new entitlementId → new event, correct — R1 verified `reverse()` cannot re-emit).
- EMQ fields lift only consented events (consent is default-ticked opt-out ⇒ high coverage).

## Non-goals (deferred deliberately)

`ConsultationHeld` unlock event · deliberate PageView / retargeting pools (ship with next paid push) · TikTok down-funnel parity (no TikTok spend) · Lyfe-path reconciliation backfill (needs a new Lyfe→MKTR read path) · erasure-triggered active Meta deletion / `usersreplace` (probe pending) · Lead value parity (browser+server together) · waitlist section removal (product) · any campaign `is_test_data` concept · lazy pixel-SDK injection for env-less builds (R1 #9, deferred) · transactional-outbox table for redemption events (escalation path only).

## Review log

- **R1 2026-07-24, Codex gpt-5.6-sol xhigh** (`scratchpad/codex-capi-review.log`): 13 findings — #1 activation include missing `campaignId` [BLOCKER, folded]; #2 permanent-loss window [BLOCKER, folded: replay-retry + sweep]; #3 event_source_url/campaign scope [MAJOR, folded]; #4 marker model [MINOR, residual accepted]; #5 non-atomic won transition [BLOCKER, folded: transaction repair]; #6 hashName normalization [MINOR, folded]; #7 test inventory [MINOR, folded]; #8 gate callers unenumerated [BLOCKER, folded]; #9 override dead without env id [BLOCKER, folded: server fix + documented browser limitation]; #10 OTP events at wrong layer [MAJOR, folded: fire from form]; #11 regex 409 [MINOR, folded: structured check]; #12 diagnostics extension weakly justified [MINOR, **dissent recorded, decision stands**]; #13 deletion list incomplete [MAJOR, folded: surgical enumeration]. All findings source-verified before folding (System-Agent/won autocommit, mixed-test imports, dual env examples, form-owned OTP successes, structured 409, nullable activation.campaignId, cross-campaign manual issuance).
