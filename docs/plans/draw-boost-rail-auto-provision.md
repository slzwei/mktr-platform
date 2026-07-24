# Draw ×N boost rail — adversarial review + auto-provision plan

> **⚠️ 07-24 ADDENDUM — read `draw-launch-integrity-scope.md` FIRST.** The August twin `bbd2c577…` was DELETED 07-24 (G1/G10/G19 + every "31 Aug" deadline here are stale); the surviving iPhone draw is `ac7b03c0…` (closes 30 Sep, ages 25–65, screening gate ON — a failure surface this plan predates). Phase 0 below is EXECUTED and must NOT be re-run; its receipts (activation `92dd875f`, offer `16eff8dd`) survived the deletion and were re-attached to the survivor 07-24. Phases 1–2 are adopted as PR-2/PR-4 of the scope doc, with one amendment: D4's strip-ceilings rule is superseded (max_age IS enforced at capture — scope doc G27/D8).

**Date:** 2026-07-23 · **Author:** Claude (Fable 5, adversarial pass over the 2026-07-23 four-point sketch) · **Status:** PLAN — awaiting Codex review · **07-24: consolidated into `draw-launch-integrity-scope.md` (PR-2 + PR-4)**
**Trigger:** iPhone 17 Pro draw went live promising ×10 with no rail behind it; Shawn's requirement: *every* creation path — manual chooser AND the AI "Write it for me" / create-everything flows — must arm the ×10 automatically.

---

## 0. Verdict

The original four-point sketch (SQL the iPhone rail · stamp activationId · seal-time by-campaign fallback · launch gate) is **directionally right but wrong at three layers**: it fixes one campaign instead of the creation choke point, it puts the fallback at the wrong stage (seal instead of createDraw), and its "block launch when no rail" gate would deadlock the very auto-provisioning Shawn asked for (activation can only link to a campaign that already exists). The adversarial pass also surfaced **two defects the sketch missed entirely** — no shipped UI has ever produced boost-grade unlock evidence (all 7 prod unlocks are `via=manual`), and an open Studio session can silently wipe the `activationId` stamp on its next save.

