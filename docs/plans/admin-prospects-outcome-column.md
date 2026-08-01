# Prospects list: STATUS becomes the campaign-outcome column

**Status:** scoped 2026-07-26, not yet reviewed/built
**Surface:** `/AdminProspects` (`src/pages/adminv2/AdminV2Prospects.jsx`)
**Problem:** the STATUS column shows the generic CRM pipeline state — a wall of "New"
on ~every row — plus an "AI qualified" chip that only means anything on draw
campaigns. With campaigns of different types launching weekly, a campaign-blind
status column carries no information. (Screenshot evidence 2026-07-26: 13 rows,
12 identical "New" chips.)

## The rule

The STATUS cell shows **the lead's outcome in its own campaign's voice**, with one
strict precedence (one primary chip; secondaries only when they add information):

1. **`◆ held`** — unchanged, still overrides everything (the one operational alarm).
2. **Outcome chip** (the same compact voices as the Lead Profile campaigns rail):
   - Draw lead: `open · closes 30 Sep` → `×10` when boosted (show the multiplier, not
     just "open") / `not counted` (warn) / `in the pool` / `sealed` / `selected`
     (accent) / `🏆 winner` (ok) / `not selected` / `void` / `⊘ erased`.
   - Reward lead: `reserved` (accent) / `unlocked` (ok) / `✓ redeemed` (ok) /
     `expired` / `blocked` (bad).
3. **Pipeline status ONLY when it isn't `new`** — `qualified` / `won` / `lost` etc.
   are real signals (the Lyfe app writes them via ConfirmedResident/ClosedWon); the
   default resting value is silence.
4. **Screening chip** only when a verdict exists (draw leads) — same
   suppressed-when-held rule as today.
5. Nothing applies (non-draw, no entitlement, status `new`) → one muted `—` in
   `--ink-3`. No "New" wall.

Bonus while in the file: the CAMPAIGN column gains a 16px type glyph before the name
(`◆` hold-tinted = draw, muted = reward) so campaign type reads at a glance.

Amendment to the profile's chip while sharing the code: the draw `provisional_in`
chip should carry the boost when present (`×10 · closes 30 Sep`) — today it says
only `open · closes 30 Sep` even for boosted leads; the list makes that gap obvious.

## Backend — `?include=outcome` on the list endpoint

`GET /api/prospects` gains an **admin-only, opt-in** enrichment, exactly the PR #269
contract discipline: without the param — or for any non-admin, whatever they send —
the payload is **byte-identical** (the endpoint also serves agent MyProspects and the
⌘K palette, which must not pay for this).

Per page (25 rows), after the page query:

- **`rows[].draw`** — `getProspectDrawStatus(rows)`, the batch built for the profile:
  bounded per DISTINCT draw, not per row (a page spans 1–4 campaigns → ~6–9 extra
  queries total, incl. the consistency re-read). Trim `drawHistory` from the list
  projection. Requires the list query (admin+include only) to also select
  `consentMetadata` (the open-draw eligibility preview reads the pinned draw terms;
  the list already selects `sourceMetadata`, and `screeningMetadata` stays detail-only).
- **`rows[].reward`** — one batched `RewardEntitlement.findAll` by the page's
  prospect ids (+ `rewardOffer` title include), one `drawRailActivationIds` lookup to
  exclude draw-linked passes, projected to the **newest non-draw-linked** entitlement's
  `{ state (shared presentState), rewardTitle }`. (A prospect belongs to one campaign,
  so no campaign matching is needed per row.)
- Build check: confirm `reward_entitlements.prospectId` has an index (it's a
  frequent-batch key now); add one in this PR if missing.
- Contract tests: no include → byte-identical for admin AND agent; agent + include →
  ignored; admin + include → both fields present, consumer-less/Retell rows return
  `draw: null, reward: null` without erroring.

## Frontend

- **Shared voice module** — extract `rowChipFor` + `REWARD_STATE_COPY` from
  `AdminV2LeadProfile.jsx` into `src/lib/adminV2/outcome.js`; profile and list both
  import it (one place where outcome copy lives; apply the `×N` amendment there).
- **`AdminV2Prospects.jsx`**: `useProspects` passes `include: 'outcome'`; STATUS cell
  re-implements the precedence above; drop the `SortHeader` on the status column
  (outcome isn't a DB column, and sorting by `new/contacted` was never useful) — the
  Status FILTER dropdown stays (it filters `leadStatus`, which the pipeline-exception
  chip still surfaces). Campaign cell gains the type glyph.
- **CSV export**: `prospectsToCsv` gains an `outcome` column (chip label text) — the
  rows already carry the data client-side.
- RTL tests: voucher row shows `✓ redeemed` and NOT "New"; boosted draw row shows
  `×10 · closes …`; unboosted draw shows `open · closes …`; `qualified` pipeline
  status DOES show; held overrides outcome; screening chip only on draw rows; the
  muted `—` fallback; CSV includes outcome. Existing navigation tests keep passing
  (new fields optional in fixtures).

## Out of scope (named)

- Server-side filtering/sorting by outcome ("show me redeemed only") — real feature,
  needs outcome as a queryable projection; cohorts partially cover it today.
- Outcome chips in the ⌘K palette or any agent-facing list.
- Dashboard recent-leads outcome chips (same voice module would make it cheap later).

## Open questions

1. Column header: keep **STATUS** or rename **OUTCOME**? (Scoped as: keep STATUS —
   it still holds held/pipeline/screening, not just outcomes.)
2. Empty cell voice: muted `—` (scoped) vs tiny muted `new`.
3. Campaign-type glyph: scoped IN — say if you'd rather not.

## Estimate

One PR, ~half a day: backend enrichment + contract tests ≈ 2–3h, frontend column +
shared module + tests ≈ 2–3h, then the usual gates and deploy-verify. No migration
unless the `prospectId` index is missing.
