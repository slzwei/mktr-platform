# Draw launch integrity — consolidated scope (boost rail + gates + screening interaction)

**Date:** 2026-07-24 · **Author:** Claude (Fable 5) · **Status:** SCOPE — **Codex R1 folded (§9)**: PR-0/PR-1 amended-and-GO (reduced), PR-2/PR-3/PR-4 carry redesign notes that must be resolved in the implementation PRs. Where §§2–5 conflict with §9, **§9 wins.**
**Supersedes/extends:** `draw-boost-rail-auto-provision.md` (07-23, "awaiting Codex review") — that plan's Phases 1–2 are adopted here verbatim as PR-2 and PR-4; its ground truth is partially stale (see §0). Read that doc for F1–F15/G1–G19 and D1–D5; this doc continues the numbering (G20+, F16+, D6+).
**Trigger:** 07-24 full-funnel trace of the live iPhone draw (`ac7b03c0-57bf-409e-bd7b-740e1d180e09`) surfaced a class of silent failures the 07-23 plan predates — a lead that passed AI screening looped un-deliverable forever, the reward rail was detached, and the page/terms contradicted each other on prize and age. Root principle for everything below: **a draw campaign must not be able to run while promising something the platform cannot deliver — and when it does, it must fail loudly, not silently.**

---

## 0. What changed since the 07-23 plan was written

