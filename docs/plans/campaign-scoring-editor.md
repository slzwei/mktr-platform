# Campaign Scoring Editor — plan v5 (2026-07-30)

**In one sentence:** the scoring-config backend already exists (PR #312 —
draft → simulate → approve, AI propose, validator, dark behind
`SCORING_CONFIG_ADMIN_ENABLED`); this project builds the **missing UI** on the
campaign page and in the create flow, plus a set of service amendments the
Codex reviews surfaced, then flips the flag.

**History:** v1 (premise "no write path exists") — Codex round 1 FAIL, M1
found #312's stack. v2 (rewritten around the stack) — round 2 FAIL: three
pushbacks rejected with evidence, six new majors on the amendments' precision.
v3 folded round 2 in — round 3 FAIL, narrowed to 4 majors + 4 wire details on
the folds themselves (and confirmed §4.5's lock design and §4.4's caption
semantics). v4 folded round 3 — round 4 (delta audit) FAIL with 1 major + 2
minors, all contract precision. v5 folds round 4. Disposition logs:
§10/§11/§12/§13.

## 1. Ground truth

- **Backend stack (PR #312, live-dark):** `routes/scoringConfigs.js`
  (`/api/admin/scoring-configs`: list · resolve · get · draft · AI propose ·
  simulate · approve; router unmounted until `SCORING_CONFIG_ADMIN_ENABLED`) ·
  `services/scoringConfigService.js` (`createDraftConfig` stores the RAW doc,
  normalize-at-read; `approveScoringConfig` supersedes-at-scope + whole-map
  cache bust; `simulateConfig` cap 500, deciles, big-moves >20, became-null) ·
  `utils/scoringConfigValidation.js` (finite numbers, 0.4 dominance cap,
  ageCurve upTo 0..120 ascending + open tail) · 4 test suites.
- **Resolution picks ONE row** (campaign → product → global, highest approved
  at first matching tier); `normalizeConfig` fills unmentioned knobs from CODE
  defaults, never from the losing tier.
- **Approving an older draft = rollback** (supersede + max-approved agree) —
  sequentially. Concurrently it does NOT converge: the status check runs
  outside the txn, the approve UPDATE has no `status='draft'` predicate, and
  two approvers can commit two approved rows (resolution still picks max, but
  status-lineage corrupts and a racing rollback can silently not take) → §4.5.
- **Sweep budget:** up to ~400 stale consumer+lead rows/night (80% of 500)
  inside a 5-minute deadline, **consumers before leads** — which is why the
  person-pass stamp overwrite (§4.4) matters.
- `scoreOneConsumer` still stamps person-grain `scoredConfigVersion` /
  `scoringAlgorithmVersion` / `scoreComputedAt` on `consumer_profiles` (its
  staleness bookkeeping reads them back); the breakdown the profile card shows
  is the winning LEAD's. Under campaign sheets those diverge → §4.4.
- `computeLeadInputHash` includes `configVersion`: ANY new approved edition —
  even byte-identical content — makes every inheriting lead stale and triggers
  a full regrade → §4.6 idempotent-approve rule.
- The brief (`campaignBrief.js` twins) carries product / `audience.ageBands`
  (MULTI-select) / `audience.language`; `briefProductKey` already drives the
  product tier. Two live create surfaces (`VITE_CAMPAIGN_WORKSPACE_ENABLED`):
  workspace `CampaignDetailsTab` + classic `AdminCampaignForm`; BOTH navigate
  away on create (classic → list, workspace → Design tab), so any post-create
  scoring call must complete (or fail visibly) BEFORE navigation → §3.3.
- `DEFAULT_SCORING_CONFIG` is backend-only; the UI's "house default" ghosts
  come from the server (§4.2's strict resolve returns them), never a twin.

## 2. What v3 builds

1. **`ScoringSheetEditor`** (shared component) — §3.1.
2. **"Lead scoring" card** on `AdminV2CampaignDetail` — §3.2.
3. **Creation-time block** on both create surfaces — §3.3.
4. **Service amendments** on the existing files — §4. One new read endpoint
   (regrade progress), zero new services, zero migrations (Discard was cut to
   keep that true — §4.6).
5. **Rollout:** flip `SCORING_CONFIG_ADMIN_ENABLED` — §8.

## 3. Product shape

### 3.1 `ScoringSheetEditor` (shared)

- **Weights, grouped Meet / Buy** (labels shared with the lead card via one
  module): engagement /15 · contactability /10 · market fit /15 · message
  response /15 · screening call /20 · life events /25 · family gap /20 ·
  capacity /15 · age /10 · coverage headroom /−10. Steppers; signs fixed
  per component and now ENFORCED by the validator (§4.7), not just the UI.
  House default ghosted beside every knob from the server DTO; per-knob reset
  pins the house VALUE explicitly.
- **Age dial:** brief-band presets + advanced segment rows. **Multi-band
  rule (deterministic, and slope-legal by construction):** each age's value
  comes from its band-distance to the nearest SELECTED brief band — distance
  0 → 1.0, 1 → 0.8, 2 → 0.55, 3+ → 0.3 — merged into the minimal ascending
  `upTo` list ending in the open tail. The ladder's boundary jumps (≤0.25)
  sit inside the validator's 0.5 adjacent-segment slope cap, which a naive
  "selected = 1.0, everything else = house shoulder" rule violates (0.25 →
  1.0 at age 18 would 422). Non-selected ages are therefore deliberately
  ramped, not held at house values.
- **Target segments:** language/ethnicity/weight rows; language vocab from
  the campaignBrief twin; ethnicity constants EXPORTED from the backend
  taxonomy (currently private) and pinned by a parity test. `language:'any'`
  maps to no segment row.
- **Prefill semantics (seed-once):** the editor prefills from the brief ONLY
  when the campaign has no campaign-tier edition (draft or approved) and the
  editor opens empty. Later brief edits never auto-touch scoring.

### 3.2 After creation — "Lead scoring" card on `AdminV2CampaignDetail`

- **Read state:** governing sheet — tier chip (campaign edition #N / product /
  house default v0), activated when + by whom, dial summary, and **regrade
  progress** ("X of Y leads on edition #N") from the new progress endpoint
  (§4.8) whenever current ≠ 100%.
- **Customise →** editor drawer seeded from strict resolve (§4.2). **Save
  draft** → `POST /scoring-configs` with `campaignId` + `composeOnResolved`
  (§4.1). **Preview impact** → simulate with `compareTo:'resolved'` (§4.3),
  became-null count rendered as a blocking-style warning. **Approve & apply**
  → approve with REQUIRED `expectedLiveVersion` (§4.5); the confirm restates
  scope + big-mover count, and names rollback when approving an edition older
  than the live one.
- **History disclosure:** campaign-scoped list (server-side filter — §4.6),
  newest 50 with "showing latest 50": drafts dated by `createdAt`, approved
  rows by `activatedAt`, actor NAMES via a safe DTO. Row actions: view
  (read-only editor via `GET /:version`); DRAFT rows → "Make live" (§4.5);
  superseded/older editions → **"Restore as new draft"** (copies that
  edition's `configJson` into a fresh draft) — approve is draft-only by
  §4.5's status predicate, so a superseded row can never be re-approved
  directly (round-3 B2). **Restore provenance is UI-transient by choice**
  (round-4 B1): a restored draft is a NEW highest version, so the approve
  confirm's "this rolls back past edition #N" wording applies only to
  genuinely-older drafts (`candidateVersion < liveVersion`); a restored
  draft instead carries "copied from edition #N" in the drawer at restore
  time. Persisting provenance would need a migration or a configJson key the
  validator rejects — declined, stated. **No Discard in v1** — drafts stay
  visible and inert (§4.6); superseded markers explain themselves.
- **Flag-off state:** any scoring call 404s (router unmounted) → the card
  renders neutral copy: "Scoring controls unavailable on this backend" —
  deliberately NOT claiming the flag is off (a 404 can also mean an old
  deploy; B10).

### 3.3 During creation (both surfaces)

- Scoring block under the brief: "Leads will score with: *product sheet /
  house default*" via strict `GET /resolve?productKey=` (no campaign id
  needed). "Tailor scoring →" expands the shared editor prefilled per §3.1.
- **On create, ordering is explicit:** campaign commits → the surface AWAITS
  the scoring draft call (bounded timeout) BEFORE navigating; on failure it
  shows "campaign created — scoring sheet not saved; set it up on the
  campaign page" and navigates anyway. No sessionStorage/outbox machinery:
  the trade (rare manual redo, zero new infra) is accepted and stated.
  "Apply immediately" chains the approve call under the same await.
- A retried draft producing a duplicate is inert and visible; a duplicate
  APPROVE is made harmless by §4.6's content-equal no-op (it can no longer
  trigger a spurious full regrade).
- Creation is never blocked by scoring failures; flag-off shows the §3.2
  neutral copy.

## 4. Service amendments (existing files unless stated)

### 4.1 Compose campaign overrides onto the winning raw doc (M3+B7)
`createDraftConfig({ composeOnResolved: true })`: server deep-merges the
editor's patch onto the **currently-winning tier's RAW `configJson`** (base =
`{}` when resolution returns version 0). Merge is recursive for PLAIN OBJECTS
ONLY; arrays (`ageCurve`, `targetSegments`, `groups.*`) replace wholesale.
The editor always writes the full exposed set (all ten weights + ageCurve +
targetSegments), so exposed knobs never float; UNEXPOSED knobs a product
sheet carries explicitly (decay…) survive the merge; unexposed knobs nobody
ever wrote continue to float to code defaults — stated, not hidden: a
campaign edition pins what the admin SAW, which is the exposed set plus the
winner's explicit extras.

### 4.2 Strict resolve for the editor read path (M4+B8)
New `resolveScoringConfigStrict({campaignId|productKey})`: **direct DB read,
no cache read, no cache write, no fail-open** — a read failure is a 5xx. The
scorer's fail-open `getActiveScoringConfig` is untouched. Route:
`GET /resolve?strict=1`, which also gains the missing UUID validation on
`campaignId`, and the strict response carries activation metadata (version,
scope, activatedAt, actor name) + `houseDefault` (normalized
`DEFAULT_SCORING_CONFIG`) as the ghost/reset source (B12).

### 4.3 Simulate isolates config impact — with a costed budget (M5+M6+B9)
`simulateConfig` gains `compareTo:'resolved'` (v1 scope: CAMPAIGN drafts
only — product-scope populations include campaign-overridden leads, B9, so
the mode refuses product/global scope until the population query excludes
them): per sampled lead, load inputs ONCE, run `scoreLead` twice at one fixed
`now` (resolved vs candidate), report the config-only delta; stored score
returns separately labelled "includes drift since last rescore".
**Cost, stated:** the per-lead loads are ~9 queries (telemetry + messages +
canMarketTo chain + observations); v1 runs `sampleMax=100`, concurrency 4,
logs duration, and the response carries `examined`/`truncated` — measured
p95 > 5s triggers the named fast-follow (batch loaders for prospects,
messages, consent, observations, stored scores). Not described as solved;
described as bounded and measured.

### 4.4 The person card's stamp — read it from the source lead (M8, reworked)
Copying stamps in `projectPersonScore` is NOT enough: `scoreOneConsumer`
re-stamps the same columns every consumer pass (its staleness bookkeeping
reads them back), and the sweep runs consumers first — the copy would revert
nightly. The fix is AT READ, in **one SQL statement** (round-3 M1): the
profile row and the source lead's `scoredConfigVersion` /
`scoringAlgorithmVersion` / `scoreComputedAt` come back from a single
`consumer_profiles LEFT JOIN prospects ON id = "scoreSourceProspectId"` read
— one MVCC snapshot, so a rescore committing mid-request can never pair an
old projected breakdown with a newer source stamp (the two are written
atomically on the write side). The card prefers the source stamps ONLY when
the join resolves. **When a projected breakdown exists but the source lead is
gone** (prospect delete nulls the pointer and deliberately keeps the stale
projection — migration 101), the card shows NO stamp caption at all: "score
source signup unavailable" — neutral wording, because a null pointer is NOT
proof of deletion: migration 101 deliberately left pre-existing projections'
pointers null, and the two states are observationally identical (round-5 B1).
Never the person-pass stamps, which would caption the copied breakdown with
an unrelated config/time (round-4 M1; the same lie this section exists to
fix). A test pins the branch: breakdown retained + null source → neither
source nor person-pass stamps. Person-pass stamps caption nothing but
person-pass state. Older-than-person-pass source stamps are CORRECT, not
stale — they caption the copied breakdown, not current resolution (round-3
confirmed). Zero migrations, person-pass bookkeeping untouched. (`best IS
NULL`: projection clears source + breakdown together, so there is nothing to
caption.)

### 4.5 Approve becomes race-safe (M2, accepted in full)
`approveScoringConfig`: take a transaction-scoped **advisory lock keyed by
scope** — `SELECT pg_advisory_xact_lock(hashtext(:key))` with key
`scoring-config:campaign:<uuid>` / `scoring-config:product:<key>` /
`scoring-config:global`, the same composition the repo already uses in draw
boost provisioning; INSIDE the txn re-read the resolved winner for the
candidate's scope (not merely same-tier approved — a campaign may inherit
product/global) and compare against `expectedLiveVersion` (REQUIRED at the
route, body `{expectedLiveVersion}`, validated as an **integer ≥ 0** — 0 is
the legitimate "house default was live" baseline); supersede + approve with
`WHERE status='draft' … RETURNING` so a non-draft can never be promoted. 409
message stays a sentence: "the live sheet changed while you were editing —
re-open preview".

