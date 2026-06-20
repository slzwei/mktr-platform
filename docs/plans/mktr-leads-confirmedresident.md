# Plan v2 — mktr-leads SC/PR confirmation → Meta ConfirmedResident (full fix)

> Revised after Codex review #1 (changelog at bottom). Two-repo change.
> Motivating blocker (found independently by Codex + Claude): the external (mktr-leads) outcome path mirrors status but **does not fire CAPI**, so the SC/PR card alone would send nothing to Meta.

## Goal
When an **mktr-leads agent confirms a lead is SG Citizen/PR on the first call**, fire **ConfirmedResident** to Meta (and **ClosedWon** on `won`), same as the Lyfe path, early enough to land in the 7-day click window.

## The gap (why Part 2 is needed)
- Lyfe path: status change → `leadOutcomeService.js` → **fires ConfirmedResident/ClosedWon** (deterministic `event_id`, mark-on-success dedup, back-dated, per-campaign pixel).
- External (mktr-leads) path: status change → `report-lead-outcome` EF → `POST /api/external/lead-outcomes` → `externalLeadOutcomeService.js`, which **only mirrors `Prospect.leadStatus` + writes an activity** and is explicitly *"separate … does NOT fire CAPI"* (`externalLeadOutcomeService.js:13-15`). That note predates the **2026-06-10 pivot** (mktr-leads = a second agent team, not external buyers); post-pivot those leads come from the same Meta campaigns and should feed Meta.

---

## Part 1 — mktr-leads UI (ships via Expo OTA)
File: `app/(tabs)/leads/[leadId].tsx` (+ styles). UI only; reuses the existing status→outcome pipeline.
- **"Singapore Citizen / PR?"** card right after the Call/WhatsApp CTAs.
- **Yes — SC/PR** → `changeStatus('qualified')` (existing path; fires ConfirmedResident once Part 2 ships).
- **No** → `addLeadActivity(leadId, userId, 'note', 'Marked not Singapore Citizen / PR', { sc_pr: false })` + confirm Alert + `load()`. No status change, no Meta event.
- **Visibility:** show only when `!readOnly && !lead.deleted_at && !lead.archived_at && (lead.status === 'new' || lead.status === 'contacted')`.
- **"No" visible state:** if a `note` activity with `metadata.sc_pr === false` exists and status is still new/contacted, collapse to "Marked not SC/PR · Change" (Change re-opens the prompt).
- Verified: `'note'` ∈ `ActivityType` (`lib/leads.ts:115`); `lead_activities.metadata` is `jsonb` (`20260601000001_init_schema.sql:118`); `lead_activities_insert_own` RLS + grant exist; theme tokens exist (`constants/theme.ts`).

## Part 2 — mktr-platform backend: external path fires CAPI (ships via Render deploy)
Files: `backend/src/services/leadOutcomeService.js` (enrich return), `backend/src/services/externalLeadOutcomeService.js` (fire CAPI), + Jest tests. **Reuse `leadOutcomeService`, don't duplicate.**

### 2a. Enrich `processLeadOutcome` return — additive, Lyfe-safe
Today it returns `{ dispatched, duplicate, failed }` and **collapses guarded / 4xx / 5xx / network into `failed`** (`leadOutcomeService.js:156`) — so a caller can't tell "CAPI disabled" from "retryable failure". `dispatchWithRetry` already classifies internally (`reason === 'guarded'`; transient = `error != null || status >= 500`). Surface it:
```
{ dispatched:[...], duplicate:[...], guarded:[...], transientFailed:[...], permanentFailed:[...],
  failed:[...] /* = transient+permanent, kept for back-compat */ }
```
Firing behavior unchanged → the Lyfe caller (`lyfeLeadOutcomeController`, which ignores the return beyond logging) is unaffected.