| # | Fact | Consequence for the old plan |
|---|---|---|
| G20 | Shawn **deleted the August twin `bbd2c577…`** (0 leads). Sole iPhone draw is now `ac7b03c0…` — active, closes **2026-09-30** (boostClosesAt same), ages **25–65**, `form.gates.screeningCall=true` | G1/G10/G19 + "iPhone has until 31 Aug" are stale. Phase-0 receipts (activation `92dd875f`, offer `16eff8dd`) survived the deletion — campaign FK was set-null'd, not cascaded |
| G21 | 07-24 remediation already executed on the survivor: activation `92dd875f` **re-attached** (active, 10000/1 issued); prize corrected iPad→**iPhone 17 Pro 256GB** in `luckyDraw.prize`, `prizes[0].name`, and terms; terms age "21 and above"→"aged 25 to 65"; **terms v3 minted properly** (`draw_terms_versions` v3 `fd7972a2…`, sha256 `6b031f79…`, `termsVersionId`+`termsHash` re-stamped, hash-chain verified) | The old plan's Phase-0 "re-run for the survivor" is NOT needed — except the stamp, G22 |
| G22 | **Survivor has NO `luckyDraw.activationId` stamp** (verified 07-24: key absent). `createDraw` today reads only the stamp (old G4) — the F3 fallback is unbuilt | Without PR-0 §4.1 or PR-2, the September draw would be created with `activationId=null` → `collectBoostEvidence` returns empty → **every entrant seals at 1×** |
| G23 | **Pass-expiry foot-gun is live again (old F7, new dates):** offer `claimExpiryDays=60` was sized for the twin's Aug-31 close. Survivor's boost window ends Sep 30; the existing pass (`78fc83b3…`) **expires 2026-09-22** — 8 days inside the window. `expireReservations` will kill it; expired rows block reissue (unique has no status filter) | PR-0 §4.2 resizes; formula (old F7) demands `daysUntil(boostClosesAt)+21 ≈ 90` |
| G24 | **Retell screening SHIPPED and is ON in prod** (`RETELL_SCREENING_ENABLED=true`, agent `agent_4ea24f4a…`, from `+6562773210`; window 10:00–20:00 SGT; sweep 5-min). Old D3 treated it as a future initiative | A brand-new failure surface the old plan never considered — G25 |
| G25 | **Screening × no-funded-agent = permanent silent dead-end (observed live).** Capture bakes `screeningMetadata.intendedAgentId` from the routing decision even when `via='fallback'` (System Agent). System Agent has no `lyfeId`/`mktrLeadsId` → `destinationForAgent`=null → `persistEventDeliveries` default-denies → `releaseScreenedLead` rolls back `no_subscriber` → sweep job 1 retries **every 5 min forever**. TTL/drain jobs only match `screeningVerdict IS NULL`, so a QUALIFIED lead is unrescuable by design. Prod evidence: lead `f95fe2cf…` (Shawn's test, qualified 11:48Z) still looping; log line `[Screening] release: no delivery subscriber — re-holding` every 5 min since | PR-1 fixes the bake + adds the alarm; readiness gains a funding row. NOTE: `releaseScreenedLead` already re-resolves when `intendedAgentId` is null and **refuses** `via='fallback'` results — the null-bake fix makes stuck leads auto-heal the moment funding lands, no new release code |
| G26 | Shawn funded the survivor 07-24: mktr-leads agent `6707439d…` ("Basic Package", **10 credits**). Future leads route `via='package'` and deliver on qualify | The dead-end is dormant, not dead: it re-arms silently at 0 credits. Hence `lead_credits_low` readiness + the PR-1 alert |
| G27 | **`max_age` IS enforced at capture** (`prospectService` age gate 422s above it; survivor 25–65 live). Old D4's premise "no max-age enforcement exists → strip ceilings" is **wrong for campaigns with `max_age` set** | D4 amended (D8): age copy derives BOTH bounds when `max_age` is set — "aged {min} to {max}"; ceilingless only when `max_age` is null. Retell screening likewise already speaks both bounds (`{{age_min}}–{{age_max}}`) |
| G28 | The prize/age contradictions shipped through Studio AI: terms said iPad + 21 while page said iPhone + 25–65, and the T&C is the **hashed, consent-pinned** artifact. `drawTermsTemplate.buildDrawTermsHtml` derives from `minAge` (floor-18) — the drift arose because stored terms are never re-checked against later campaign edits | PR-3: consistency lint compares STORED terms/copy against current campaign facts; fix path = regenerate via template + `ensureDrawTermsVersion` mint (never in-place edits) |
| G29 | Survivor `distribution = {host:'redeem'}` only — **no featuredDrop, not marketplace-listed**. Reachable by direct link only; old F9/G17 (card immortality) do not apply to it | Fine for testing; a Distribution decision is needed before ads (D9) |
| G30 | Success page + WA/email pass promise chain is now TRUE end-to-end for the survivor (pass issues at signup via hook; sweep as backstop — both prod-proven). The remaining promise gaps are ×10 evidence (old F4) and the draw record itself | PR-4 (scan door) + the readiness `draw_record_missing` row (PR-1) |

---

## 1. Workstream → PR map

The old plan's structure is kept; new work slots around it. **Backend remains the choke point** (old ground rule) — every gate/ensure lands in `campaignService` + services, never in the AI layer.

| PR | Contents | Origin | Size |
|---|---|---|---|
| **PR-0** | Prod data ops, no deploy (§4) — stamp, expiry resize, stuck-lead heal, title tidy | new | ops-only, today |
| **PR-1** | Screening×draw integrity: null-bake fix, loud alarms, readiness rows (funding / credits / draw-record) | new | **S–M** |
| **PR-2** | `ensureDrawBoostRail` auto-provision + createDraw fallback + stamp carry-forward + delete-path unification + auto-top-up + featuredDrop clamp + age-lint (amended per D8) | old plan **Phase 1**, adopted verbatim + D8 amendment | **M–L** |
| **PR-3** | Draw promise-consistency lint (prize / age / dates / multiplier vs stored terms & copy) at gate sites + readiness + Studio surfacing | new | **S–M** |
| **PR-4** | Boost scan front door (`agent_scan` via token) + Undo (F14) + draw-voiced delivery (F13/D5 card, `draw_entry_pass` template) + 2 cosmetic nits (§5.4) | old plan **Phase 2**, adopted verbatim + nits | **M–L** |

Sequencing: PR-0 today → PR-1 first code PR (stops the live silent-failure class; smallest) → PR-2 (the centerpiece; already fully specced) → PR-3 (can develop in parallel with PR-2; both touch `campaignService` gate sites — rebase PR-3 on PR-2's merged gate topology to avoid conflict) → PR-4 before any ad spend on the ×10 promise (the door must exist before the first consultant session; there is no shipped way to earn ×10 today — old G5).

---

## 2. PR-1 — screening × draw integrity (new; the "fail loudly" PR)

**2.1 Null-bake fix (the one-line root fix).** In `createProspect`, when the routing decision that feeds the screening hold has `via==='fallback'` (System Agent), store `screeningMetadata.intendedAgentId = null` instead of the System Agent id. Same for the DNC-hold mirror (`dncMetadata.intendedAgentId`) — it hands off into screening (G25 note: `releaseScreenedLead` already re-resolves null and refuses fallback, so held leads **auto-heal when funding arrives** via the existing 5-min sweep; no release-side change).
- Files: `backend/src/services/prospectService.js` (~2 lines at the bake sites), tests in the existing screening DI suites.

**2.2 Loud, rate-limited alarm on the un-deliverable state.** `releaseScreenedLead`'s `no_subscriber` / `no_intended_agent` returns today log a warn per 5-min sweep pass, forever, and nothing else. Add: (a) one ProspectActivity ("Held — qualified but no deliverable agent (fund a package)") written ONCE per lead (guard: only if last activity isn't already it); (b) an ops email via the existing alert-mail pattern (`SMS_ALERT_EMAIL` precedent) when a qualified lead has been held >30 min, throttled to one email per campaign per 24 h.
- Files: `screeningGate.js`, `screeningSweepService.js`, small helper; DI tests for the once-only guard + throttle.

**2.3 Readiness rows** (extend `campaignReadinessService`, precedent old G13):
- `screening_no_funded_route` — **critical** when `form.gates.screeningCall=true` on an active campaign AND zero funded package assignments for it AND no `DEFAULT_AGENT_ID`; **warning** pre-launch.
- `lead_credits_low` — **warning** when a screening or draw campaign's funded pool has <20% credits remaining (mirrors the auto-top-up threshold aesthetic; G26 makes this the re-arm tripwire).
- `draw_record_missing` — **warning** when `luckyDraw.enabled` and now > `closesAt − 7d` with no draw row; **critical** past `closesAt` with none (the "witnessed draw that never happens" T&C breach). Execution itself stays manual/witnessed via `run-lucky-draw.js` — this row is the reminder, not automation (parked, §6).

**2.4 Non-goals for PR-1:** no hard launch block on funding (D7 recommends readiness-critical only — the null-bake fix makes under-funding self-healing rather than lead-corrupting, and blocking would fight the "fund after launch" workflow).

---

## 3. PR-3 — draw promise-consistency lint (new)

**3.1 `assertDrawConsistency(campaign, designConfig)`** in `campaignService`, called at the same sites as the multi-prize gate (create-born-active / `updateCampaign` willBeActive / `setCampaignLaunchState('active')`) for `luckyDraw.enabled` docs. Checks, each with a typed 422 code:
- **Prize parity** (`DRAW_PRIZE_MISMATCH`): normalized `luckyDraw.prize` must appear in the terms `Prize:` clause; `prizes[0].name` must equal `luckyDraw.prize` (single-prize era). Content headline/story get a **warning-level** readiness row, not a 422 (marketing copy may legitimately shorthand — "Win an iPhone 17 PRO" vs "iPhone 17 Pro 256GB" must not block).
- **Age parity** (`DRAW_TERMS_AGE_MISMATCH`): the terms eligibility clause must state the campaign's current `min_age`(+`max_age` when set, per D8). Implementation: regex the stored clause (`aged N( to M| and above)`) and compare numbers — not string-equality with the template (operator-authored terms are legal).
- **Date parity** (`DRAW_TERMS_DATE_MISMATCH`): terms close-date mention vs `luckyDraw.closesAt`; multiplier mention ("N entries/chances") vs `luckyDraw.multiplier` — warning-level both (dates in prose are format-varied; false-422s on live funnels are worse than a warning).
- **Remediation path:** the 422 payload carries `{fix: 'regenerate_terms'}`; Studio's existing terms flow re-runs `buildDrawTermsHtml` with current facts and `ensureDrawTermsVersion` mints the new version (the ONLY sanctioned fix — never in-place; the 07-24 manual v3 mint is the worked example, G21).
- **Readiness mirror:** same checks as a `draw_promise_inconsistent` row (critical when live) so an already-active drifted campaign becomes visible without waiting for its next save (today's iPad case would have lit up).

**3.2 Files:** `campaignService.js` (gate + helper), `campaignReadinessService.js`, Studio readiness panel row (frontend, small), fixture-driven unit suite — the literal iPad/21-vs-25 production doc as the regression fixture.

**3.3 Interaction with PR-2:** PR-2's D4-amended age lint governs what the AI **writes**; PR-3 governs what the campaign **is** at launch regardless of author (AI, admin, or SQL). Complementary, not duplicate — keep both, share the clause-parsing helper.

---

## 4. PR-0 — prod ops today (no deploy)

1. **Stamp the survivor:** `design_config.luckyDraw.activationId = '92dd875f-4293-4305-9a5f-293f8930bd61'` (jsonb_set; public payload strips it — old G18). Removes the G22 seal-at-1× time bomb independent of PR-2's fallback shipping.
2. **Resize the pass window (G23):** offer `16eff8dd` `claimExpiryDays` 60→**90** (covers signup→Sep 30 + 21d margin); extend live entitlement `78fc83b3` `expiresAt` → **2026-10-14** (boostClosesAt + 14d claim buffer). Also tidy the internal title "…Draw Aug 2026" → "…Draw Sep 2026" (`publicTitle` already correct: "iPhone 17 Pro Lucky Draw Entry Pass").
3. **Heal the stuck test lead (needs D6):** set `screeningMetadata.intendedAgentId = null` on `f95fe2cf…` → next 5-min sweep re-resolves to the funded agent `6707439d…`, charges 1 credit, fires `lead.created` to mktr-leads — the full pipeline proven end-to-end. Alternative: delete the test lead (its pass then needs the F15 caveat checked). **Recommend deliver.**
4. **Verify:** skips table stays empty for the activation; the 5-min re-hold log line stops; entitlement expiry reads Oct 14; readiness (manual SQL until PR-1) shows a funded route.

Rollback: every item is a plain UPDATE with the prior value recorded in this doc's PR-0 execution note (append receipts on execution, house style).

---

## 5. Adopted-verbatim summaries (details live in the old plan)

- **5.1 PR-2 = old Phase 1.** `ensureDrawBoostRail()` (advisory-locked, idempotent, kill-switch `DRAW_BOOST_AUTOPROVISION_ENABLED`) at `setCampaignLaunchState` / `updateCampaign` / `createCampaign`-born-active (ensure-not-assert, old F2); `createDraw` by-campaign fallback + ambiguity 422 (F3); `applyLuckyDrawPolicy` stamp carry-forward (F5); prospect-delete entitlement unification (F15); allocation auto-top-up at <20% (D1); featuredDrop `endsAt` clamp (F9); AI age-copy lint **amended by D8** (derive both bounds when `max_age` set — G27 kills the strip-ceilings rationale). Note for Codex: old plan's Phase 0 is DONE and must not be re-run; the survivor's rail exists (G21) and PR-0 stamps it.
- **5.2 PR-4 = old Phase 2.** Ops unlock derives `agent_scan` from a resolving `presentationToken` (D2: instant, no review); "Record session (×N boost)" + **"Undo session"** (F14 append-only reversal, latest-event-wins); draw-voiced delivery: Draw Entry Card (D5 line-set), unlock receipt "×N confirmed" suppressing the partner-voucher email (F13), WA sender `WHATSAPP_TEMPLATE_DRAW_PASS || 'draw_entry_pass'` (approved UTILITY).
- **5.3 Hard external dependency held by PR-4:** until it ships, **no shipped surface can mint a countable boost** (old G5 — all 7 prod unlocks are `manual`, review-gated). Do not start paid traffic promising ×10 before PR-4 is live, or change the promise copy.
- **5.4 Cosmetic nits folded into PR-4's frontend touch:** `ShareCampaignDialog.jsx:100` missing spaces (`Share"{name}"with others.`); `LeadCaptureOutcomes.jsx:184-198` public error screen's only CTA is `→ /Dashboard` ("Back to Safe Zone") — point it at the campaign page or redeem.sg home.

---

## 6. Parked (unchanged from old plan §Phase 3, plus)

Multi-winner engine · boost-review UI · no-boost mode (F10) · winners-page automation · mktr-leads Phase-4 scan screens (separate repo; Tokyo field-scale) · **draw execution automation** (freeze/seal/draw stay manual+witnessed per T&C; PR-1's readiness row is the forget-proofing) · booking flow / `bookingUrl` (D3 — Retell screening owns the meet-arrangement UX; success-page CTA stays hidden until then).

---

## 7. Test + rollback summary

- **PR-1:** DI suites — fallback-bake nulls id (screening + DNC mirror); null-id release re-resolves and refuses fallback; auto-heal on funding (sweep pass delivers after a package appears); once-only activity guard; alert throttle; 3 readiness rows over fixture states. Rollback: revert — no data shape changes (`intendedAgentId:null` is already a legal state the release path handles).
- **PR-2:** old plan §4 list verbatim. Rollback: `DRAW_BOOST_AUTOPROVISION_ENABLED=false`.
- **PR-3:** fixture matrix incl. the live iPad/21 doc as regression; 422 only on launch transitions; warning-not-block cases proven. Rollback: gate no-ops behind `DRAW_CONSISTENCY_GATE_ENABLED` (default true).
- **PR-4:** old plan §4 list verbatim (+ nit snapshots). Rollback: old plan §6.
- All PRs: baseline = full sweep vs origin/main, chronic reds only (per repo memory).

---

## 8. Decisions needed (Shawn)

- **D6 — stuck test lead `f95fe2cf`:** deliver via re-resolve (recommended; proves pipeline; spends 1 credit; notifies your consultant mirror + mktr-leads app) or delete.
- **D7 — screening funding gate strength:** readiness-**critical** only (recommended; null-bake makes under-funding self-healing) vs hard 422 block on activation.
- **D8 — age-copy rule (amends old D4):** derive BOTH bounds when `max_age` is set — "aged 25 to 65" (recommended; matches live enforcement, G27) vs old strip-ceilings rule.
- **D9 — distribution before ads:** survivor is direct-link-only today (G29). Decide featuredDrop/marketplace listing when ad traffic starts; no code needed.

---

## 9. Codex R1 (2026-07-24, gpt-5.6-sol xhigh) — verified dispositions + amendments

24 findings; NO-GO on PR-0 as originally written. Every load-bearing claim was re-verified against this repo (Codex's file:line cites were frequently mangled — `frontend/src/features/…`, `backend/src/constants/…` don't exist — but the substance checked out in **every** pivotal case). Dispositions below; **amendments here supersede the conflicting §§2–5 text.**

### 9.1 Verified-and-accepted (with amendments)

| CX# | Finding | Verified evidence (this repo) | Amendment |
|---|---|---|---|
| 1 | **BLOCKER — DNC release path never re-resolves.** `releaseDncClearedLead` returns `no_intended_agent` and leaves the lead held when `agentId` is null; `gateHeldDncLead` passes the stored bake straight through. A null-baked DNC lead whose screening handoff declines (campaign gone, gate off, module failure) strands | `dncGate.js:77-82,216` | **PR-1 §2.1 amended:** add same-campaign re-resolution (refusing fallback) to `releaseDncClearedLead`, mirroring screening's. The doc's "no release-side changes" claim is withdrawn. (Not live-reachable today — survivor has `dncCheck:false` — but correctness, not urgency, is the point) |
| 3+ | **DEFAULT_AGENT_ID nuance — both my doc AND Codex's fix are wrong.** A configured `DEFAULT_AGENT_ID` resolves `via:'fallback'` (`systemAgent.js:27-37,83`) so release re-resolution refuses it — Codex right that my readiness exception is broken. But Codex's "remove the exception" misses: TODAY a provenance-carrying default agent works via the **non-null bake** (destination resolves, delivery succeeds) — an unconditional null-bake would REGRESS that setup | `systemAgent.js` + `screeningGate.js:196-199` + `prospectHelpers.js` destination logic | **PR-1 §2.1 amended:** bake null iff `via==='fallback'` AND the resolved agent has no `lyfeId`/`mktrLeadsId` (one User lookup, held path only). Readiness row drops the DEFAULT_AGENT_ID clause entirely (prod has none set anyway — verified env list) |
| 2 | Null-safety of refunds holds only via the undocumented invariant *fallback ⇒ `charged:false`* (`leadQuota.js`: soft→assign uncharged; quota+fallback→quarantine `no_funded_agent` before screening applies) | `leadQuota.js` decideAssignment (verified pre-Codex, independently) | **PR-1:** encode the invariant as a test; consider `chargedAgentId` split in PR-2's refund touching, not PR-1 |
| 4 | Stale NON-null routes unvalidated at release (agent deactivated/defunded since capture); soft-quota deduct result ignored | `screeningGate.js:206,245-248,264` | **PR-1 (small):** on release, when un-charged, validate the stored agent (active + role) and re-resolve if invalid — same refuse-fallback rule |
| 5 | "Charge exactly one credit" overclaimed — soft campaign ⇒ best-effort `deductLeadCredit`, not authoritative | `screeningGate.js:206-248`, verified survivor `enforce_lead_quota=false`, `leadPriceCents` null | **§4.3 wording amended:** "one best-effort deduction attempt." Preflight list → §9.3. All preflight facts for the stuck lead were gathered live this session (agent active+`mktrLeadsId` ✓, package active 10 credits ✓, `mktr_leads` subscriber enabled with `lead.created` ✓, `WEBHOOK_ENABLED=true` ✓, lead still `screening_pending`+qualified+no active call ✓) |
| 6 | Stamp is save-fragile: `applyLuckyDrawPolicy` replaces `luckyDraw` wholesale; ONLY the terms keys are re-ensured on save (`ensureDrawTermsVersion`), `activationId` is not — any stale Studio/admin tab save wipes it until PR-2's F5 carry-forward lands | `utils/luckyDraw.js` + `campaignService.js:584` | **§4.1 amended:** stamp anyway (harmless, and createDraw is a September task PR-2 precedes), but it is a STOPGAP any save can undo — re-verify + re-stamp immediately before `createDraw`; PR-2's F5 + createDraw fallback are the real fix |
| 7 | **Oct-14 expiry creates a false-success window**: unlock gates only on `expiresAt > now` (verified in the conditional UPDATE's WHERE), while boost evidence requires `createdAt < boostClosesAt` — a scan Oct 1–14 says "×N confirmed" and earns nothing | `entitlementService.js` unlock WHERE + `luckyDrawService.js` evidence bound | **§4.2 amended:** existing pass `expiresAt` → **2026-09-30 SGT day-end** (not Oct 14). `claimExpiryDays`→90 stays (else early-signup passes die BEFORE the cutoff — the worse failure). The residual false-window for future passes (issue+90d > Sep 30) is closed by a code clamp `min(issue+claimDays, boostClosesAt-end)` for draw-linked activations — added to **PR-4** (with the scan-time cutoff check); until then, ops discipline: no scans after Sep 30 |
| 8 | Test lead enters the September pool either way (freeze filters only campaign/phone/time/verified-stamp — no test flag exists on prospects, none on DrawEntry) | `luckyDrawService.js` freeze (verified pre-Codex) | **D6 rewritten** (§9.4) |
| 9,10 | **PR-2 lifecycle as adopted CANNOT work via the services:** `createOffer` 422s unless partner `pipelineStage==='PARTNERED'` (house partner is `LOST` — old G15's "no gate reads pipelineStage" is now false); offers are born `draft` and `createOffer` never activates; activation transitions are `draft→preparing→active` (no direct `draft→active`), `active` requires campaignId | `redeemOps/rewardService.js:77`, `RewardOffer` model, `activationService.js:11-17,215` | **PR-2 redesign note:** provisioning must either (a) require an env-pinned, stage-validated PARTNERED house partner + compose the real transition chain (offer create→activate; activation draft→preparing→active with campaign linked), or (b) be a first-class provisioning service doing model-level writes with its own audit rows. Phase-0 SQL worked precisely because it bypassed these gates |
| 11 | "Adopt any active activation" unsafe **but for a different reason than old-F8**: partial unique `uq_act_live_campaign` (preparing/active/paused, campaignId≠null) means ONE live per campaign — old plan's "two active rails" ambiguity is impossible/stale. Real risk: the one live activation may be `on_capture` (mints `auto_on_capture`, never boost evidence) and a second can't be created | `Activation.js` indexes (verified) | **PR-2 redesign note:** adopt only if `unlockPolicy==='agent_unlock'` + offer active; else FAIL the ensure loudly (typed 422 naming the conflicting activation). Add durable idempotency marker (offer `internalRef` is non-unique) |
| 12 | Auto-top-up as written under-specified: `changeAllocation` only allocates from committed capacity (invariant committed≥allocated); increasing committed is a separate op; the 15-min sweep has no cross-instance lock | `inventoryService.js:14,60,88` | **PR-2 redesign note:** top-up = advisory-locked recheck → increase committed → allocate → ledger+audit, atomically. Resolve 1000-vs-10000 default (old plan drifted; D1 says 10000) |
| 13 | Old F15 "two differing delete paths" stale — bulk loops single; NEITHER cancels entitlements (FK `SET NULL` orphans them) | `prospectService.js` delete + `models/index.js:282` | **PR-2 scope simplified:** add live-entitlement cancellation (+ inventory reversal) to the single-delete tx; bulk inherits |
| 14 | D8 correct but conditional: `max_age` enforced only when a usable DOB was submitted; DOB-required is a form choice; terms template accepts only `minAge` ("and above") | `prospectService.js` age gate + `drawTermsTemplate.js:71,103` (both verified) | **D8 expanded:** bounded-age draws require `fields.dob.required=true` as an activation invariant (readiness critical); template + AI facts + callers extended to carry both bounds |
| 15,16 | PR-3 regexes brittle (`<strong>Prize:</strong>` markup, `&mdash;`/`&times;`/`&amp;` entities); and "same gate sites" would 422 EVERY save of a live campaign (the multi-prize gate provably runs on every active-state save — `willBeActive` includes unchanged-active), not just launch transitions | `drawTermsTemplate.js` output + `campaignService.js:598-605` (verified) | **PR-3 redesign note:** normalize HTML→text (decode entities, collapse whitespace, casefold) before comparing; hard-422 only on launch transitions AND fact-touching saves with high-confidence contradictions; everything else = readiness warnings; ship the regenerate-terms action (typed `fix:'regenerate_terms'` + preview-confirm) in the same PR |
| 17 | Live-draw divergence: only `closesAt` is locked while a draw record exists; multiplier/boostClosesAt/terms/stamp can drift from the draw's snapshot and PR-3 would bless the drifted config | `campaignService.js:131-152` (verified — DRAW_CLOSES_AT_LOCKED covers closesAt only) | **PR-3 redesign note:** when a live draw row exists, parity target = the DRAW ROW's snapshot (multiplier, boostClosesAt, activationId, pinned terms), not just the config |
| 18 | Freeze admits verified entrants with NO draw-terms consent (enabling a draw on an already-running campaign sweeps in pre-draw leads) and never audits per-entrant accepted versions | `luckyDrawService.js` freeze filter (verified pre-Codex) | **PR-2 addition:** freeze requires per-entrant `consentMetadata.drawTerms` evidence; group by accepted version and surface cohorts whose material facts differ (the survivor's iPad-era v2 acceptors vs v3 is the live example — the ONE existing entrant accepted v2) |
| 19 | Readiness rows partially duplicate: `draw_record_missing` EXISTS (warning, line 196); `no_agent_pool` exists (warning); active-state read uses `is_active` only; void draws count as "has record" | `campaignReadinessService.js:96,196,231,257` (verified) | **PR-1 §2.3 amended:** modify/specialize existing rows (escalate `draw_record_missing` near close; screening-aware `no_agent_pool` variant), add only `lead_credits_low` + `screening_no_funded_route` as new; fix status-vs-is_active read; exclude void draws |
| 20 | Lifecycle incoherence incl. a real dial-guard bug: `!['active'].includes(status) && is_active===false` — an archived campaign with `is_active=true` still dials; qualified-release sweep ignores campaign state | `retellScreeningService.js:175` (verified pre-Codex) | **PR-1:** fix the guard to OR-semantics. Job-1 qualified-release stays deliberately state-INDEPENDENT (build decision, deviates from Codex's suggestion): dialing is new spend + a customer touch on a stopped campaign, but releasing an already-captured, qualified lead is fulfilment — same philosophy as the drain job. Full lifecycle matrix → PR-2 |
| 21 | Screening-FAILED entrants keep a 1× entry + a live pass they can theoretically still ×10 (entitlement quarantine-eligibility includes all three screening reasons; unlock needs an assigned consultant which failed leads lack — but admin/manual paths exist) | `entitlementService.js` + `screeningConstants.js` | **New decision D10** (§9.4) |
| 22 | PR-4 "record session" mints a REAL redeemable voucher (token, issued state, claim page renders redeemable, redemption accepts it) — email suppression doesn't change the state machine | `entitlementService.js` unlock (verified: mints token, overwrites expiry) | **PR-4 redesign note:** draw-linked rails need a purpose-aware branch: append boost evidence + receipt WITHOUT minting a redeemable credential (no token), and claim/redemption reject draw-only rails |
| 23 | Undo races seal (evidence read pre-transaction) and can't restore state (unlock overwrites `expiresAt`, event metadata is `{via}` only) | `luckyDrawService.js:386` + unlock UPDATE (verified) | **PR-4 redesign note:** stash prior expiry + superseded-event id in the reversal event; serialize undo vs seal (advisory lock or seal re-read inside tx); undo cutoff = `boostClosesAt` |
| 24 | PR-0 prod predicates must be preflighted transactionally | — | **§9.3 checklist** (all already gathered live this session; re-run at execution time) |

### 9.2 Codex claims corrected/rejected

- **CX3's fix as stated** (drop the exception, full stop) — replaced by the provenance-aware bake (see 9.1 row 3+). 
- **Old-plan F8** ("no unique index on activations.campaignId → double-provision race") — STALE, Codex right: `uq_act_live_campaign` exists. The advisory-lock in PR-2 remains for find-then-create atomicity, but the failure mode is a constraint violation, not silent duplication.
- No Codex finding was verified FALSE. Its file paths were unreliable; its reasoning was not.

### 9.3 PR-0 REDUCED — EXECUTED 2026-07-24 ~23:00 SGT (receipts)

> **All items done + verified.** (1) `luckyDraw.activationId` stamped = `92dd875f…` (STOPGAP — any Studio/admin save can wipe until PR-2's F5; re-verify before createDraw). (2) Offer `16eff8dd`: `claimExpiryDays` 60→**90**, title →"…Sep 2026". (3) Pass expiry → `2026-09-30 15:59:59.999+00` (SGT day-end = boost cutoff). (4) Preflight: all 6 checks true pre-execution. (5) **D6 heal→verify→delete EXECUTED:** nulled `intendedAgentId` 22:53 SGT → sweep released **22:57:12** to funded agent `6707439d` — credit charged 10→**9** (best-effort deduct, soft campaign), `lead.created` → MKTR Leads App **success/1 attempt**, activity "Released after AI screening (qualified)…" written. Pipeline proven END-TO-END (capture→screen→qualify→heal→release→deliver→charge). (6) Cleanup via SERVICE paths (minted admin JWT, user `c4a0f57a`): pass cancelled w/ audited reason + `issuedCount` reverted 1→**0** (inventory reversal ran), prospect deleted via `DELETE /api/prospects/:id` → `lead.deleted` → MKTR Leads App **success/1 attempt** (mirror cleaned, no ghost). Post-state: campaign has **0 prospects, 0 live passes** — phone + dup slots freed for re-testing; September pool starts clean (CX8/CX18 test-pollution moot). Residual known state: 1 charged credit (9 remaining) reflects the real delivered test lead in the mktr-leads app history — lead itself soft-deleted there by the mirror.

Original checklist (for re-runs):

1. Stamp `luckyDraw.activationId` (stopgap — any save can wipe; re-verify before createDraw). 2. Offer `claimExpiryDays` 60→90 + internal title "Aug→Sep". 3. Existing pass `78fc83b3` `expiresAt` → 2026-09-30 SGT day-end. 4. Preflight re-run at execution: lead `screening_pending`+`qualified`+`screeningActiveCallId IS NULL`; agent `6707439d` active+`mktrLeadsId`; package assignment active, `leadsRemaining>0`; `mktr_leads` subscriber enabled incl. `lead.created`; `WEBHOOK_ENABLED=true`; entitlement still `eligible`. 5. Item: heal stuck lead — **blocked on D6 only.** 6. After any heal: verify decrement (`leadsRemaining` 10→9), delivery row destination `mktr_leads`, activity trail; record before/after in this doc.

### 9.4 Decisions — updated set

- **D6 (rewritten):** stuck test lead `f95fe2cf` — it WILL be in the September pool if it exists at freeze (no test-flag mechanism). Options: (a) **heal → verify pipeline end-to-end → then delete the prospect + manually cancel its orphaned pass before freeze** (recommended — proves everything, pollutes nothing; note delete today orphans the pass, CX13, so the cancel is manual); (b) heal and keep as a genuine entrant (it's Shawn's own number — winning your own draw is a bad look); (c) delete now unproven.
- **D7:** unchanged (readiness-critical, no hard block) — reinforced by the provenance-aware null-bake making under-funding self-healing.
- **D8 (expanded):** both-bounds age copy + DOB-required as a hard invariant for bounded-age draws (CX14).
- **D9:** unchanged.
- **D10 (new, from CX21):** screening-FAILED entrants — choose: keep 1× + cancel their boost pass (draw promise stays, ×10 path honestly closed), or leave the pass live (they can still book/be scanned via admin paths). Recommend cancel-on-fail with T&C wording check.

---

*Cross-refs: `draw-boost-rail-auto-provision.md` (F/G/D 1-series, Phases → PR-2/PR-4) · `lucky-draw-10x.md` (engine) · `retell-screening-calls.md` (gate §5, release §9) · memory `project-lucky-draw-campaign` (07-24 addendum), `project-retell-screening-calls`. Codex R1 raw output: session scratchpad `codex_review_out.md` (2026-07-24).*
