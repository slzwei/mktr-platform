# Retell AI Screening Calls — Design & Implementation Plan

**Status:** IMPLEMENTED DARK 2026-07-23 (all backend + frontend slices merged behind `RETELL_SCREENING_ENABLED=false`; remaining: Phase 0 Retell-side setup §12, soak §16.3, per-campaign enablement). Plan text below is R2 — reworked after Codex review (gpt-5.6-sol xhigh, 2026-07-23; verdict on R1: NEEDS-REWORK, 18 findings, 15 accepted / 2 modified / 1 partially rejected)
**Date:** 2026-07-23
**Owner:** Shawn
**Depends on:** DNC scrubbing machinery (`docs/plans/dnc-scrubbing.md`), lead-quota hold machinery, design_config v2 twins, Redeem Ops entitlement hook

---

## §0 TL;DR

Per-campaign opt-in: after a lead is captured (web/QR funnel, **OTP-verified only**),
MKTR **holds** it and triggers an outbound Retell AI screening call. Qualified →
release to the assigned agent (first delivery, DNC-clear-style). Not qualified →
stays **held in MKTR** (`screening_failed`, admin held queue, credit refunded) and
never reaches an agent. Unreachable after N attempts → configurable policy
(default: release unscreened).

New hold reasons (existing `quarantineReason` STRING(64), no enum):

| Reason | Meaning | Terminal? | Credit | Admin-releasable? |
|---|---|---|---|---|
| `screening_pending` | Awaiting call / verdict / retry / delivery-retry | no | held (charged-at-capture kept) | yes — deliberate skip-screening override |
| `screening_failed` | AI verdict: not qualified | yes | **refunded** if charged at capture | yes — override (re-charges on release) |
| `screening_unreachable` | Max attempts / TTL, policy = hold | yes | **refunded** if charged at capture | yes — override (re-charges on release) |

R2 headline changes vs R1: OTP verified-stamp is a hard dial precondition (public
`POST /api/prospects` is unauthenticated — spoofed submits must never trigger paid
calls); no reuse of `retellCallId` anywhere (it is an **origin discriminator** that
suppresses CAPI); discrete fence columns instead of fenced-JSONB; attempt tokens
close the dial-accepted-but-response-lost gap; credit refund on terminal fail +
double-deduct guards on both manual release paths; qualified-but-undelivered
recovery state; sweep re-ordered (terminalize before dialing); DNC `flag`-mode
handled; reward-entitlement interaction surfaced as decision D8.

---

## §1 Current state (verified 2026-07-23; re-verified in Codex pass)

### §1.1 Backend
- **Inbound webhook**: `POST /api/retell/webhook` → `retellController.handleWebhook`
  (`backend/src/controllers/retellController.js:15`) verifies HMAC, unwraps
  `payload.call || payload.data || payload` (**drops `payload.event`** — controller:47),
  calls `processRetellCall(callData)` (`backend/src/services/retellService.js:157`).
- `processRetellCall` **creates a new prospect** from every successful ended call.
  Guards: non-ended skip (`:187`), `call_successful === false` skip (`:196` —
  negative calls currently leave **no record**). Idempotency: `IdempotencyKey`
  scope `retell:call` + unique `retellCallId` (index managed in bootstrap, **not
  mirrored in the model** — `Prospect.js:289` comment).
- **Public capture is unauthenticated and unverified**: `POST /api/prospects` is
  rate-limited only (`routes/prospects.js:26`), `phone` is optional Joi
  (`validation.js:182`), and an un-OTP'd POST still captures a lead — only the
  server-side verified stamp `sourceMetadata.phoneVerifiedAt` +
  `phoneVerifiedFor` (written iff `otpMarkerLive`, `prospectService.js:427,509`)
  distinguishes verified rows. Redeem Ops already uses that stamp as its
  anti-farming precondition. **Screening must too.**
- **`retellCallId` / `sourceMetadata.retellCallId` are origin discriminators**:
  `shouldFireCapi` returns false for any prospect carrying `retellCallId`
  (`metaCapiService.js:23`, mirrored in `tiktokEventsService.js`), and
  `buildLeadCreatedPayload`/`buildLeadAssignedPayload` treat
  `sourceMetadata.retellCallId` as "notes are a transcript"
  (`prospectHelpers.js:102,164`). Neither may be written on web leads.
- **Hold machinery** (reused): `quarantinedAt/quarantineReason`
  (`Prospect.js:239-248`); held ⇒ delivery suppressed (`prospectService.js:1087`,
  `retellService.js:399`). DNC born-held gate (`prospectService.js:852-895`),
  post-commit `gateHeldDncLead` (`dncGate.js:140`) → `releaseDncClearedLead`
  (`dncGate.js:42`): reason-scoped claim + authoritative charge + in-tx
  `persistEventDeliveries` outbox + fail-closed re-hold. DNC pattern = **discrete
  filter columns + JSONB evidence** (migration 041) — R2 copies that shape.
  Backfill: `dncBackfillService.js` (re-entrancy guard + pg advisory xact lock),
  scheduled `bootstrap.js:274-287`. `releaseSweep.js` exists but
  `AUTO_RELEASE_ENABLED=false` — held leads are **manual-only**.