### 4.6 Lifecycle + read-API completions (M10/M12/M13)
- **Idempotent approve:** when the candidate's `configJson` equals the live
  row's at the same scope — compared IN SQL as `jsonb = jsonb`, which is
  semantic equality (key order and numeric form normalized), never string
  comparison — approve returns `{ noOp: true, live, candidateVersion }` and
  **leaves the candidate as a draft**: no status change, no cache bust (no
  write occurred), no new live version → no spurious full regrade. Round-3
  M2 killed the v3 variant that superseded the draft (drafts carry
  `activatedAt` from insert, so a superseded draft is indistinguishable from
  a formerly-live edition). The stale duplicate stays visible in history as
  what it is: a draft. **Route + UI contract (round-4 B2):** the approve
  route returns 200 with the discriminated `{noOp:true, live,
  candidateVersion}` body (the normal path keeps returning the approved
  row); the UI toasts "already live — nothing changed, no regrade
  triggered"; tests pin that a no-op busts no cache, changes no
  `activatedAt`, and leaves the candidate a draft.
- **Discard is CUT from v1** (three statuses only; drafts get `activatedAt`
  at insert, so superseded-as-discard would corrupt history semantics).
  Drafts stay visible and inert. A `discarded` status + `discardedAt` is a
  Phase-2 migration if draft clutter ever hurts.