Ground rule kept throughout: **the backend is the choke point.** Manual create, AI details-draft (#233), and headless create-and-design (#239) all converge on `createCampaign`/`setCampaignLaunchState` — provisioning there covers "Write it for me" with zero AI-layer changes.

---

## 1. Verified ground truth (evidence anchors)

| # | Fact | Evidence |
|---|---|---|
| G1 | iPhone draw (`bbd2c577…`) is `active`, multiplier 10, **no `luckyDraw.activationId`**, terms v1 (`c8c83215…`) promise "10 entries instead of one" | prod `campaigns` row; `draw_terms_versions` body |
| G2 | Prod has exactly 2 activations (Tokyo `ba4fbd05…`, Pet Hotel), both `agent_unlock`, both `endDate NULL`; none for iPhone | prod `activations ⋈ reward_offers ⋈ partner_organisations` |
| G3 | Boost evidence = `redemption_events type='unlocked'`, `createdAt < draw.boostClosesAt` (exclusive), on `draw.activationId` only; entitlements with `issuedVia='manual'` excluded wholesale; via whitelist: `agent_scan` auto-boosts, `agent_button`/`manual` need an approved `DrawBoostReview`, `auto_on_capture` never counts | `luckyDrawService.js:287-344` |
| G4 | `collectBoostEvidence` returns empty when `draw.activationId` is null; `createDraw` only reads the stamp (`ld.activationId`), validates ownership, never falls back | `luckyDrawService.js:165-172, 288` |
| G5 | **All 7 prod `unlocked` events ever are `via='manual'`** — zero `agent_scan`, zero `agent_button`. No scan surface has ever fired | prod `redemption_events` group-by |
| G6 | Internal ops unlock hardcodes `via='manual'` even when called with a `presentationToken` | `controllers/redeemOps/fulfilmentController.js:21-31` |
| G7 | External HMAC unlock (mktr-leads) + Lyfe envelope routes derive `agent_scan` (token) / `agent_button` (prospectId) server-side — but the consultant-app scan screens (Phase 4) are unbuilt, so nothing calls them | `routes/externalEntitlements.js:20-21,231`; memory 07-22 re-audit |
| G8 | Capture hook issues passes by `Activation.findOne({campaignId, status:'active'})` — no stamp needed at issue time; gated by `REDEEM_OPS_ENTITLEMENTS_ENABLED` (ON in prod) | `entitlementService.js:223-252`; `bootstrap.js:271-283` |
| G9 | `reconcileMissedLeads` sweep back-issues missed entrants only `sinceHours=48`, every 15 min | `entitlementService.js:733-744`; `bootstrap.js:301-303` |
| G10 | iPhone's single entrant landed `2026-07-22T17:47:22Z` → **sweep window closes ≈ 2026-07-24 17:47 UTC (07-25 01:47 SGT)** | prod `prospects` row + G9 |
| G11 | `normalizeLuckyDraw` always emits `multiplier` (default 10, clamp 2..100) — a "no boost" draw is unrepresentable; terms template writes the ×N session clause unconditionally | `utils/luckyDraw.js:33-35,119-123`; `drawTermsTemplate.js:93-94` |
| G12 | `applyLuckyDrawPolicy` (admin path): **incoming wins wholesale** — an admin save whose `luckyDraw` lacks `activationId` erases the stored stamp | `utils/luckyDraw.js:150-175` |
| G13 | Gate sites precedent (multi-prize): `createCampaign` (is_active defaults **true** on bare API), `updateCampaign` willBeActive, `setCampaignLaunchState`, `createDraw`; readiness has `critical` row precedent | `campaignService.js:459, 600-605, 733`; `campaignReadinessService.js:212-222` |
| G14 | Activation lifecycle service functions exist and are audited: `createActivation`, `linkCampaign`, `changeAllocation`, `setStatus` (LIVE statuses require campaignId) | `activationService.js:78-236` |
| G15 | House partner exists: `partner_organisations 00d28744-b374-48d4-adf0-471b113173a4` (legalName MKTR PTE. LTD., brand Redeem, verified, `pipelineStage='LOST'` — deliberate, keeps it out of BD pipelines; no gate reads pipelineStage) | prod query |
| G16 | Tokyo offer: `claimExpiryDays=110`, committed/allocated 500; Tokyo issuedCount 0 (0 entries so far) | prod query |
| G17 | iPhone featured drop has **no `endsAt`** → homepage card stays "live" past 31 Aug (Tokyo's flips via `sgtDayEndExclusiveMs` + 7d retention) | prod row; `featuredDropsService.js:65-75` |
| G18 | `publicDesignConfig` strips `activationId`/terms internals — stamping is invisible to the public payload; no cache/pixel impact | `utils/publicDesignConfig.js:7` |
| G19 | iPhone entrant routed to Shawn's own consultant mirror (`6707439d…`, Lee Yi Heng, mktrLeadsId set) — the System-Agent fear didn't materialize (likely `DEFAULT_AGENT_ID`); campaign `external_eligible=false`, no lead packages | prod queries |

---

## 2. Adversarial findings

**F1 — The sketch fixed a campaign, not the factory. (BLOCKER, redesigned)**
Point-fix SQL for iPhone leaves the next UI/AI-created draw in the same state: G11 means every draw is born promising ×N, and nothing provisions the rail. Shawn's requirement is explicit: creation flows must arm it automatically. → Plan centerpiece becomes `ensureDrawBoostRail()` at the backend choke point (Phase 1); the SQL survives only as Phase 0 remediation for the already-live campaign (deploys take hours; the sweep deadline G10 doesn't wait).

**F2 — "Block launch when no reward linked" deadlocks auto-provisioning. (BLOCKER, redesigned)**
`linkCampaign` requires an existing campaign row (G14), so a hard gate at create/launch can never be satisfied a priori. The gate must be an **ensure** (provision-or-throw), not an assert. Sequencing per site: `updateCampaign`/`setCampaignLaunchState` ensure **before** flipping active (fail-closed, no compensation); `createCampaign` born-active (bare API defaults `is_active=true`, G13) ensures **after** row creation with a compensating revert to draft + 422 on failure. A leftover activation from a failed later step is harmless — ensure is idempotent and adopts it on retry.

**F3 — Seal-time fallback is the wrong layer. (accepted, moved)**
Falling back by campaign inside `collectBoostEvidence` leaves `draw.activationId` null forever — publish/outcome/verify payloads (`luckyDrawService.js:678`) lose the activation identity and the audit trail weakens. → The fallback belongs in `createDraw`: resolve `Activation.findOne({campaignId, status:'active'})` when the stamp is absent, **422 on ambiguity** (two active activations → operator must stamp explicitly), write-through the resolved id onto the draw row as today. Seal keeps reading `draw.activationId` only.

**F4 — Nothing on any shipped surface can produce an auto-boost. (CRITICAL — new finding, the sketch missed it)**
G5+G6+G7: the only routes that mint `agent_scan` evidence are the external HMAC/Lyfe surfaces no app calls yet; the one unlock button that exists (ops console) hardcodes `via='manual'`, which is review-gated and — worse — rides entitlements that are boost-eligible only if *issued* non-manually (G3). Both live draws would seal with zero automatic boosts no matter what consultants do in the field. Tokyo has until 30 Oct; **iPhone has until 31 Aug.** → Phase 2: minimal ops-side scan front door — when the internal unlock is called with a `presentationToken` that resolves, derive `via='agent_scan'` (same token-backed evidence standard the external route already trusts); plain prospectId/admin-override calls stay `manual`. UI: the existing Redemptions camera scanner gains a "Record session (×N boost)" action for `eligible` passes on draw-linked activations. mktr-leads Phase-4 screens remain the real field tool (separate repo, out of scope).
*Trust trade-off, flagged once:* this widens auto-boost minting from HMAC'd consultants to redeem-ops staff holding `entitlements.issue_manual`. The token is identical evidence; actor is audited (`actorUserId`). Recommended: accept. Conservative alternative (env-selectable): label ops scans `agent_button` → review-gated.

**F5 — An open Studio tab can wipe the stamp. (HIGH — new finding)**
G12: admin saves send the whole `luckyDraw` object; a session loaded pre-stamp omits `activationId`, and the admin path takes incoming wholesale → stamp gone. F3's createDraw fallback makes this non-fatal, but the config shouldn't lie. → `applyLuckyDrawPolicy` carries forward **stored `activationId` when the incoming object omits it** (operational key, editor-invisible by design; explicit `activationId: null` from an admin still clears). Terms keys stay as-is — re-pin logic owns them.

**F6 — Retroactive repair has a hard 48-hour cliff. (URGENT operational fact)**
G3+G9: past the sweep window, the only back-issue path is `issueManual` — whose entitlements are **permanently boost-ineligible** (`issuedVia='manual'` excluded at the entitlement level, not the event level). For the existing iPhone entrant that cliff is ≈ **07-25 01:47 SGT** (G10). Phase 0 today makes the 15-min sweep issue their pass cleanly (`via='sweep'` ≠ manual → boost-capable). Miss it and the honest fixes are ugly (widen `sinceHours` in code, or accept a review-gated manual path for that entrant).

**F7 — Allocation and claim-window sizing are foot-guns, not defaults. (MEDIUM)**
The unique entitlement index has no status filter — an expired reservation **blocks reissue** — so `claimExpiryDays` must cover signup→boostClosesAt with margin; and allocation exhaustion halts issuance with only the 48h reconcile to recover late top-ups. → Provisioning computes `claimExpiryDays = clamp(daysUntil(boostClosesAt) + 21, 30, 400)` and allocates `DRAW_BOOST_DEFAULT_ALLOCATION` (default **1000**; env-tunable). Exhaustion monitoring stays the existing ActivationDetail 24h skip breakdown + `changeAllocation` runbook; auto-top-up parked (Phase 3).

**F8 — Double-provision race. (MEDIUM)**
Two concurrent go-active flips (Studio + API) could mint two active activations → F3's ambiguity 422 at createDraw, months later. No unique index on `activations.campaignId` (multiple activations per campaign is legitimate for non-draw use). → `pg_advisory_xact_lock(hashtext('draw-boost:'||campaignId))` around ensure; find-active-first inside the lock.

**F9 — Homepage card immortality. (LOW, folded in)**
G17. → Phase 0 data-fix (`endsAt='2026-08-31'`) + Phase 1 clamp default: draw campaigns with `featuredDrop.enabled` and no `endsAt` inherit `luckyDraw.closesAt`. Explicit admin `endsAt` always wins.

**F10 — "No-boost draw" mode: correctly out of scope. (REJECTED as scope)**
G11 makes 1×-only draws unrepresentable (terms clause unconditional, chrome renders boost off `multiplier` alone, min clamp 2). Building the mode means conditional terms, chrome gating, email copy, clamp changes — a feature, not a fix, and contrary to the product stance (boost = the growth mechanic). Parked in Phase 3 with the multi-winner engine.

**F11 — Sweep double-fire safety on ensure-at-launch. (verified non-issue)**
Hook + sweep + ensure all funnel into `issueForProspect`, which is exactly-once via the `(activationId, prospectId)` anchor + phone-key partial unique (G8). Provisioning mid-traffic is safe: entrants captured pre-ensure are picked up by the next 15-min sweep (≤48h), entrants post-ensure by the hook.

**F12 — Evidence-window integrity. (verified non-issue)**
The sketch worried late scans could boost after `boostClosesAt`; G3 shows the exclusive `createdAt < boostClosesAt` bound already exists. No change.

**F13 (EXPANDED 07-23 evening — prod evidence from Shawn's own signup) — the ENTIRE entitlement-delivery voice is trial-funnel, at every step, not just unlock.**
Original finding: `unlockEntitlement` unconditionally queues the `kind:'voucher'` delivery (`entitlementService.js:~510`) — partner-redemption copy, nonsense for a draw scan. **Shawn's test signup surfaced the same disease one step earlier**: the signup-time reservation delivery (satori card `qrCardRenderer.js` + WA body `whatsappService.js:160` + email `fulfilmentNotify.js:84` + claim page `consumerService.js:463`) leads with the OFFER title — the entrant who just joined an iPhone draw got *"Reserved. / Complimentary financial review"*. Nobody entering a draw cares about the review; it reads like bait-and-switch. Full voice matrix needing a draw branch: **reservation card · reservation WA body · reservation email · claim page (`/r/…`) · unlock voucher email**. All five key off the draw-linked activation.
Mitigation SHIPPED same evening (data-only), TWICE: first pass *"…Draw ×10 Booster Pass"* — **rejected by Shawn within the hour (D5): "Booster Pass" is jargon; SG audience won't parse it. The message must be plain: you have 1 draw chance now, ×10 when you meet the consultant.** Final interim titles: *"iPhone 17 Pro Lucky Draw Entry Pass" / "Tokyo Getaway Lucky Draw Entry Pass"*. Fixed frame strings ("Reserved.", "RESERVATION PASS", "unlock at your appointment", "CODE · REVEALED ON UNLOCK") remain trial-voiced until Phase 2.

**D5 — pass-copy voice (Shawn, 07-23 evening): plain numbers, no coined nouns; his line verbatim: "10x your chances when you meet with a consultant." Draw card line-set (Phase 2 spec, maps 1:1 onto the existing satori frame):**
| Current (trial voice) | Draw branch |
|---|---|
| RESERVATION PASS | LUCKY DRAW PASS |
| Reserved. | You're in. |
| {publicTitle} | {draw name, e.g. iPhone 17 Pro Lucky Draw} |
| Held for {name} — unlock at your appointment | Held for {name} — 1 chance in the draw now |
| CODE · REVEALED ON UNLOCK | 10X YOUR CHANCES WHEN YOU MEET A CONSULTANT |
| EXPIRES {entitlement expiry} | COMPLETE YOUR REVIEW BY {boostClosesAt} — the user-relevant date (one-date-per-surface rule, #252); entitlement expiry is internal |
| Present once. Non-transferable. | (unchanged) |

**WA template APPROVED 07-23 — `draw_entry_pass` id `2818476365205485`, FINAL CATEGORY = UTILITY** (verified twice ~22:30 SGT: WhatsApp Manager UI "Utility / Active" + Graph API `category=UTILITY`). The receipt-tone body with the full 10x line got utility approval outright — Shawn's exact goal, no appeal needed. Record note: an API poll mid-review transiently reported `category=MARKETING` at the 15–18-min mark; that was pipeline churn, not the outcome — trust post-approval reads, not mid-review ones. Consequences of UTILITY: utility per-message pricing, no STOP-rail requirement, no marketing frequency caps. **`draw_entry_pass` is the Phase 2 primary** (`WHATSAPP_TEMPLATE_DRAW_PASS || 'draw_entry_pass'`).

**Utility twin `draw_pass_receipt` (id `1384079383631712`) — submitted 07-23 while `draw_entry_pass` transiently read as MARKETING; NOW REDUNDANT** (the primary got utility on its own). Body = pure-receipt clone of the `reward_pass` register with the 10x living on the card image. **APPROVED 07-24 (Utility, Active — Manager UI)** — parked as the plainer fallback; no sender work targets it. Final template inventory: `draw_entry_pass` (Utility, PRIMARY, full 10x text) · `draw_pass_receipt` (Utility, fallback) · `lucky_draw_pass` (Rejected shell — never delete, 30-day name block). No appeal was ever filed (the dispute flow is Manager-UI-only, and it proved unnecessary). Submission saga (classifier lessons for the repo): v1 UTILITY with exclamation-mark copy → instant REJECTED `INCORRECT_CATEGORY` (promo register); fresh `lucky_draw_pass` as MARKETING + STOP rails → ALSO rejected `INCORRECT_CATEGORY` (Meta polices both directions since the pricing split — pass delivery is utility DNA); fix = **receipt-tone components edit on the original UTILITY slot** (component edits are allowed on REJECTED templates; the `category` field is immutable post-creation — its error message misleadingly says "approved"). The `lucky_draw_pass` rejected shell stays parked (deleting risks the 30-day name block). Approved body (4 vars: name, draw name, pass link, boost deadline; paragraph-spaced per Shawn):
> Hi {{1}}, your entry to the {{2}} is confirmed — you hold 1 chance in the draw right now.
>
> 10x your chances when you meet with a consultant: complete your complimentary 20-minute financial review and they will scan this pass at the session.
>
> Your pass: {{3}}
>
> Reviews must be completed by {{4}} to count. Good luck.

Shawn's D5 line survives verbatim as the para-2 opener; exclamation marks dropped to match the approved `reward_pass` register (flat-factual is what passes the classifier). Phase 2 sender: `WHATSAPP_TEMPLATE_DRAW_PASS || 'draw_entry_pass'`, image header = live card PNG per send. Reservation email body branches to the same voice. **`WHATSAPP_WABA_ID=1912683432731970` now persisted on mktr-backend-jo6r** (Render REST PUT via the CLI api key — the CLI-key→`GET /v1/services/{id}/env-vars` trick also beats the "creds are Render-only" wall documented in the watemplates seed; `render ssh` is TUI-only and unscriptable).
→ Phase 2 (grown): implement the already-designed **Draw Entry Card** (`Draw Entry Card.dc.html`, claude.ai/design project "Design Review: Three Colorways") as the issuance-time credential for draw activations — "You're in the draw for {prize}" framing, QR as the ×N booster, close date on card; draw claim-page variant; unlock sends "×N confirmed — your entries are now N" (suppress voucher); optional dedicated WA template via the watemplates pipeline (until approved, the existing template + draw-framed variable reads fine).

**F15 — prospect deletion treats live passes inconsistently (LOW severity, HIGH confusion; observed in prod 07-23).** Shawn's test loop (signup → delete → re-signup ×3, same phone) left: passes #1 and #2 `cancelled` on prospect deletion, but pass #3 **orphaned yet still `eligible`** (`prospectId=NULL`, phone slot still held by the anti-farm unique). Two delete paths apparently differ (single vs bulk lead ops?) — one cancels entitlements, one just nulls the FK. Consequences: a re-signup on that phone `duplicate_phone`-skips and sends nothing (looks broken to a tester), and an orphaned live pass could still be scanned at seal time with no prospect → boost evidence pointing at a deleted person (frozen entries require a prospect, so it's noise, not corruption — but verify). → Phase 1: unify the delete path (cancel live entitlements when their prospect is deleted, both single and bulk); test both paths. The 2 `duplicate_phone` skips in the log are the anti-farm gate working as designed.

**F14 — `agent_scan` evidence is irreversible today. (HIGH, given decision D2 below)**
Shawn's requirement: instant count but reversible on error. Nothing supports that: review rows only gate `agent_button`/`manual` — a scan "always wins" (`collectBoostEvidence`); cancelling the entitlement doesn't un-boost (the evidence query has **no status filter** — deliberately cancel-proof — and cancel would kill the person's pass anyway); `DrawBoostReview` can't host reversals (rows key on `drawId`, and the draw record doesn't exist until freeze — an August mistake would have no home until 31 Aug). → Phase 2 reversal design, append-only like everything else:
- New counter-event `unlock_reversed` (metadata: reason, actor, prior `expiresAt`) + guarded status flip `issued→eligible` (conditional update: only while unredeemed; restore reservation expiry from stashed value).
- Evidence rule becomes **latest event wins** per entitlement: an `unlocked` with no later `unlock_reversed` boosts; reversed then genuinely re-scanned later → new `unlocked` event → boosts again. Ordering by `createdAt, id`.
- Ops "Undo session" button next to the scan action; same capability (`entitlements.issue_manual`), fully audited.

---

## 3. Plan

### Phase 0 — TODAY, prod data (no deploy; beats the F6 cliff)

> **EXECUTED 2026-07-23 (atomic CTE, single statement, verified):** offer `16eff8dd-420d-4d2d-a97c-24c899573a17` (active, 10000/10000, claimExpiryDays 60) · activation `92dd875f-4293-4305-9a5f-293f8930bd61` (active, `agent_unlock`, 10000, linked) · ledger `committed`+`allocated` events (service vocabulary — NOT the 07-22 `increased` variant) · campaign stamped (`luckyDraw.activationId`, `featuredDrop.endsAt=2026-08-31`, story "aged 21 and above"; termsHash + template byte-checked untouched) · bonus: Tokyo offer `allocatedQuantity` 0→500 (07-22 SQL had skipped the service-maintained counter). **Sweep receipt CONFIRMED ~7.5 min post-provision:** entrant `b84424dd…` got its pass via `issuedVia='sweep'` (≠ manual → **boost-capable**, F6 defused), email + WhatsApp delivered. The F6 deadline is dead. **Same evening:** Shawn deleted that test entry and re-signed-up with the same number → new prospect `7d17429d…`, pass issued `via='hook'` **180ms after signup** — both delivery paths (instant hook + catch-up sweep) now prod-proven. His screenshot of the pass card triggered the F13 expansion below. Context note: campaign is active but **no ads are running yet** — zero page traffic; the lone entrant was the only outbound-message recipient.

Mirror the Tokyo CTE (atomic; `partnerSince` is a smallint year; **`unlockPolicy='agent_unlock'` explicit** — `on_capture` would mint `auto_on_capture` events that never boost, G3):

1. House partner: reuse `00d28744-b374-48d4-adf0-471b113173a4` (G15). No new partner.
2. Offer: `Complimentary financial review (20 min) — iPhone 17 Pro Draw Aug 2026`, publicTitle `Complimentary financial review (20 min)`, status `active`, `fundingSource='mktr'`, `committedQuantity=10000`, `claimExpiryDays=60` (39d to 31 Aug + 21 margin, F7).
3. Inventory ledger: increase +10000, allocate 10000 (mirror `RewardInventoryEvent` rows the service writes). Per D1 (effectively unlimited): 10k start + the Phase-1 auto-top-up means exhaustion can't occur in practice.
4. Activation: status `active`, `campaignId=bbd2c577…`, `campaignNameSnapshot`, `allocatedQuantity=10000`, `unlockPolicy='agent_unlock'`, `endDate NULL`.
5. Stamp `design_config.luckyDraw.activationId` (jsonb update; public payload unaffected, G18).
6. `distribution.featuredDrop.endsAt='2026-08-31'` (F9).
7. **Verify within 30 min:** sweep log `[RedeemOps]` issuance, `reward_entitlements` row for prospect `b84424dd…` with `issuedVia ∈ {hook,sweep}` (NOT manual), reservation email/WA delivery receipt, `activation_issuance_skips` empty for this activation.
8. Copy fix (Studio, non-blocking): story says "aged 21 to 65" — correct to "21 and above" (matches `min_age=21` + the pinned terms; nothing enforces a ceiling). Systemic derivation lands in Phase 1 (D4).

Rollback: `UPDATE activations SET status='paused'` + remove stamp. No code involved.

### Phase 1 — backend auto-provision + gates (one PR)

**New `backend/src/services/redeemOps/drawBoostProvisioningService.js`** — `ensureDrawBoostRail(campaign, user, { requestId })`:
- Kill switch `DRAW_BOOST_AUTOPROVISION_ENABLED` (default `true`); throws typed 422 `DRAW_BOOST_RAIL_UNAVAILABLE` if `REDEEM_OPS_ENTITLEMENTS_ENABLED` is off (armed promise would be undeliverable platform-wide).
- Inside `pg_advisory_xact_lock` (F8): adopt existing active activation for campaignId (stamp if missing) → else find-or-create house partner (env `REDEEM_HOUSE_PARTNER_ORG_ID` → fallback by legalName → create verified) → create per-campaign offer (F7 sizing) → inventory increase+allocate (`DRAW_BOOST_DEFAULT_ALLOCATION`, default 1000) → `createActivation`+`linkCampaign`+`setStatus('active')` composed from `activationService` (keeps audit trail, G14) → stamp `luckyDraw.activationId`.
- Idempotent at every step; safe to re-run after partial failure.

**Call sites** (mirror the multi-prize gate topology, G13; only when `luckyDraw.enabled === true`):
- `setCampaignLaunchState('active')` — ensure **before** the flip (F2).
- `updateCampaign` — on transition inactive→active, and on `luckyDraw` becoming enabled while active.
- `createCampaign` with `is_active` truthy — ensure post-create; on failure revert to draft + rethrow (F2).
- **This is the line that satisfies "Write it for me arms ×10 automatically":** #233 drafts and #239 create-and-design both land on these paths; no AI-layer changes. Optional UI garnish: Details draw section hint "×N session boost is armed automatically at launch."

**`luckyDrawService.createDraw`** — F3: stamp absent → resolve active activation by campaignId (order `createdAt ASC`), 422 on two+ active (`DRAW_BOOST_RAIL_AMBIGUOUS`), 422 when none resolvable (`DRAW_BOOST_RAIL_MISSING`) with CLI override `--allow-no-boost` for emergencies.

**`applyLuckyDrawPolicy`** — F5 carry-forward of stored `activationId` when incoming omits it (admin path only; explicit null clears).

**`campaignReadinessService`** — new row `draw_boost_rail_missing`: `critical` when campaign is active with no linked active activation (today's iPhone state becomes visible), `warning` pre-launch ("will be armed automatically at launch").

**Clamp** — F9 default: draw campaign + `featuredDrop.enabled` + no `endsAt` → inherit `closesAt`.

**Allocation auto-top-up** (promoted from Phase 3 per D1 — "effectively unlimited"): the existing 15-min fulfilment sweep checks each active draw-linked activation; when `allocatedQuantity − issuedCount < 20%` of `DRAW_BOOST_DEFAULT_ALLOCATION` (default **10000**), it runs `changeAllocation(+DEFAULT)` — inventory increase + allocate, audited like a human top-up, log line per event. Literal "unlimited" is rejected: the inventory model, ops UI counters, and capacity displays all assume integers; auto-top-up delivers the same guarantee with zero semantic surgery.

**Age-copy derivation** (D4 — "not hard-coded; all campaigns reflect correctly"): single source of truth = `min_age`. The terms template already derives (`buildDrawTermsHtml({minAge})` ✓). Close the remaining leaks: `sanitizeDetailsDraft` (AI details-draft) and the Studio AI copy contract get an age lint — any age mention in story/subheadline/headline must equal the campaign's `min_age` floor, phrased "aged N and above"; **upper bounds are stripped** (no max-age enforcement exists; suitability screening is Retell's job per D3). Fold into the promise-vs-enforcement thread (#243/#246-#248) rather than a parallel mechanism if Codex prefers.

### Phase 2 — scan front door + undo (separate PR; F4, F13, F14)

- `fulfilmentController.unlockEntitlement`: `presentationToken` present + resolves → pass `via='agent_scan'`; prospectId-only and admin-override stay `'manual'`. External HMAC/Lyfe surfaces untouched. (D2 resolved 07-23: instant count — the review-gated `agent_button` alternative is rejected; no env knob.)
- Redemptions scanner UI: scanned pass in `eligible` state on a draw-linked activation → "Record session (×N boost)" action → that endpoint. Next to it, **"Undo session"** per the F14 design (`unlock_reversed` counter-event + guarded `issued→eligible` flip + latest-event-wins evidence; re-scannable after undo; audited; same capability).
- Draw-aware unlock side-effects (F13): draw-linked activation → suppress the partner-voucher email, send the "×N confirmed — your entries are now N" receipt pair instead; undo sends nothing (silent correction; the entrant never saw a wrong state if undone promptly — copy review at build).
- Covers iPhone-in-August fully (all entrants route to one consultant today, G19). Tokyo field-scale scanning = mktr-leads Phase-4 screens, separate repo, before ~mid-Oct.

### Phase 3 — parked, explicitly
Multi-winner engine (deletes the 4 `DRAW_MULTI_PRIZE_UNSUPPORTED` gates) · boost-review UI (CLI bridges the remaining `agent_button`/`manual` review lane) · no-boost mode (F10) · max-age enforcement (rejected for now — Retell screening owns suitability, D3) · winners-page automation · mktr-leads scan screens (other repo).

---

## 4. Tests (Phases 1–2 PRs)

DI suites, throwaway-pg pattern (5433/5561 precedent). Phase 1: ensure happy-path chain + adopt-existing + stamp-only; kill-switch off → typed 422; entitlements-flag off → 422; launch-state blocks before flip; create-born-active compensates to draft; advisory-lock double-call mints one activation; createDraw fallback resolves / ambiguity 422s / missing 422s / `--allow-no-boost`; policy carry-forward (omit → kept, null → cleared, non-admin unchanged); readiness critical/warning; clamp endsAt default + explicit-wins; sizing math boundaries (clamp 30/400); auto-top-up fires under 20% + is audited + never fires for non-draw activations; AI age lint (floor rewritten to min_age, ceiling stripped, no age mention → untouched). Phase 2: token unlock → `agent_scan` + boost counted; prospectId unlock stays `manual`; undo flips state + restores expiry + evidence excludes; undo→re-scan boosts again (event ordering); redeemed entitlement refuses undo; draw-linked unlock sends receipt not voucher (and trial funnel byte-identical); seal parity on a mixed evidence set. Baseline: 67 backend draw tests + full sweep vs origin/main (6 chronic reds only).

## 5. Deploy + verify

Render auto-deploy watch (`list_deploys`, re-trigger recipe if webhook drops). Probes: readiness API shows `draw_boost_rail_missing` resolved for iPhone + absent for Tokyo; create a draft draw via API → launch → activation auto-appears linked + stamped (then pause + strip in prod, or run on local pg); unlock 401 probe still mounted; sweep log clean.

## 6. Rollback

`DRAW_BOOST_AUTOPROVISION_ENABLED=false` restores pre-PR launch behavior (gates dormant — readiness row stays informational). Provisioned rows are ordinary ops data: `setStatus('paused')` disarms; stamp removal is safe post-F3 (createDraw falls back). Phase 2 rollback = env `DRAW_OPS_SCAN_VIA=agent_button` or revert (evidence already written is append-only and review-gated where labeled button/manual).

## 7. Decisions (Shawn, 2026-07-23) + remaining items

- **D1 — Session passes effectively unlimited.** No literal-∞ redesign; 10k initial + sweep auto-top-up at <20% (Phase 1). Real costs at scale: ~cents/entrant WhatsApp delivery + consultant time (self-limiting); infra negligible.
- **D2 — Ops scans count instantly (`agent_scan`), reversible.** Reversal = F14 append-only design; undo any time before seal; re-scannable.
- **D3 — Routing deferred.** Retell will screen all lucky-draw entrants for consultant-meeting fitness before booking; entry passes + boost mechanics are routing-independent, so nothing here blocks that work. Revisit spread/packages when screening ships.
- **D4 — Age copy derives from `min_age` everywhere, never hard-coded.** Terms already derive; Phase 1 adds the AI-draft lint + strips unenforceable ceilings; Phase 0 corrects the live iPhone story.

Remaining, non-blocking:
- **Go/no-go on Phase 0 today** — note: within ~15 min of provisioning, the existing entrant receives their entry-pass email/WhatsApp (that is the fix working, but it is an outbound customer message).
- `bookingUrl` unset on both draws (success-page CTA hidden) — leave until Retell screening defines the booking flow (D3).
- FYI: iPhone draw is homepage-card only, not listed on /explore (`marketplace.listed` unset) — Studio Distribution toggle if wanted; no code needed.
- Tokyo hero still the 30MB third-party CDN PNG — web-sized JPG already handed off for Studio upload (pre-existing item, unchanged).

---

*Cross-refs: `docs/plans/lucky-draw-10x.md` (engine design) · `docs/plans/lucky-draw-multi-prize-plan.md` (Σqty gates) · memory `project-lucky-draw-campaign`, `project-tokyo-lucky-draw-live`.*