### 2b. External service fires CAPI on EVERY outcome path (marker-gated)
`processExternalLeadOutcome` must attempt CAPI on all three branches, not just fresh:
1. **Fresh event:** after the status-mirror txn commits, call CAPI (post-commit).
2. **Idempotency replay** (`externalLeadOutcomeService.js:101`): currently returns before loading the prospect — must still load + attempt CAPI.
3. **Unique-constraint conflict** (`externalLeadOutcomeService.js:193`): currently returns 200 — must still attempt CAPI.

CAPI call (post-commit / no open txn; `processLeadOutcome` re-`findByPk`s + self-saves the marker, never throws):
```js
const capi = isCapiEligible(mapped)   // mapped === 'qualified' || 'won'
  ? await leadOutcomeService.processLeadOutcome({
      external_id: prospect.id,
      new_status: mapped,
      occurred_at: payload.timestamp,   // dispatch time — see 2c
    })
  : null;
```
Marker (`sourceMetadata.capi.{confirmedResidentAt|closedWonAt}`) + Meta `event_id` dedup ⇒ safe to call on every replay/sweep with no double-count.

### 2c. Response classification (drives the mktr-leads sweep, fixes blocker ①)
The mktr-leads sweep re-fires outcomes whose `status_changed_at > outcome_reported_at`; the EF stamps `outcome_reported_at` only on a `resp.ok` (2xx). So:
- **2xx** when: status mirror ok AND CAPI result is `sent` / `duplicate` (already-marked) / `guarded` (CAPI off) / `permanentFailed` (4xx — retrying won't help; log for investigation, leave marker unset) / not CAPI-eligible.
- **non-2xx** (e.g. 503) ONLY when `capi.transientFailed` is non-empty (5xx/network) → EF doesn't stamp → sweep re-fires (re-signs fresh timestamp) → retried, bounded by the sweep's 48-attempt cap.

This never retry-storms on guarded/permanent, and gives at-least-once on transient via the existing sweep.

### 2c-note. event_time = dispatch time (blocker ② → accepted for v1)
`payload.timestamp` is the EF's dispatch time, not the DB `status_changed_at`. In the happy path the trigger dispatches within seconds of the agent tapping Yes, so it ≈ confirmation time and always lands in Meta's 7-day window (the goal). **Precise fix (send `status_changed_at` from the mktr-leads `_shared/outcome.ts` EF and use it for `event_time`) is a follow-up — it requires redeploying the mktr-leads edge function (separate Supabase project, user-deployed).** Not blocking the goal.

### 2d. Eligibility (intended behavior, not a bug)
`shouldFireCapi` (`metaCapiService.js:23`) returns true for normal web/QR mktr-leads prospects, and intentionally **skips** `call_bot`/`retellCallId` (Retell) and `sourceMetadata.metaLeadgenId` (native Meta Lead Ads). Those origins shouldn't emit a web-CAPI ConfirmedResident. Documented, no change.

### Config (no new secrets)
Reuses `META_CAPI_ENABLED`, `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID` (+ per-campaign `Campaign.metaPixelId`), `META_EVENT_QUALIFIED`/`META_EVENT_WON`. Match keys come from the prospect's `sourceMetadata` inside `metaCapiService`.

## Testing
- **Backend Jest** (DI factories `makeExternalLeadOutcomeService` + `makeLeadOutcomeService` with a stub `sendConversionEvent`):
  - `qualified → ConfirmedResident`; `won → ConfirmedResident + ClosedWon`; `proposed/lost/invalid/disputed → no CAPI`.
  - classification: `guarded → 2xx` (no sweep); `transientFailed → non-2xx` (sweep retries); `permanentFailed(4xx) → 2xx` + logged, marker unset; `sent/duplicate → 2xx`.
  - replay branch + unique-conflict branch BOTH attempt CAPI; already-marked ⇒ `duplicate`, no resend.
  - status-mirror idempotency unchanged (no duplicate activities).
  - `leadOutcomeService` enriched-return unit test; confirm Lyfe path behavior unchanged.
- **mktr-leads:** `npm run lint` + `npx tsc --noEmit`; existing `lib/__tests__` green; manual matrix (new/contacted → card; Yes → Qualified + ConfirmedResident in logs; No → note only; readOnly/deleted/archived → no card).

## Rollout (order) + rollback
1. **Backend first** (mktr-platform → main → Render). Then *every* mktr-leads `qualified`/`won` transition fires CAPI (card is just a faster UI).
2. **Then mktr-leads OTA** (EAS Update, production channel).
- Rollback: revert backend commit + redeploy (CAPI stops; mirror unaffected); roll back / re-publish OTA. Independently reversible.

## Risks / watch
- Response-classification correctness (2c) — the core reliability logic.
- Double-fire → marker + Meta `event_id` dedup (same as Lyfe).
- Permanent (4xx) CAPI errors are dropped (2xx, unmarked) pending a future reconciliation backfill — acceptable, matches Lyfe's current posture.
- event_time precision (2c-note) — dispatch-time for v1.

## Changelog — after Codex review #1
- **Blocker ① (can't classify guarded vs transient):** fixed by enriching `processLeadOutcome`'s return (2a) and classifying the HTTP response (2c). Guarded/permanent → 2xx (no storm); transient → non-2xx (sweep retries).
- **Blocker ② (occurred_at ≠ status-change time):** accepted for v1 (dispatch-time ≈ confirmation time, in-window); precise `status_changed_at` fix deferred (needs mktr-leads EF redeploy) (2c-note).
- **Should-fix ③ (replay coverage):** CAPI now fired on fresh + idempotency-replay + unique-conflict branches (2b).
- **Should-fix ④ (skips Retell/Meta-Lead-Ads):** confirmed intended; documented (2d).
- **Nice-to-have ⑤ (same-status flap within 24h TTL):** pre-existing external-service behavior; out of scope.

## Changelog — after Codex review #2 (resolutions baked into the build)
- **Blocker (marker race):** accepted as benign — Meta `event_id` dedup is the real concurrency guard (double-send deduped, no double-count); a clobbered marker self-heals via the next sweep; the per-status idempotency key + sweep 10-min grace make true concurrency unlikely. Shared Lyfe service persistence left unchanged (re-architecting it is disproportionate risk). Plan wording corrected: `event_id` is the guard, marker is best-effort.
- **Should-fix (additive return):** `failed` stays = all-not-sent (incl. guarded) so the existing test + Lyfe behavior are unchanged; `guarded`/`transientFailed`/`permanentFailed` added ALONGSIDE. External path classifies on the new fields.
- **Should-fix (sweep retries current status):** documented v1 limitation — if `qualified` CAPI transient-fails and the lead moves to `lost` before retry, the signal is lost (pre-existing status-based-pipeline property). Robust fix = event-stable outcomes, bundled with the mktr-leads-EF follow-up.
- **Nit (unguarded throws):** the external service wraps the `processLeadOutcome` call in try/catch → a throw is treated as transient (non-2xx → sweep retries).

## For Codex (review #2 — in depth)
1. Is the enriched-return classification (2a) faithful to what `dispatchWithRetry`/`sendConversionEvent` actually return (guarded vs 4xx vs 5xx vs network)? Any result shape that would be misclassified?
2. Is the 2c response mapping correct and storm-proof in all cases (esp. guarded-when-CAPI-off, and permanent 4xx)? Does returning non-2xx interact correctly with the controller's HMAC/freshness + the EF's `outcome_reported_at` stamping + the 48-attempt sweep cap?
3. Are the replay + unique-conflict branches (2b) safe to fire CAPI from (no open txn, fresh prospect, no double activity)? Any branch still missed?
4. Any correctness issue with calling a shared `processLeadOutcome` from two controllers concurrently (same prospect marker writes)?
5. Lyfe regression: is enriching the return truly additive (does `lyfeLeadOutcomeController` rely on the exact shape)?
6. Anything else that breaks build/prod, or a materially cleaner approach.