- **Manual release paths (two, different contracts)**:
  - Single `assignProspect` (`prospectService.js:~1577-1650`): **hard-coded**
    fences for `no_funded_external_buyer` and `dnc_pending/dnc_registered`, then a
    **reason-blind** atomic claim, then an **unconditional best-effort
    `deductLeadCredit`** post-claim, then `lead.assigned` (never `lead.created` —
    receivers upsert on assigned; a duplicate created is a silent no-op).
  - Bulk `bulkAssignProspects` (`prospectService.js:~1761-1845`): filters held rows
    on `RELEASABLE_HOLD_REASONS` (`:124` — **bulk-only contract**), atomic
    release+assign in one locked tx, then per-campaign `deductLeadCredit` for
    every released row, then `lead.assigned` per lead.
  - `leadCredits.js` exports deduct/charge only — **no refund exists**.
- **Reward entitlements**: capture hook fires only when `!quarantined`
  (`prospectService.js:1196`); `issueForProspect` independently rejects quarantined
  rows and `reconcileMissedLeads` scans only recent **unquarantined** verified rows
  (48h window) (`entitlementService.js`). A held lead gets no signup reward until
  released; a never-released lead gets none, ever.
- **Dashboard**: `KNOWN_HOLD_REASONS` (5 reasons) → anything else buckets to
  `other` (`dashboardService.js:147`).
- **Retell API client**: private `retellApiBreaker`, **no request timeout**
  (`retellService.js:20`, `utils/circuitBreaker.js`); recording path collapses all
  non-breaker failures to 404 (`retellService.js:507`); recording route is
  authenticated but **unscoped** (`routes/retell.js:12`, `findByPk` at `:485`).
- Prospect **list** endpoints return all model columns (no attribute exclusion,
  `prospectService.js:~2089`).
- **Three creation paths**: `prospectService.createProspect` (web/QR — includes
  campaigns whose *traffic* comes from Meta/TikTok ads), `retellService` (inbound
  calls), `metaLeadService.processMetaLead` (**Meta Lead Ads native forms only** —
  quota gate, no DNC gate, immediate dispatch).
- DNC enforcement supports `block` **and `flag`** (`dncService.js:88`): flag mode
  never holds — it checks post-commit and records only.

### §1.2 Retell side (live workspace, via MCP)
- Numbers: `+6531295909` and `+6562773210` ("Singtel DDI", imported ~2026-07-17).
  No `outbound_agent_id` bound; **outbound never exercised** → Phase-0 gate.
- Prod inbound agent `agent_58b8bbdfb8920ce49bb2750b86` (webhook →
  `https://mktr-backend-jo6r.onrender.com/api/retell/webhook`). Template
  "Patient Screening" agent demonstrates `post_call_analysis_data` custom schema.

---

## §2 Design overview

### §2.1 Flow

```
Web/QR capture ── OTP verified-stamp REQUIRED for screening ──┐
  │  gates.screeningCall && RETELL_SCREENING_ENABLED           │ unverified POST:
  ▼                                                            └▶ normal capture,
[quota gate] ─ no funded agent ─▶ held no_funded_agent (unchanged)   NEVER screened/dialed
  │ funded/soft
  ▼
[DNC] block-mode → dnc_pending first; flag-mode → check resolves BEFORE dial (§6)
  │ voice-deliverable (clear / voice-clear / documented consent)
  ▼
HELD screening_pending ◀──────────────────────────────┐
  │ dial guards (§7.1) all pass                        │ retry (sweep, backoff, window)
  ▼                                                    │
create-phone-call (attempt token in metadata) ─▶ consumer
  │ webhook call_ended / call_analyzed (current attempt only, §8.4)
  ├─ qualified      ─▶ verdict pinned ─▶ releaseScreenedLead ─▶ lead.created ─▶ agent
  │                     └─ release fails → stays pending+qualified → sweep retries delivery (§9.4)
  ├─ not qualified  ─▶ screening_failed (terminal) + credit refund (§9.3)
  └─ no answer/busy/voicemail/dispatch-fail ─▶ attempts < MAX ? retry ─┘
                                    : policy → release unscreened | screening_unreachable (+refund)
```

### §2.2 State & fencing model