- **`listScoringConfigs`** gains mutually-exclusive scope filters
  (`campaignId` | `productKey` | `global:true`) applied BEFORE order/limit,
  actor-name DTO (id → name join, no email/phone), and `createdAt` in both
  list and `GET /:version`.
- `createDraftConfig` verifies a given `campaignId` exists → 422 (no-FK
  table otherwise accepts any UUID).

### 4.7 Validator strengthening (M11 — extend, never fork)
`validateScoringConfig` gains: per-component SIGN map (coverage_headroom ≤ 0,
everything else ≥ 0); `targetSegments` exact key allowlist
({language?, ethnicity?, weight}), at least one match axis per row, enum
vocab from exported taxonomy constants, duplicate-axis rejection, ≤ 8 rows;
exact `decay` key allowlist (the two known half-lives); serialized-size cap
`MAX_SCORING_CONFIG_BYTES = 64 * 1024`, measured as
`Buffer.byteLength(JSON.stringify(composedConfig), 'utf8')` AFTER §4.1
composition and BEFORE semantic validation/storage (round-3 B4). Existing
suites extend; no second validator anywhere.

### 4.8 Regrade progress endpoint (M14 + round-3 M4/B3)
`GET /api/admin/scoring-configs/progress?campaignId=` — registered BEFORE
`GET /:version` or Express reads "progress" as a version (round-3 B3). One
snapshot query: `total` = non-erased leads of the campaign (matches the
sweep's own exclusion), and `current` is the exact COMPLEMENT of
`findStaleLeadIds`' predicate, not a version match alone:

```sql
"scoreComputedAt" IS NOT NULL
AND "scoreDirtyAt" IS NULL
AND "scoredConfigVersion" = resolvedVersion
AND "scoringAlgorithmVersion" = :leadAlgorithmVersion
```

(never-scored and dirty-marked rows are stale even on the right edition;
stamped null SCORES still count — scored-and-null is a result, never
`score IS NOT NULL`). Completion = `total === 0 || current === total`, so an
empty campaign never polls forever. Card polls only while visible and
incomplete. Index `(campaignId, scoredConfigVersion,
scoringAlgorithmVersion)` noted as a follow-up if polling shows up in pg
stats — not shipped speculatively.

## 5. Validation & composition order

Editor patch → §4.1 composition → §4.7 validator (sees the full stored
document) → simulate gate (semantics: dominance, big moves, became-null) →
approve (§4.5). Client-side bounds are UX mirrors only; the validator is the
single authority.

## 6. Invariants checklist

1. `version` = one global sequence; stamps unambiguous.
2. Append-only; nothing deleted; v1 has NO discard.
3. Only approved resolves; drafts inert.
4. RAW doc stored; §4.1 composition stores what the admin saw (exposed set +
   winner's explicit extras); unwritten unexposed knobs float by design.
5. Rollback = approving an older edition; UI names it; §4.5 makes it
   race-safe.
6. Content-equal approve is a no-op (never a spurious regrade).
7. Whole-map cache bust on every write (unchanged rule).
8. Duplication does NOT clone a custom sheet; duplicate flow notes it
   (Phase 2 line).
9. Both create surfaces or neither; scoring calls awaited-before-navigate,
   never blocking creation on failure.
10. Anonymous campaign endpoints never carry configs.
11. Test DBs replay no migrations — suites mint their own rows.
12. `{}` brief prefills nothing; prefill is seed-once (§3.1).
13. Flag-off = neutral "unavailable" copy, never "the flag is off".

## 7. Tests

- **Backend (extend the four #312 suites + leadProfileService):**
  composition (objects merge, arrays replace, version-0 base, winner's
  explicit extras survive); strict resolve (no cache read/write, 5xx on DB
  failure, UUID 400); simulate compareTo (config-only delta at fixed now,
  loads once, campaign-scope-only refusal, zero writes); approve (advisory
  lock serialization test, expectedLiveVersion 409, WHERE status='draft'
  blocks non-drafts, content-equal no-op, resolved-winner comparison across
  tiers); list scope filters + actor DTO + createdAt; campaign-existence 422;
  progress counts (null-score stamped leads count as current; erased
  excluded); profile-card stamp sourced from the source lead (M8).
- **UI:** card states (unavailable / default / product / custom /
  mid-regrade); editor prefill rules incl. multi-band curve + seed-once;
  preview incl. became-null warning + truncated label; approve confirm incl.
  rollback wording; history (createdAt vs activatedAt, no discard); create
  flow on BOTH surfaces: await-then-navigate, failure toast + navigate,
  flag-off neutral copy, creation never blocked.
- **Wire fences:** strict-resolve, list, and progress payload shapes pinned.

## 8. Rollout

1. Ship code, flag off — router unmounted, UI shows neutral copy, zero
   behavior change.
2. Flip `SCORING_CONFIG_ADMIN_ENABLED=true` (Render env).
3. First real use: author the iPhone-draw campaign's sheet, preview, approve;
   watch regrade progress climb overnight.
4. Rollback = flag off (authoring disappears; approved sheets keep scoring —
   the flag gates authoring, not resolution).

## 9. Phases

| Phase | Ships |
|---|---|
| **1** | Editor + campaign card + history + §4.1–4.8 + tests |
| **1.5** | Rescore-now (SHIPPED 2026-07-31): POST /rescore — cache-busted, campaign-filtered via findStaleLeadIds' own predicate (sweep-agreeing by construction), scoreOneLead per row under a row cap (500) AND a 25s deadline, honest {examined, rescored, remaining, more} response; card button on the progress line. M7 hardening = the up-front cache bust; residual races self-heal via version-mismatch staleness |
| **2** | Creation-time block (SHIPPED 2026-07-31, both surfaces): CreateScoringBlock under the brief — strict product-tier resolve line, "Tailor scoring →" opens the shared editor prefilled from the brief picks (bands → ladder curve, language → segment; seed-once), "apply immediately" approves with the pre-create baseline as expectedLiveVersion; both create flows AWAIT submit(campaignId) before navigating, failures toast + navigate (creation never blocked); untouched block mints nothing; 404 → neutral line + no-op. Duplicate-flow note + optional `discarded` migration remain future |
| **1.6** | AI-propose button (SHIPPED 2026-07-31): "Draft with AI" on the card — optional steer sentence → /propose reads the brief and writes the sheet → the SAME draft/preview/approve gates; card re-simulates compareTo:'resolved' (never the propose response's stored-comparison sim) and renders the rationale; ANY edit invalidates the pending draft so approve can never ship a pre-edit doc |
| out | Product/global sheet screens · decay knobs · batch preview loaders unless §4.3's budget trips · agent-facing anything |

## 10. Codex round-1 log (gpt-5.6-sol xhigh — FAIL)

M1 stack exists **CONFIRMED** (reframed) · M2 partial → superseded by round-2
M2 (accepted in full, §4.5) · M3 **CONFIRMED** §4.1 · M4 **CONFIRMED** §4.2 ·
M5 **CONFIRMED** §4.3 · M6 partial → round-2 rejection accepted (§4.3 costed)
· M7 partial (self-healing; Phase 1.5) · M8 **CONFIRMED** → reworked §4.4 ·
M9 resolved via existing /resolve + §3.1 prefill rules · M10 → round-2
partial acceptance (§4.6 no-op approve + await-before-navigate) · M11
**CONFIRMED** §4.7 · B1 corrected · B2 carried · B3 → §4.6 · B4 §3.1 · B5
§4.6/§3.2 · B6 invariant 8.

## 11. Codex round-2 log (gpt-5.6-sol xhigh — FAIL)

| # | Verdict | Fold |
|---|---|---|
| M2 concurrent approve doesn't converge | **CONFIRMED** (unconditioned UPDATE, check outside txn, two-approved end-state, racing rollback can silently not take) | §4.5 advisory lock + required expectedLiveVersion + status-predicated UPDATE + resolved-winner comparison |
| M6 pool-4/200 not adequately costed; index claim too strong | **CONFIRMED** | §4.3: cap 100, measured budget, named fast-follow; index claim withdrawn (order-by-id vs (campaignId,createdAt) noted) |
| M8 projection copy reverted by consumer pass | **CONFIRMED** | §4.4 reworked to read-time sourcing via scoreSourceProspectId (zero-migration; neither Codex option needed) |
| M10 identical double-approve → full regrade; retry state unmounts | **CONFIRMED** | §4.6 content-equal no-op; §3.3 await-before-navigate; outbox still declined |
| M11 validator not binding for signs/segments/decay | **CONFIRMED** | §4.7 |
| M12 discard corrupts lifecycle + races | **CONFIRMED** | Discard CUT from v1 (§4.6); Phase-2 migration option |
| M13 history unimplementable from existing reads | **CONFIRMED** | §4.6 list filters + actor DTO + createdAt |
| M14 progress has no contract | **CONFIRMED** | §4.8 endpoint + counting rules |
| B7 merge precision | **CONFIRMED** | §4.1 (arrays wholesale; version-0 base; float caveat stated) |
| B8 strict must bypass cache | **CONFIRMED** | §4.2 direct-DB |
| B9 product-scope population | **CONFIRMED** | §4.3 campaign-scope-only in v1 |
| B10 404 ≠ flag-off | **CONFIRMED** | §3.2 neutral copy |
| B11 multi-band prefill | **CONFIRMED** | §3.1 deterministic rule + seed-once |
| B12 ghost source | **CONFIRMED** | §4.2 houseDefault DTO |

## 12. Codex round-3 log (gpt-5.6-sol xhigh — FAIL, narrowed to the folds)

Confirmed sound by round 3: §4.5 lock design (key composition matches the
existing draw-boost pattern) · §4.4's erased/best-IS-NULL paths and the
older-stamp caption semantics ("exactly right") · §4.8's total predicate.

| # | Finding | Fold |
|---|---|---|
| M1 | §4.4's two reads aren't one snapshot; a mid-request rescore pairs old breakdown with new stamp; deleted source lead unhandled | §4.4: single LEFT JOIN statement (one MVCC snapshot); source stamps only when the join resolves, else person-pass fallback |
| M2 | v3's content-equal no-op superseded the draft — recreating the exact lifecycle corruption Discard was cut for | §4.6: candidate STAYS a draft; `{noOp:true, live, candidateVersion}`; no cache bust |
| M3 | Naive presets violate the validator's 0.5 adjacent-slope cap (house 0.25 → selected 1.0 jumps 0.75) | §3.1: band-distance ladder 1.0/0.8/0.55/0.3 — slope-legal by construction |
| M4 | "current" wasn't the complement of `findStaleLeadIds` (never-scored + dirty rows counted as done) | §4.8: exact complement predicate |
| B1 | Equality predicate unspecified | §4.6: SQL `jsonb = jsonb` (semantic), never strings |
| B2 | "Approve-as-rollback" impossible on superseded rows (approve is draft-only) | §3.2: drafts "Make live"; superseded/older "Restore as new draft" |
| B3 | Route order (/progress vs /:version); expectedLiveVersion ≥ 0 incl. version-0 baseline; empty-campaign completion | §4.8 + §4.5 |
| B4 | Size cap had no value/measurement rule | §4.7: 64 KiB, byteLength after composition |

## 13. Codex round-4 log (gpt-5.6-sol xhigh, delta audit — FAIL: 1 major, 2 minors)

| # | Finding | Fold |
|---|---|---|
| M1 | Deleted-source fallback captioned the copied breakdown with unrelated person-pass stamps (delete nulls the pointer, keeps the projection — migration 101) | §4.4: source-or-NOTHING — "scored under a signup since deleted", never person-pass stamps under a projected breakdown |
| B1 | Restore-as-new-draft mints the newest version, so version-comparison rollback wording can't recognize it; no persisted provenance field exists | §3.2: rollback wording only for `candidateVersion < liveVersion`; restore provenance UI-transient by stated choice |
| B2 | No-op approve had no route/UI contract | §4.6: 200 `{noOp:true, live, candidateVersion}`, toast copy, test pins (no bust, no activatedAt, stays draft) |

## 14. Codex round-5 log (gpt-5.6-sol xhigh — **PASS-WITH-AMENDMENTS**, applied)

Restore-provenance and no-op folds "internally consistent and implementable
as written". One amendment, folded into §4.4: [B1] a null source pointer is
observationally identical for a DELETED lead and a pre-migration-101 legacy
projection (pointers were deliberately not backfilled) — fallback copy is
now the neutral "score source signup unavailable", with a test pinning that
the branch shows neither source nor person-pass stamps.

**Plan status: PASSED (5 rounds: 17 → 14 → 8 → 3 → 1 findings). Phase 1
implementable as written.**
