# Studio profile questions — the PR 0 collection block (consumer enrichment)

**Status:** v4 — **APPROVED, Codex round 4 (gpt-5.6-sol xhigh),
2026-07-26** ("§5.1 steps 2–3 close the window… §7's replacement tests
align… No legacy-job stamping remains"). Convergence: 4B/4M/1mod →
2B/3M/1mod → 1 residual → APPROVE; logs §10–§12. **READY TO BUILD**
pending Shawn's §9 calls (launch enablement; children question copy).
**Author:** Claude, 2026-07-26
**Parent:** `docs/plans/consumer-profile-enrichment.md` §11 PR 0
**Depends on:** enrichment PR 1 (#281 MERGED — this plan also repairs two
of its latent defects, §5.1/§5.2)

## 1. Why and what

The enrichment pipeline is live but starving: prod funnels collect one
taxonomy fact. This adds the collection surface — a **"Profile questions"
block** a campaign opts into in Campaign Studio. Selected questions render
on the signup funnel as **optional, structured choices** (never free
text); answers flow through capture into map-job snapshots and land as
`consumer_observations` with `form`-grade provenance. No AI anywhere.

Product rules (owner decisions): fixed library only (§2); per-campaign
selection is Shawn's conversion-vs-data call — the AI "Fill everything"
flow NEVER enables questions on its own.

**Owner revision (2026-07-26, post-launch):** questions are skippable BY
DEFAULT, with two per-campaign controls added the same day: (1)
`requiredIds ⊆ questionIds` — required questions get an asterisk and the
funnel blocks submit until answered (CLIENT-side gate only; the server
keeps its drop-not-fail policy as the net); (2) `showZh` (default true) —
explicit false renders English-only prompts. Both clamp-sanitized,
leaf-picked into the public payload, and edited via the Studio card
(per-question Required toggle + a "Show Chinese text" master toggle).

## 2. Question library v1 — twins with server-side answer resolution

`src/lib/profileQuestionLibrary.js` ↔
`backend/src/utils/profileQuestionLibrary.js` (twin pair + byte-parity
test). Frontend consumes `{ id, prompt, promptZh, multi, options: [{ id,
label, labelZh }] }` for rendering ONLY. **Both twins carry** the
per-question pure function **`resolveAnswer(selectedIds) → taxonomy value
| null`** — identical bytes, dependency-free; the frontend simply never
calls it (byte parity and a backend-only method cannot both be true —
R2 #4). The server composes the complete fact value; option rows never
carry composable fragments (a multi-select's value cannot be assembled
from per-option values). [R1 #6]

| id | factKey | Shape | resolveAnswer contract |
|---|---|---|---|
| `language` | `identity.preferred_language` | single | en/zh/ms/ta → `{v}` (all four official languages, 2026-07-27; the taxonomy always allowed them) |
| `annual_income` | `finance.annual_income_band` | single | 5 bands verbatim |
| `children` | `family.children_count_band` (**new key**, §4) | single | none/1/2/3+ → `{v:'0'\|'1'\|'2'\|'3_plus'}` |
| `pets` | `household.pets` | multi | dog/cat/other/none chips → canonical-ordered, deduped `{v:[…], complete:true}`; `none` EXCLUSIVE (none+dog ⇒ invalid answer, dropped); prompt copy is "select all that apply" so `complete:true` is honest |
| `retirement_age` | `finance.retirement_age_band` | single | 5 bands verbatim |

**Locale rule (one, deterministic):** prompts always render English with
the Chinese inline where provided ("Annual income range · 年收入范围").
There is no campaign-locale mechanism in the funnel and none is built
here. [R1 #9]

## 3. design_config v2 — `profileQuestions` subtree (three surfaces, not one)

```
profileQuestions: { enabled: boolean=false, questionIds: string[] ⊆ library, ≤5, ordered, deduped }
```

All three surfaces change in lockstep, each with tests: [R1 #7]

1. **Twins:** `profileQuestions` added to `V2_TOP_KEYS` in BOTH
   `src/lib/designConfigV2.js` and `backend/src/utils/designConfigV2.js`
   (upgrade-preservation + parity tests).
2. **Clamp** (`designConfigV2Clamp.js`): an explicit
   `clampProfileQuestions` sanitizer — unknown ids dropped, cap 5, dedupe,
   zero-valid ⇒ disabled — wired BEFORE the unknown-top-level passthrough
   so raw input can never overwrite the sanitized value.
3. **Public projection:** `buildPublicDesignConfigV2` explicitly
   leaf-picks `{enabled, questionIds}` — unknown top-level keys are
   deliberately excluded from the anonymous payload
   (`publicDesignConfig.js`), so nothing is "automatically additive".
   [R1 #4]

**guided_review exclusion is enforced by architecture, stated for tests:**
guided_review campaigns have no v2 funnel — the block renders only in the
v2 renderer, and capture validation reads the campaign's RAW v2 config
(§5), which guided_review campaigns don't carry. A direct-API write of the
subtree onto such a campaign is inert, and a test proves it. [R1 #7]

**Flag preflight:** `DESIGN_CONFIG_V2_WRITES_ENABLED` must be `true` in
prod for Studio to persist the subtree (it is — all 12 campaigns are v2 —
but the rollout checklist verifies before announcing). [R1 #7]

**Studio editor:** the card lives in **FormPanel** (the rail is
Page/Form/Quiz/Theme/Distribution — no "Content panel" exists), with a
real `section: 'form'` click-to-edit target per the extension recipe
(attr + map entry + matrix row). [R1 #9]

## 4. Taxonomy — `family.children_count_band` + honest versioning

- New key `family.children_count_band` `{v: '0'|'1'|'2'|'3_plus'}` —
  a form answer can't invent ages, and `3+` cannot truthfully be an exact
  integer. [R1 #8]
- **Precedence vs `family.children`:** scoring/entailment read the
  detailed array when it has an active `complete:true` resolution,
  else the band; the parent plan's dependants entailment gains the
  band-as-lower-bound rule (`3_plus` ⇒ ≥3, never exact). [R1 #8]
- **`TAXONOMY_VERSION` bumps to `v2`** (the version must mean something);
  mapper becomes `mapper/v1.1+tax-v2`. Historical observations keep their
  stored rows, but the remap (§5.3) supersedes old-pipeline actives —
  "existing observations unaffected" is explicitly NOT claimed. [R1 #8]

## 5. Capture → artifact-scoped jobs → observations

### 5.1 Mapper v1.1 — ARTIFACT-SCOPED map jobs (repairs #281 latent bug №1)

Round 1 confirmed the shipped bug (a demographics edit activates an empty
quiz artifact and supersedes its rows) AND showed the v1 section-wrapper
fix is insufficient — jobs are prospect-wide, so a form edit at rev 2
stales a pending rev-1 capture job wholesale, LOSING its quiz/profile
facts instead of protecting them. [R1 #1]

Fix — map work becomes per-artifact, mirroring the extract shape:

- **Migration 092 — expand/contract, not a flip** (rolling deploys run
  old + new instances together; and legacy map jobs of EVERY status carry
  `sourceArtifactId NULL` with possibly COMBINED form+quiz payloads —
  stamping one `form:` would misattribute or discard quiz facts): [R2 #1]
  1. **Expand (092):** `chk_ejobs_kind` accepts BOTH map shapes
     (legacy-null and artifact-bearing); the artifact-scoped unique is
     added for artifact-bearing rows while the legacy unique stays for
     null rows. Old writers keep inserting legally; new writers insert
     artifact-scoped.
  2. **Deploy dual-shape code with artifact-scoped WRITES OFF** — writers
     keep emitting legacy-shaped jobs; the new processor handles BOTH
     shapes (splits a legacy combined payload per artifact — never
     single-artifact-activates it). Old processors therefore never see a
     new-shape job during the rollout window: none exist yet. [R3]
  3. **Flip `ENRICHMENT_MAP_ARTIFACT_JOBS=true` + restart** once the
     deploy has fully replaced old instances (house restart-to-flip
     convention) — writers switch to artifact-scoped jobs; only
     dual-shape processors are alive to claim them.
  4. **Drain to zero live legacy jobs** (tiny volume; verified by query),
     leaving terminal legacy nulls in place, explicitly permitted.
  5. **Contract (093, follow-up migration):** require artifact on
     non-terminal map jobs; drop the legacy unique.
- **Per-artifact revisions:** `form:` uses `prospects.enrichmentRevision`
  (unchanged); `quiz:` and `profile:` are capture-immutable in v1 ⇒
  revision pinned 1 (a future edit surface mints its own counter).
- **Capture** enqueues up to three jobs (form / quiz / profile), each only
  when its source exists; **edits** enqueue a form job ONLY — other
  artifacts' jobs and rows are untouched by construction. A form job with
  zero facts at revision > 1 still enqueues (cleared DOB must supersede);
  zero-fact revision-1 jobs are skipped for ALL artifacts (nothing to
  supersede — consistent with, not contradicting, zero-claim activation,
  which governs activation of an ACCEPTED result, and `enqueueMapJobTx`'s
  skip rule is now documented as such). [R1 #1]
- **`processMapJob` activates only its own artifact**; the stale gate
  compares the job's revision to THAT artifact's current revision.
- Race tests: pending capture quiz-job survives a form edit; form-only
  job coexists with a later remap at the same prospect.

### 5.2 Quiz wire-shape repair (repairs #281 latent bug №2)

The shipped mapper + `clampQuizFactKeys` read `quiz.questions[]` and an
object-indexed answer map — but real Studio quizzes are
`quiz.steps[].questions[]` (`quizScoringService.js`) and real submissions
are `[{qid, value}]` (`validation.js`). Real quiz campaigns would mint
zero facts. Both functions flatten `steps[].questions[]` and index
answers by `qid`; fabricated flat-shape fixtures are replaced with real
Studio quiz fixtures. [R1 #3]

**Immutable mapping input (R2 #2):** Studio edits quiz definitions
without minting versions, so remapping an old `[{qid, value}]` against
TODAY'S definition could mint facts the person never answered. Fix:
capture now freezes the RESOLVED quiz facts + a hash of the exact
factKey/factValues mapping subset into the quiz map-job snapshot (the
job payload is already the frozen source of truth — quiz mapping simply
stops re-reading the live definition after capture). The remap script
(§5.3) re-maps quiz artifacts ONLY from retained frozen payloads;
quiz artifacts with no provable captured mapping are **skipped and
reported, never guessed**. (Today that skip set is empty — no factKey
campaign has ever existed.)

### 5.3 Remap script (no phantom reconciliation) [R1 #2]

Bumping the pipeline version creates no work by itself — the nightly
sweep is PR 2. PR 0 ships `scripts/remap-observations.mjs`:

- **Frozen cohort:** the run fixes a `(createdAt, id)` watermark up
  front; only prospects at-or-before it are enumerated (post-watermark
  captures self-enqueue at the new version anyway). [R2 #5]
- **Cohort-scoped accounting:** the script records every job id IT
  inserts and computes done/stale/dead outcomes from that set only —
  `drainMapJobs` claims any pending map job, so raw drain counts would
  swallow live capture traffic. Completion = an artifact-level coverage
  query over the frozen cohort. [R2 #5]
- Idempotency claim narrowed: re-runs are no-ops **for live-unique
  statuses**; previously stale/dead/cancelled jobs re-enqueue by design
  (they exited the unique). [R2 #5]
- Quiz artifacts: frozen-payload-only, skip-and-report (§5.2).
- **Precondition:** every serving instance runs artifact-aware code
  (expand step done) before the script starts.
- Keyset batches, resumable, per-batch progress. Run once post-deploy;
  the rollout checklist owns sequencing. The §5.1/§5.2 fixes are inert
  for existing data until this runs.

### 5.4 profileAnswers wire contract (abuse-bounded, ordered) [R1 #5]

`POST /api/prospects` gains `profileAnswers`, validated in this exact
order:

1. **Joi** (the public capture schema — the route's global
   `stripUnknown:true` would otherwise silently erase the field, and a
   pattern-length-failed key is silently REMOVED unless the nested object
   itself rejects unknowns): `profileAnswers` is declared
   **`.unknown(false)`** with an explicit bounded key pattern (≤ 32
   chars), ≤ 5 keys, values string (≤ 32) or string-array (≤ 8, unique).
   Structural violations ⇒ 400 — **for requests the rate limiter admits**
   (limiter runs first; over-limit garbage gets 429, and that ordering
   stays). [R2 #6]
2. Destructure `profileAnswers` out before the Sequelize input object is
   built (never mass-assigned).
3. Load the campaign's RAW v2 config (not the legacy view).
4. **Eligibility gate, all three legs, else ignore the whole object and
   enqueue no profile job:** raw config classifies as v2 AND
   `profileQuestions.enabled === true` AND campaign type is not
   `guided_review` — backend eligibility must equal rendering
   eligibility; a disabled subtree can retain stale ids, guided_review
   branches before the v2 adapter, and campaign save doesn't restrict v2
   docs by type, so "inert by architecture" is only true WITH this gate.
   Then iterate the CAMPAIGN'S configured `questionIds` — never
   attacker-provided keys. [R2 #3]
5. Enforce single-vs-multi shape per question; unknown option ids,
   `none`-exclusivity violations, dupes ⇒ that answer dropped.
6. `resolveAnswer` → taxonomy value → `validateFact` (belt + braces).
7. Persist accepted canonical answer ids to
   `sourceMetadata.profileAnswers` (erasure's allowlist rebuild already
   removes it — verified: the rebuild keeps only selected UTM fields +
   `erased:true`).
8. One aggregated log line for dropped answers (never per-key logging an
   attacker controls).

Policy: structural abuse fails the request (400); stale/retired/
un-configured question ids are ignored — a bad answer never costs a lead.
Accepted facts join the capture's `profile:` map-job snapshot
(`artifact: 'profile'`, source `form`, confidence 1.0).

## 6. Funnel rendering — the REAL owners [R1 #4]

- The signup form is owned by
  `src/components/campaigns/CampaignSignupForm.jsx` — the block mounts
  there, between the core fields and consent/CTA, theme-token styled,
  chip-selects, every question skippable, "Optional — helps us serve you
  better" reassurance line. Mobile 390×844 no-overflow.
- `funnelAdapter.js` downgrades v2 → legacy view for the funnel: the
  `profileQuestions` subtree is extracted and passed through BEFORE the
  downgrade (own prop, not smuggled through the legacy shape).
- `LeadCapture.jsx` builds the submission payload explicitly —
  `profileAnswers` is added to that construction (local form state alone
  goes nowhere).
- Test: anonymous public-campaign endpoint → adapter → form renders
  enabled questions → POST carries `profileAnswers` (the full path, not
  unit islands).

## 7. Tests

Library twin byte-parity + every resolveAnswer output round-trips
`validateFact`; pets exclusivity/canonical order. Clamp: sanitizer bounds
+ ordering vs unknown-passthrough + zero-valid disable + parity/golden
suites untouched. Capture: the §5.4 matrix (Joi 400s, campaign-scoped
iteration, drop-vs-fail policy, sourceMetadata persistence, mass-assign
proof). Mapper: artifact-scoped enqueue/activation, edit-leaves-quiz-alone
regression (THE #281 bug), pending-quiz-job survives form edit,
real-Studio-quiz-shape mapping (steps[].questions[] + [{qid,value}]),
zero-fact rev>1 supersession, A→B→A per artifact. Remap script:
cohort-scoped counts, resume, narrowed idempotency. Renderer: full-path
test (§6) + disabled renders nothing + guided_review inert. Migration
092 + choreography: **mixed-shape coexistence** (legacy + artifact jobs
under both uniques), **combined-legacy-payload split** by the dual-shape
processor, writes-flag off ⇒ legacy emission, on ⇒ artifact emission —
no stamping of legacy jobs anywhere. Idempotent re-run of 092.

## 8. Rollout

One PR, naturally dark (nothing renders until a campaign enables it):
migration 092, library twins, config twins + clamp + public projection,
Studio FormPanel card + click-edit target, CampaignSignupForm block +
adapter/LeadCapture plumbing, capture validation, mapper v1.1 + quiz
wire fix, taxonomy v2, remap script, tests. Post-deploy: run
`remap-observations.mjs`; verify `DESIGN_CONFIG_V2_WRITES_ENABLED`;
Shawn enables questions per campaign in Studio (that moment starts
filling PR 2's volume gate).

## 9. Open questions (Shawn)

1. Launch enablement: language-only on all live campaigns, or the full
   five on the Tokyo draw as pilot?
2. `children` copy: single-step count ("Do you have children? None/1/2/
   3+") proposed — OK?

## 10. Codex round 1 — disposition log (REWORK 4B/4M/1mod, all adopted)

| # | Finding | Disposition |
|---|---|---|
| 1 | Section-wrapper fix insufficient — jobs prospect-wide; rev bump stales pending quiz facts wholesale; bug confirmed real in shipped code | **Adopted** — artifact-scoped map jobs + per-artifact revisions + migration 092 (§5.1). |
| 2 | "Version-keyed sweep remaps the world" doesn't exist in this PR era | **Adopted** — explicit idempotent remap script ships in PR 0; sweep stays PR 2 (§5.3). |
| 3 | Shipped quiz mapper + clamp read a wire shape real quizzes never produce | **Adopted** — steps[].questions[] flattening + [{qid,value}] indexing + real fixtures (§5.2). |
| 4 | Subtree doesn't reach the anonymous funnel or POST (public builder leaf-picks; funnelAdapter downgrades; LeadCapture explicit payload; form owner is CampaignSignupForm) | **Adopted** — all four plumbing points named + full-path test (§3, §6). |
| 5 | No abuse-bounded validation contract; Joi stripUnknown erases the field | **Adopted** — 8-step ordered contract, 400-vs-ignore policy, aggregated logging (§5.4). |
| 6 | Multi-answer mapping not executable from per-option values | **Adopted** — server-side `resolveAnswer` per question; pets exclusivity + canonical composition (§2). |
| 7 | Three config surfaces (V2_TOP_KEYS twins, clamp-before-passthrough, public whitelist) + flag preflight + guided_review enforcement | **Adopted** — §3. |
| 8 | children_count `{v:3}` dishonest for 3+; taxonomy version must move; "observations unaffected" overclaimed | **Adopted** — `children_count_band` w/ `3_plus`, precedence + lower-bound entailment, tax-v2, claim narrowed (§4). |
| 9 | No locale mechanism; no "Content panel" in the Studio rail | **Adopted** — EN-with-ZH-inline rule; FormPanel + section:'form' target (§2, §3). |

## 11. Codex round 2 — disposition log (REWORK 2B/3M/1mod, all adopted)

Quiz wire-shape + public/funnel plumbing closures CONFIRMED; per-artifact
revision pinning (quiz/profile = 1) CONFIRMED sound for this release
(sourceMetadata is not in the update allowlist — any future edit surface
must add a persisted per-artifact counter first).

| # | Finding | Disposition |
|---|---|---|
| 1 | Migration 092 flip unsafe under rolling deploys + combined legacy payloads | **Adopted** — expand/contract choreography; combined legacy jobs split per artifact by the new processor, never stamped `form:`; terminal legacy nulls permitted until contract step (§5.1). |
| 2 | Historical quiz remap has no immutable mapping input (Studio edits quizzes unversioned) | **Adopted** — quiz mapping freezes resolved facts + mapping hash into the job payload at capture; remap = frozen-payloads-only, skip-and-report (§5.2). |
| 3 | Backend eligibility weaker than rendering eligibility (disabled subtree retains ids; guided_review not type-restricted at save) | **Adopted** — three-leg gate in §5.4 step 4 + tests for disabled-with-ids and direct-API guided_review. |
| 4 | Backend-only resolveAnswer contradicts byte parity | **Adopted** — resolveAnswer in BOTH twins, frontend never calls (§2). |
| 5 | Remap counts swallow live traffic; "re-runs no-ops" false for stale/dead | **Adopted** — watermark cohort + run-inserted job-id accounting + coverage query + narrowed idempotency claim (§5.3). |
| 6 | Real middleware order (limiter first ⇒ 429) + stripUnknown silently removes pattern-failed keys | **Adopted** — nested `.unknown(false)` + bounded key pattern; 400 contract scoped to limiter-admitted requests (§5.4). |

## 12. Codex round 3 — disposition log (REWORK, 1 residual + 1 stale test)

Five of six R2 fixes confirmed closed as written; no other new
wrong-behavior found.

| # | Finding | Disposition |
|---|---|---|
| 1 | New writers can emit artifact-scoped jobs while OLD processors still run (rolling window) — old processor claims them prospect-wide, reintroducing sibling supersession | **Adopted** — dual-shape processor ships with writes OFF; `ENRICHMENT_MAP_ARTIFACT_JOBS` flips post-deploy (restart), so old processors never coexist with new-shape jobs (§5.1 steps 2–3). |
| 2 | §7 "pending-job stamping" test contradicts the no-stamping choreography | **Adopted** — replaced with mixed-shape coexistence + combined-payload-split + flag-emission tests (§7). |