State lives in **discrete columns** (§4); `screeningMetadata` JSONB is evidence
only. Every transition is a single-statement conditional UPDATE fencing on
discrete columns (`WHERE quarantineReason=… AND screeningActiveCallId …`);
evidence appends ride the same statement (`jsonb_set`/`||`) so there is **no
read-copy-write anywhere** (Codex #7). Losers of a fence no-op; late call events
whose attempt is no longer current are recorded as evidence only (Codex #4).

| From | Event | To |
|---|---|---|
| capture / dnc-clear handoff | gate applies | `screening_pending` |
| `screening_pending` (current attempt) | verdict qualified | verdict pinned → release; on release failure stays `screening_pending`+`screeningVerdict='qualified'` (delivery-retry, §9.4) |
| `screening_pending` (current attempt) | verdict not qualified | `screening_failed` + refund |
| `screening_pending` | attempt unanswered/failed, attempts < MAX | `screening_pending`, `screeningNextAttemptAt` set |
| `screening_pending` | attempts ≥ MAX or TTL | qualified? → release-retry; else policy: released-unscreened \| `screening_unreachable` + refund |
| any screening reason | admin manual assign | released via existing claim (`lead.assigned`); deduct-skip rules §9.5 |

---

## §3 Config surface

### §3.1 Env (add to `env.example`; `envValidation.js` gains a **feature-conditional
block**: if `RETELL_SCREENING_ENABLED=true`, warn-fail on missing
`RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET`, agent id, from number — Codex #13)

| Var | Default | Purpose |
|---|---|---|
| `RETELL_SCREENING_ENABLED` | `false` | Master kill switch. Off ⇒ gate never applies; sweep drains pending (§10.5). |
| `RETELL_SCREENING_AGENT_ID` | — | Clamped `^agent_[a-z0-9]{10,64}$`. |
| `RETELL_SCREENING_FROM_NUMBER` | — | E.164, one of the two imported numbers. |
| `SCREENING_MAX_ATTEMPTS` | `3` | Dial attempts before unreachable policy. |
| `SCREENING_RETRY_MINUTES` | `120` | Backoff base ×2^(attempt−1), clamped into window. |
| `SCREENING_CALL_WINDOW` | `10:00-20:00` | SGT dial window. |
| `SCREENING_MAX_CONCURRENT` | `3` | In-flight cap. |
| `SCREENING_MAX_DIALS_PER_DAY` | `50` | **Global daily dial budget** (spend ceiling — concurrency alone is not one; mirrors the DNC hourly-budget pattern). Sweep defers once exhausted. |
| `SCREENING_STALE_CALL_MINUTES` | `30` | In-flight with no webhook ⇒ poll/resolve. |
| `SCREENING_MAX_HOLD_HOURS` | `24` | Hard TTL — no lead strands (§10.4). |
| `SCREENING_ON_UNREACHABLE` | `release` | `release` unscreened \| `hold`. |
| `SCREENING_SWEEP_INTERVAL_MINUTES` | `5` | Sweep tick (min 2). |
| `SCREENING_DRY_RUN` | `false` | Log would-be dials; never call Retell. |

### §3.2 Per-campaign gate — design_config v2 (backend twin FIRST, lockstep test)
- v2 `form.gates.screeningCall` (boolean, default false); legacy key
  `screeningCallAtSubmit`. Touch points: backend `utils/designConfigV2.js`
  legacy-key list `:139`, upgrade `:445-448`, downgrade `:540-543`; frontend
  mirror `src/lib/designConfigV2.js` `:423-427`, `:518-521`,
  `V1_CONSUMED_KEYS :112`.
- **Fail-safe default OFF** (opposite of DNC's fail-enabled read): unreadable
  config must never auto-dial or spend. Unreadable ⇒ deliver unscreened.
- Not added to the public design-config allowlist — the funnel client needs no
  screening knowledge in v1 (optional "expect a call" copy is a later content
  field, not this slice).

### §3.3 Security clamps
Agent id regex-clamped before any API body (§3.1); phones E.164-revalidated at
dial time; webhook metadata is trusted only because the body is HMAC-verified,
and even then is used as a **lookup key, never a write-through** (§8.3).

---

## §4 Data model — migration `082-prospect-screening.js`

Additive, nullable, zero-backfill — **discrete fence columns + evidence JSONB**
(the actual DNC shape, migration 041; Codex #7/#9):

```js
// prospects — all NULL for never-screened rows
screeningActiveCallId:  STRING(80)   // in-flight fence: 'pend_<token>' → '<call_id>'
screeningAttemptCount:  SMALLINT     // default 0
screeningNextAttemptAt: DATE         // sweep retry schedule
screeningVerdict:       STRING(16)   // 'qualified' | 'not_qualified' | null
screeningMetadata:      JSONB        // evidence: { intendedAgentId, alreadyCharged,
                                     //   chargeRefunded, attempts: [{token, callId,
                                     //   startedAt, endedAt, disconnectionReason,
                                     //   outcome, recordingUrl}], verdictDetail:
                                     //   {reason, sentiment, summary, callId, decidedAt} }
```

- **`retellCallId` is NOT reused** and `sourceMetadata.retellCallId` is **never
  written** for screened web leads — both are origin discriminators (§1.1) whose
  reuse would suppress CAPI and mislabel notes as transcripts. Screening call ids
  live only in the columns above. (The model-index-mirror and `findOne` syntax
  nits from Codex #18 die with this reuse.)
- Recording playback for screened leads reads
  `screeningMetadata.attempts[].recordingUrl` directly in the admin drawer — the
  `GET /api/retell/recording/:prospectId` endpoint is **not** extended (and its
  existing unscoped-`findByPk` weakness is flagged for a separate hardening pass,
  not widened here — Codex #16).
- **List-projection exclusion**: prospect **list** queries exclude
  `screeningMetadata` (`attributes: { exclude: [...] }` at the two
  `findAndCountAll` sites) — transcripts/summaries are detail-only (Codex #16).
- Model: add the five fields to `Prospect.js` with comments. No new indexes
  (reason-filtered sets are tiny; revisit if held volume grows).

---

## §5 Capture-path gate — `prospectService.createProspect`

1. **Pre-tx** (beside DNC mode resolution, `:569-579`):
   `screeningConfigured = envMasterOn && agentId && fromNumber && apiKey` and
   `screeningApplies = screeningConfigured && gates.screeningCall === true &&
   incoming.phone && otpMarkerLive && leadSource !== 'call_bot'`.
   **`otpMarkerLive` is required** (Codex #1): the public endpoint accepts raw
   unverified POSTs; only OTP-proven phones may ever be dialed. (The stamp also
   binds the number — `phoneVerifiedFor` — so later phone edits self-invalidate,
   Codex #11.)
2. **In-tx** (after the DNC hold block, `:856-861`): identical shape to R1 —
   quarantine `screening_pending`, stash `intendedAgentId`/`alreadyCharged`,
   never overriding quota/external/dnc holds. Init discrete columns
   (`screeningAttemptCount: 0`). Activity: `'Held — pending AI screening call'`.
3. **Post-commit ordering** (Codex #9): the dial trigger runs **after** the CAPI
   dispatch block (after `:1139`), not beside the DNC gate — capture-time
   Lead/CompleteRegistration events must see the prospect exactly as today.
   Trigger is fire-and-forget `startScreeningAttempt(prospect)`; any failure
   leaves the row for the sweep.
4. **Reward-entitlement interaction** (Codex #15 — decision **D8**): the capture
   hook currently fires only when `!quarantined` (`:1196`), and the entitlement
   service + reconciliation independently reject quarantined rows. Recommended
   (pending D8): treat `screening_pending`/`screening_failed`/`screening_unreachable`
   as **reward-eligible** — the consumer earned the signup reward by verified
   signup; screening gates *agent delivery*, not consumer rewards. Concretely:
   reason-aware exceptions at the hook call-site guard, in `issueForProspect`'s
   quarantine rejection, and in `reconcileMissedLeads`' filter. If D8 lands the
   other way (reward only when qualified), instead trigger issuance from
   `releaseScreenedLead` and accept that failed leads get nothing — but that must
   be an explicit product choice, not a silent side effect.
5. Out of scope: inbound `retellService` path, `metaLeadService` (**Meta Lead Ads
   native forms** — fast-follow D3), external-buyer leads. Campaigns whose *ad
   traffic* is Meta/TikTok but whose capture is the web funnel **are covered** —
   that distinction was ambiguous in R1 (Codex #14).

---

## §6 DNC ordering — block AND flag modes (Codex #6)

- **Block mode**: unchanged R1 design — born `dnc_pending`, and
  `gateHeldDncLead`'s deliver branch hands off to
  `transitionDncToScreening(prospect, {intendedAgentId, alreadyCharged})`
  (fenced `dnc_pending → screening_pending`, keeps `quarantinedAt`, injected via
  `screeningGate.js` to avoid an import cycle) instead of releasing, when the
  screening gate applies. `dnc_registered` stays held, never dialed. DNC backfill
  needs no change.
- **Flag mode** (`DNC_ENFORCEMENT=flag`): there is no DNC hold — the check runs
  post-commit and records only. The R1 text wrongly claimed "DNC always first".
  R2 rule: when the campaign has `dncCheck` on (any mode), **the dial guard
  requires a resolved, voice-deliverable DNC result**:
  `dncStatus='clear'`, or `registered && !dncNoVoiceCall`, or registered with
  documented DNC consent (`hasValidDncConsent`). `pending`/`error`/missing ⇒ do
  not dial; the sweep re-evaluates after the DNC backfill resolves it. Since the
  capture path awaits `dncCheckAndRecord` before the dial trigger runs (§5.3
  ordering), the common case resolves inline.
- Screening-only campaigns (no `dncCheck`) dial without a DNC check — defensible
  as fulfilling the consumer's own verified contact request; consent-copy line
  for automated/AI calls goes to the pending real-counsel pass. Flagged once.

---

## §7 Dialer — new `backend/src/services/retellScreeningService.js` + `retellClient.js`

### §7.0 `retellClient.js` (Codex #12)
Small typed client used by dialer AND sweep: `createPhoneCall(body)`,
`getCall(callId)` — `AbortSignal` timeout (10s), errors preserve HTTP status
(`err.status`), wrapped in a dedicated CircuitBreaker (`retell-screening`).
Classification: `4xx (except 408/429)` = terminal-definite; `404` on getCall =
call-unknown; timeouts/`5xx`/`429`/network = **transient** (never resolves an
attempt). The existing private recording breaker is untouched.

### §7.1 Dial guards — re-evaluated before EVERY attempt (capture trigger and sweep)
1. Master env on; not `SCREENING_DRY_RUN` (log-only); config complete incl.
   `RETELL_API_KEY` (Codex #13).
2. Row re-loaded: `quarantineReason='screening_pending'`,
   `screeningActiveCallId IS NULL`, `screeningVerdict IS NULL`.
3. Campaign re-read: still active, gate still on (drift ⇒ leave for drain §10.5).
4. **Verified-stamp**: `sourceMetadata.phoneVerifiedAt` present AND
   `phoneVerifiedFor` matches current `prospect.phone` (kills spoofed-POST dials
   and stale-after-phone-edit dials — Codex #1/#11).
5. **DNC resolved** per §6 when the campaign has `dncCheck` on.
6. **Suppression/consent/erasure**: `canMarketTo({phone, consumerId,
   channel:'all', campaignId})` must not be false — a withdrawal or erasure
   between capture and retry blocks the dial (Codex #11).
7. Window; **daily budget** (`SCREENING_MAX_DIALS_PER_DAY`, counted via a
   `screening_dial` daily counter row); concurrency
   (`COUNT screeningActiveCallId IS NOT NULL` < max). Dial decisions serialize on
   pg advisory lock `screening_dial`.
8. Phone re-validated E.164.

### §7.2 Attempt lifecycle — token-first (Codex #3)
1. Mint local token `att_<uuid>`; fenced claim:
   `SET screeningActiveCallId='pend_'+token, screeningAttemptCount=screeningAttemptCount+1,
   screeningMetadata=<append attempt {token, startedAt}>`
   `WHERE quarantineReason='screening_pending' AND screeningActiveCallId IS NULL`.
2. `createPhoneCall` with
   `metadata: { mktr: { kind:'screening', prospectId, attemptToken: token, attempt: n } }`,
   `override_agent_id`, `from_number`, `to_number`,
   `retell_llm_dynamic_variables: { name, campaign_name }` (strings only;
   `reward_name` dropped — not a persisted content field, Codex #15/#18).
3. Outcomes:
   - **Accepted** → fenced swap `'pend_'+token → call_id` + bind `callId` into the
     attempt evidence.
   - **Terminal-definite failure** (validation 4xx) → clear sentinel, attempt
     `outcome:'dispatch_failed'`, `screeningNextAttemptAt = now+backoff`.
   - **Unknown** (timeout / 5xx / network — Retell may have accepted) → attempt
     `outcome:'dispatch_unknown'`, **sentinel stays**. The verified webhook binds
     by `prospectId + attemptToken` (§8.3) even though we never learned the
     call id; if no webhook arrives, the stale pass (§10.2) resolves it after
     `SCREENING_STALE_CALL_MINUTES`. **Never an immediate redial** — this closes
     the duplicate-call gap. Residual risk (call happened + webhook lost + 30 min
     silence + `getCall` impossible without an id) is documented and bounded.

---

## §8 Webhook screening branch — `retellService.js` + controller

### §8.1 Controller
`processRetellCall(callData, { event: payload.event })` — pass-through second arg.

### §8.2 Branch fence (before ALL existing guards — unchanged from R1)
`callData?.metadata?.mktr?.kind === 'screening' || callData?.direction === 'outbound'`
⇒ `handleScreeningWebhook(callData, event)`, **never** the legacy create path
(which would mint a duplicate `call_bot` prospect and whose
`call_successful===false` skip would swallow negative verdicts). Legacy inbound
path untouched for `direction ∈ {inbound, undefined}`.

### §8.3 Correlation & binding
1. Load prospect by `metadata.mktr.prospectId` (trusted: HMAC-verified body;
   used as a lookup key only).
2. **Bind**: if `screeningActiveCallId = 'pend_'+metadata.mktr.attemptToken`,
   fenced-swap it to `call.call_id` (the dispatch-unknown recovery). Then:
3. **Current-attempt check** (Codex #4): the event is *actionable* iff
   `call.call_id === screeningActiveCallId`. Anything else (superseded attempt,
   post-resolution replay, admin already released) ⇒ append evidence to
   `screeningMetadata`, log, 200 — **never a state transition**.
4. Prospect missing (deleted/erased) ⇒ log, 200, drop (Codex #11 residual: an
   in-flight call at deletion completes at Retell; its result is discarded).

### §8.4 Event application (current attempt only)
- `call_ended`, unanswered `disconnection_reason` (`dial_no_answer|dial_busy|
  dial_failed|voicemail_reached|machine_detected`) ⇒ resolve attempt: clear
  `screeningActiveCallId` (fenced on the call id), backoff-or-policy (§9).
- `call_ended`, connected ⇒ evidence only; wait for `call_analyzed`.
- `call_analyzed` ⇒ verdict from `call_analysis.custom_analysis_data.qualified`
  (boolean; schema in Phase 0). Missing after a connected call ⇒ resolve attempt
  as `outcome:'no_verdict'` (retry-or-policy) — never inferred from sentiment.
- Duplicates replay harmlessly: every transition is fenced on
  (`quarantineReason`, `screeningActiveCallId`).

---

## §9 Verdicts, refunds, releases — new `backend/src/services/screeningGate.js`

### §9.1 Qualified
One fenced UPDATE pins the outcome: `screeningVerdict='qualified'`,
`verdictDetail` evidence, clear `screeningActiveCallId` — then
`releaseScreenedLead` runs (§9.2). If release fails, the row is *pending +
qualified* and is retried by sweep job 1 (§10.1) — **TTL never reclassifies a
qualified lead as unreachable** (Codex #8).

### §9.2 `releaseScreenedLead({prospect})`
Adaptation of `releaseDncClearedLead` with fence
`quarantineReason='screening_pending' AND screeningVerdict='qualified'`:
one tx — claim → `chargeLeadCredit` unless `alreadyCharged && !chargeRefunded`
(`no_credit` ⇒ rollback, stays qualified-pending) → activity → in-tx
`persistEventDeliveries('lead.created', …)` with the **screening payload block**
(§9.6) (`no_subscriber` ⇒ rollback) → commit → flush. `intendedAgentId` null ⇒
stays qualified-pending; sweep job 1 re-resolves routing via `resolveLeadRouting`
on each retry (covers agents who joined after capture). Deliberate copy of the
DNC release, not a shared refactor — flagged for reviewer preference.

### §9.3 Not qualified / unreachable-hold — with refund (Codex #2)
Fenced transition to `screening_failed` (or `screening_unreachable`), verdict +
summary evidence, activity — **and, when `alreadyCharged && !chargeRefunded`,
refund the credit** via new `refundLeadCredit({agentId: intendedAgentId,
campaignId})` in `leadCredits.js` (inverse of `chargeLeadCredit`, same
transaction as the state flip; sets `chargeRefunded: true` in evidence).
A funded agent must never pay for a lead they never received.
Release-unscreened policy performs a normal release (delivered ⇒ no refund).

### §9.4 Unreachable policy
`SCREENING_ON_UNREACHABLE=release` ⇒ release variant (charge rules as §9.2;
payload `screening: {qualified: null, unreachable: true}`; activity "Released
unscreened after N attempts"). `=hold` ⇒ §9.3 transition + refund.

### §9.5 Manual admin release — exact edits (Codex #10, replaces R1's wrong
"just extend `RELEASABLE_HOLD_REASONS`" claim)
- **Single `assignProspect`**: its fences are hard-coded, not list-driven. Add:
  screening reasons are allowed through (deliberate override), and in the
  release branch the **unconditional `deductLeadCredit` becomes conditional**:
  skip when `screeningMetadata.alreadyCharged === true && !chargeRefunded`
  (capture already paid); deduct normally when refunded (`screening_failed`
  override re-charges) or never charged. Activity metadata gains
  `screeningOverride: true` when applicable.
- **Bulk `bulkAssignProspects`**: add the three reasons to
  `RELEASABLE_HOLD_REASONS` (its actual contract) **and** subtract
  already-charged-unrefunded rows from each per-campaign `deductLeadCredit`
  count (the row set is already in the locked snapshot).
- **Both paths emit `lead.assigned`** (upsert semantics at receivers — correct
  for re-surfacing) ⇒ `buildLeadAssignedPayload` gets the screening block too
  (§9.6). The paths' pre-existing post-claim (non-outbox) delivery crash window
  is unchanged existing behavior — out of scope, noted.
- Frontend parity: `src/constants/holdReasons.js` `RELEASABLE_HOLD_REASONS`/`isReleasableHold`
  must match, or bulk UI will mispredict skips.

### §9.6 Payload & notes
`screeningPayloadBlock(prospect)` (null when never screened):
`{ qualified, unreachable?, summary, sentiment, recordingUrl, decidedAt }` —
added to **both** `buildLeadCreatedPayload` and `buildLeadAssignedPayload`
(`prospectHelpers.js:79,137`). Notes append `--- AI Screening ---` summary before
release so it lands in Lyfe with zero EF changes. The existing
`sourceMetadata.retellCallId`-based transcript heuristic in those builders is
left alone (screened web leads never set it).

---

## §10 Sweep — new `backend/src/services/screeningSweepService.js` (re-ordered, Codex #5)

`dncBackfillService` shape: in-process `running` guard + pg advisory xact lock
(`screening_sweep`), `MAX_PER_RUN 100`, scheduled in `bootstrap.js` behind the
feature (2-min delay, `SCREENING_SWEEP_INTERVAL_MINUTES`), **drain-aware** (runs
when enabled OR when any `screening_%` rows exist). Pass order — terminalize
before dialing, and rows touched in an earlier job are excluded from later jobs
in the same pass:

1. **Qualified-delivery retries** (Codex #8): `screening_pending AND
   screeningVerdict='qualified'` ⇒ `releaseScreenedLead` (re-resolve routing if
   `intendedAgentId` gone).
2. **Stale in-flight resolution**: `screeningActiveCallId IS NOT NULL AND` started
   `< now − SCREENING_STALE_CALL_MINUTES`. Bound ids (`call_…`) ⇒ `getCall`:
   ended/analyzed ⇒ apply §8.4; **only 404/definite-terminal clears the attempt**;
   transient errors leave it for the next pass (Codex #12). Unbound sentinels
   (`pend_…`) ⇒ resolve as failed attempt (no webhook ever came), clear, backoff.
3. **TTL** (Codex #5): `quarantinedAt < now − SCREENING_MAX_HOLD_HOURS AND
   screeningActiveCallId IS NULL` — qualified ⇒ job-1 release path; else
   unreachable policy (§9.4). Active-call rows wait for job 2 to resolve them
   first; they hit TTL on a later pass.
4. **Drain mode** (master off or campaign gate off): same predicate discipline —
   `screeningActiveCallId IS NULL` only; releases pending rows unscreened
   (always release when draining; verdicts already terminal stay put). In-flight
   calls resolve via job 2 first, then drain on the next pass (Codex #5's
   drain-cancels-nothing hole).
5. **Due retries LAST**: `screening_pending`, no active call, no verdict,
   `screeningNextAttemptAt <= now`, attempts < MAX, all §7.1 guards ⇒ dial.
   Skips anything jobs 1–4 touched this pass — a lead can never be dialed and
   released in the same sweep.

---

## §11 Admin, dashboard, Studio surfacing

Lockstep maps (drift checklist — now **four** places):
1. Backend single-assign fences + deduct-skip (§9.5).
2. Backend bulk `RELEASABLE_HOLD_REASONS` (`prospectService.js:124`).
3. `src/lib/adminV2/constants.js:50` `HELD_REASON_LABELS` += `screening_pending:
   'Screening call'`, `screening_failed: 'Screening: not qualified'`,
   `screening_unreachable: 'Screening: unreachable'`.
4. `src/constants/holdReasons.js` labels + `RELEASABLE_HOLD_REASONS` parity.

Plus (Codex #17): `dashboardService.js:147` `KNOWN_HOLD_REASONS` += the three
reasons so the attention rail stops bucketing them as `other`.

UI:
- **Studio toggle**: 4th `ToggleRow` in `FormPanel.jsx` after `:207`
  (`form.gates.screeningCall`, hint "AI calls the lead after signup; only
  qualified leads reach an agent").
- **Legacy fallback** (guided_review only): `ContentPanel.jsx` ~`:551` Switch on
  `screeningCallAtSubmit`.
- **AdminV2 prospect drawer**: NEW read-only screening section (verdict chip,
  reason, attempts, per-attempt `recordingUrl` links straight from
  `screeningMetadata` — no recording-endpoint dependency; Codex #18 confirmed
  AdminV2 has no recording UI today, so this is net-new budgeted work, ~40 LOC).
- Observability: structured `[Screening]` log lines at every transition with
  `prospectId, campaignId, attempt, outcome`; sweep summary line
  (`released/failed/unreachable/dialed/drained/budget_left`) — enough for
  rollout monitoring without a metrics stack (qualified-rate etc. read from
  these + held-queue counts; Codex #17's metric ask satisfied at log level).

---

## §12 Phase 0 — Retell-side setup & verification (unchanged from R1 + additions)

1. **Outbound dial test** (blocking): both numbers → Shawn's phone via MCP
   `create_phone_call`; verify SIP termination + caller-ID. Neither has ever
   dialed outbound.
2. **Screening agent** (new, not the inbound Luggage agent): `{{name}}`/
   `{{campaign_name}}` dynamic vars; AI + recording disclosure in the greeting
   (PDPA); 3–5 qualification questions (D6 — Shawn drafts);
   `post_call_analysis_data`: `{type: boolean, name: qualified}` (required),
   `{type: string, name: qualification_reason}`, optional
   `{type: enum, name: interest_level, choices:[hot,warm,cold]}`; voicemail
   detection ON (hang up); `max_call_duration_ms ≈ 300000`; `webhook_url` →
   `https://mktr-backend-jo6r.onrender.com/api/retell/webhook`.
3. Render env: agent id + from number + verify `RETELL_API_KEY` present;
   master flag stays `false` until §16.3.

---

## §13 Compliance & cost (flag once)

Unchanged from R1 (§6 handles the DNC-mode nuance): recording disclosure in
greeting; automated/AI-call line added to the real-counsel consent-copy list;
10:00–20:00 SGT window; cost ≈ US$0.30–0.50 per screened lead ≤3 attempts,
now hard-capped by `SCREENING_MAX_DIALS_PER_DAY` in addition to per-campaign
opt-in + concurrency + master switch.

---

## §14 Failure-mode matrix (R2)

| # | Failure | Behavior |
|---|---|---|
| 1 | Spoofed/unverified public POST on a screening campaign | Captured as a normal lead; **never dialed** (verified-stamp guard §7.1.4). |
| 2 | Retell API down at dial | Attempt `dispatch_failed`/transient ⇒ backoff; TTL bounds total hold (§7.2, §10.3). |
| 3 | Dial accepted but response lost (timeout/crash) | Sentinel persists as `dispatch_unknown`; webhook binds by attempt token; stale pass resolves; **no immediate redial** (§7.2.3, §8.3.2). |
| 4 | Webhook never arrives | Stale pass polls bound call ids; unbound sentinels resolve as failed after the stale window (§10.2). |
| 5 | Duplicate/replayed webhook events | Fenced on (`reason`, `activeCallId`) ⇒ no-op; evidence-only append (§8.4). |
| 6 | Late event from a superseded attempt | Not the current `activeCallId` ⇒ evidence only, never a transition (§8.3.3). |
| 7 | Admin releases mid-flight | Claim clears reason; all later screening transitions lose fences; deduct-skip prevents double-charge (§9.5). |
| 8 | Qualified but release fails (`no_credit`/`no_subscriber`/agent gone) | Stays pending+qualified; sweep job 1 retries; TTL routes qualified to release, never unreachable (§9.1, §10.1/3). |
| 9 | Verdict negative on a capture-charged lead | `screening_failed` + **credit refunded** in the same tx (§9.3). |
| 10 | Kill switch / campaign gate off with leads pending | Drain releases unscreened after in-flight calls resolve; terminal verdicts stay (§10.4-5). |
| 11 | Sweep dials and terminalizes same lead in one pass | Impossible: terminalize-before-dial ordering + touched-row exclusion (§10). |
| 12 | DNC flag-mode voice-registered number | Dial guard requires resolved voice-deliverable DNC result in any mode (§6). |
| 13 | Phone edited after capture | `phoneVerifiedFor` mismatch ⇒ no further dials (§7.1.4). |
| 14 | Consent withdrawn / erasure between attempts | `canMarketTo` guard blocks the next dial (§7.1.6). |
| 15 | Prospect deleted with call in flight | Webhook finds no row ⇒ log+200 drop; nothing recreated (§8.3.4). |
| 16 | Our outbound call loops into legacy create path | Impossible: direction/metadata fence above all legacy guards (§8.2). |
| 17 | Concurrency stampede / runaway spend | Concurrency cap + **daily dial budget** + advisory-locked dial decisions (§7.1.7). |
| 18 | Carrier spam-flagging | Surfaces as repeated `dial_failed` ⇒ unreachable policy; watch in soak (§16). |

---

## §15 Test plan

Backend (jest; sandbox off + inline `JWT_SECRET`; ECONNREFUSED without local PG
expected):
- `screeningGate.test.js` — transition matrix incl. every §14 fence race;
  release fail-closed paths; **refund invariants** (charged→failed refunds once;
  refund→manual-override re-charges; never double-refund); qualified-pending
  delivery retry; TTL-qualified routing; DNC handoff + `flag × screening` matrix
  (Codex #6); drain with in-flight calls.
- `retellScreening.test.js` — §7.1 guard table (verified-stamp, canMarketTo,
  DNC-resolved, budget, window, config); token lifecycle incl. `dispatch_unknown`
  + webhook token-binding + stale resolution; client error classification
  (404 vs transient); webhook branch: outbound-never-creates, current-attempt
  gating, orphan/missing-prospect 200s.
- `prospectServiceScreening.test.js` — capture decision table
  (screening × dnc-mode × quota × external × unverified × call_bot × master-env);
  CAPI untouched (shouldFireCapi true for screened web leads; dispatch ordering);
  entitlement-hook behavior per D8; **manual paths**: single-assign deduct-skip,
  bulk count adjustment, `lead.assigned` screening block.
- Twins lockstep + clamp for `gates.screeningCall`; dashboard reason-set test if
  one exists.
- E2E (§16.3): qualified / not-qualified / no-answer×3 / voicemail / kill-switch
  drain, against Shawn's phone.

---

## §16 Rollout

1. **Merge dark** (migration + code, master flag absent ⇒ off; regression suites
   prove untouched paths).
2. **Phase 0** (§12) in parallel.
3. **Soak on a dedicated test campaign** (Shawn's number): the five E2E runs +
   log/queue inspection.
4. **Enable on one real web-funnel campaign** — explicitly a web-capture campaign
   (Meta-ad-fed is fine; **Meta Lead Ads native-form campaigns are NOT covered**
   until D3 — Codex #14 wording fix).
5. Watch `[Screening]` sweep summaries + held-queue reason counts + Retell spend;
   tune script/window/attempts/budget.

Rollback: master off ⇒ drain (§10.5); verdict holds remain for triage; migration
stays (additive).

---

## §17 Open decisions

- **D1 Unreachable default** — **`release` unscreened** (no-answer ≠ bad lead). |
- **D2 Verdict source** — **custom `qualified` boolean**; never sentiment.
- **D3 Meta Lead Ads native forms** — **fast-follow** after soak (needs its own
  born-held block; that path has no DNC gate either).
- **D4 From-number** — **Singtel DDI `+6562773210`** pending Phase-0 test.
- **D5 Per-campaign agent override** — not now; env-global agent.
- **D6 Screening script/persona** — Shawn drafts (blocks Phase-0 step 2 only).
- **D7 Assignment email on screened release** — skip (DNC-release parity).
- **D8 Signup rewards for screening-held/failed leads** — **recommend
  reward-eligible** (reward earned by verified signup; screening gates agent
  delivery only). Codex #15 showed the current guards silently withhold rewards
  from every quarantined lead — whichever way this lands, it must be explicit.
- **D9 Daily dial budget default** — 50/day proposed; adjust to campaign volume.

## §18 Non-goals

R1 list unchanged, plus: no hardening of the pre-existing recording-endpoint
scoping or manual-release outbox gaps beyond not widening them (flagged for a
separate pass); no metrics-stack work (structured logs suffice for rollout); no
re-screen button.

## §19 File-touch summary

| File | Change | Est. |
|---|---|---|
| `backend/src/database/migrations/082-prospect-screening.js` | NEW — 4 discrete cols + JSONB | ~40 |
| `backend/src/models/Prospect.js` | +5 fields | ~20 |
| `backend/src/services/retellClient.js` | NEW — typed client, timeouts, breaker | ~80 |
| `backend/src/services/retellScreeningService.js` | NEW — guards + token dial + outcome application | ~260 |
| `backend/src/services/screeningGate.js` | NEW — transitions, release, refund, policies, DNC handoff | ~240 |
| `backend/src/services/screeningSweepService.js` | NEW — 5-job ordered sweep | ~150 |
| `backend/src/services/leadCredits.js` | +`refundLeadCredit` | ~30 |
| `backend/src/services/retellService.js` | branch fence + wiring | ~40 |
| `backend/src/controllers/retellController.js` | pass `event` | ~3 |
| `backend/src/services/prospectService.js` | capture gate; trigger after CAPI; single-assign screening fences + deduct-skip; bulk reasons + count adjust; list-projection excludes; entitlement-hook exception (D8) | ~90 |
| `backend/src/services/dncGate.js` | deliver-branch handoff | ~15 |
| `backend/src/services/prospectHelpers.js` | screening block in created + assigned payloads | ~30 |
| `backend/src/services/redeemOps/entitlementService.js` | reason-aware quarantine exceptions (D8) | ~20 |
| `backend/src/services/dashboardService.js` | `KNOWN_HOLD_REASONS` += 3 | ~3 |
| `backend/src/utils/designConfigV2.js` + `src/lib/designConfigV2.js` | `gates.screeningCall` twins | ~12 |
| `backend/src/database/bootstrap.js` | schedule sweep (drain-aware) | ~15 |
| `backend/src/config/envValidation.js` + `env.example` | vars + feature-conditional checks | ~25 |
| `src/components/studio/panels/FormPanel.jsx` | toggle | ~10 |
| `src/components/campaigns/editor/ContentPanel.jsx` | legacy switch | ~12 |
| `src/lib/adminV2/constants.js` + `src/constants/holdReasons.js` | labels + releasable parity | ~14 |
| `src/pages/adminv2/AdminV2Prospects.jsx` | drawer screening section + recordings | ~45 |
| tests (3 new suites + extensions) | §15 | ~900 |

≈ 1,150 LOC product + ~900 test. Sequencing: migration/model → retellClient →
screeningGate (+refund) → dialer → webhook branch → capture gate + dncGate +
manual-path edits → sweep → config twins + dashboard → frontend → tests
throughout.
