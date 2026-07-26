# Consumer Profile Enrichment — person-level facts, AI summary, consumer score

**Status:** v5 — **APPROVED, Codex round 5 (gpt-5.6-sol xhigh), 2026-07-26**
("all four R4 findings closed as written; no new wrong-behavior; no changes
required"). Convergence: REWORK 8B/12M → 6B/9M/1m → 5B/8M → 2B/1M/1m →
APPROVE; disposition logs §14–§17. **READY TO BUILD** pending Shawn's two
§13 calls (retention numbers; retraction suppression list).
**Author:** Claude, 2026-07-26
**Depends on:** Consumer spine (LIVE), erasure (LIVE), People directory
(`docs/plans/admin-people-directory.md`, ready-to-build)
**⚠ Implementation checkout:** authored on a stale branch —
`AdminV2LeadProfile.jsx` + People-plan citations exist on `origin/main` only.
**Build from a fresh `origin/main` worktree.**

## 1. Goal

Per **consumer** (not per signup):

1. **An observation ledger** — typed, provenance-carrying observations
   accumulated across all signups ("2 children, ages ~5 and ~8", "divorced",
   "car owner", "prefers Mandarin", "ethnicity: Chinese").
2. **An AI-written persona summary** — generated only from validated
   structured claims (§6.4).
3. **A consumer score (0–100)** — deterministic, explainable; includes a
   **market-fit component** (current target: Chinese/Mandarin market;
   retargeting = config insert, §7.2). Named `consumerScore` everywhere
   (bare `score` = the per-prospect lead field, `Prospect.js:75`).

All AI inference self-hosted and $0: Ollama on Shawn's Mac, nightly batch
worker against authenticated backend endpoints.

**Surfacing (owner decision, Shawn 2026-07-26): person-level surfaces ONLY**
(`/AdminPeople` + person drill-in). Prospects surfaces get nothing.

### Non-goals (v1)

- No trained ML model; no real-time scoring; no customer-facing surface; no
  score-triggered automation.
- **No inbound-Retell (`call_bot`) enrichment** — reconciler deliberately
  null-links call_bot rows; `retell_analysis` source enum reserved, unused.
- No per-campaign scoring contexts (one global active segment config; v1.1).

## 2. Existing substrate (verified across rounds)

| Piece | Reality | Consequence |
|---|---|---|
| Identity spine | Reconciler **relinks prospects without locking consumers** (`consumerService.js:302-314`); unlinks call_bot; capture link nullable. | Prospect-anchored observations; relink-aware fence; relink bumps both consumers (§6.3, §9). |
| Capture txn | Managed txn `prospectService.js:888`; `Prospect.create` `:971-988`; commit by `:1107-1112`. | Map-job outbox joins `t` after create; drain post-commit. Confirmed feasible (R2). |
| `demographics` | Written by ordinary form capture (`:704-727`) and **staff-editable** (`:135-154`); staff PUT has **no body schema** (`routes/prospects.js:37`, 1 MB global cap). | Maps as `form` from a **minimized, capped snapshot** frozen at enqueue; edits mint a new source revision (§3.3, §5). |
| Journey | `getConsumerJourney` = derived fields only. | Dedicated DTOs. |
| Screening text | Flat `Agent:`/`User:` transcript per attempt (`retellScreeningService.js:662-676`), lands days late, multi-attempt; **no identity-confirmation marker**; event time from Retell's own timestamp (`:693`). | Per-artifact revision jobs; `User:`-turns slicing; timestamp skew clamp (§3.4). |
| Quiz | `scoredBy: 'server'` or `'client-unverified'`; **quiz config is cloned verbatim in the clamp today (`designConfigV2Clamp.js:386`) — `factKey` validation does NOT exist and is a new PR 1 deliverable** (§5). [R3 #13] | Server-scored only; save-time + map-time validation both new code. |
| Capture hook | Single callback owned by Redeem Ops. | Untouched; outbox instead. |
| Sweeps | `setInterval`, no guards; migration runner shows the advisory-lock wrapper (`runMigrations.js:22-32`); **runner executes `mod.up` on pool connections — migrations are NOT atomic by default**. | Session-lock sweep (§7.3); migration 089 wraps all DDL in its own explicit transaction + catalog guards (§3, §11). [R3 #12] |
| Erasure | Consumer-first lock (`erasureService.js:138-180`); scrub misses `screeningMetadata`/`screeningActiveCallId`. | PR 1 fixes; writers use the fence; **erasure also nulls enrichment job payloads of ALL statuses** (§9). [R3 #4] |
| Config home / flags / limiter / auth / People target | As v3: dedicated configs table; startup-mounted flag; global limiter 200/15 min before routes; sha256+timingSafeEqual; `?view=profile` on origin/main. | §6.2 limiter design revised [R3 #11]. |

## 3. Data model — migration `089-consumer-enrichment.js`

Five tables + erasure fix. **The migration opens one explicit transaction it
owns and runs every DDL statement on it** (the runner won't); every object is
additionally catalog-guarded so a re-run after partial failure is safe.
Models/associations/exports in PR 1; DDL must agree with `sync({force:true})`
test boot. [R3 #12]

### 3.1 `consumer_observations` (append-only, revisioned)

| Column | Notes |
|---|---|
| `id` UUID PK | |
| `sourceProspectId` FK prospects CASCADE / `consumerId` FK consumers CASCADE | Source-aware CHECK: manual ⇒ consumerId only; non-manual ⇒ sourceProspectId only **AND `sourceArtifactId`, `sourceRevisionId`, `sourceContentHash` all NOT NULL** (nullable identity columns can't guard uniqueness — multiple NULLs pass UNIQUE). [R3 #6] |
| `key`, `value`, `confidence`, `source`, `evidence`, `sourceEventAt` | As v3 (allowlist; per-key schema; negatives + `complete`; CHECK 0–1; rank enum; verified substring ≤ 300; artifact time). **`sourceEventAt` clamped to `now() + 24 h` server skew at insert** — a future-dated Retell timestamp must not hijack the fresh window. [R3 #8] |
| `sourceRevisionId` BIGINT | **The revision identity** — a monotonic per-artifact counter minted by the SOURCE mutation transaction (capture=1; each staff edit / screening attempt patch increments an `enrichmentRevision` counter stored beside the artifact). Content hash is NOT identity: A→B→A must produce revision 3, not collide with revision 1's rows (which stay superseded with their original event times). [R3 #3] |
| `sourceContentHash` | Integrity/audit only. |
| `pipeline`/`pipelineVersion` | **`pipelineVersion` is DEFINED as the composite semantic version** of its pipeline (prompt + taxonomy + code for extract; mapper code + taxonomy for map). One version string to compare, no separate taxonomy dimension in identities. [R3 #6] |
| `supersededAt`, `retractedAt`, `createdAt` | Supersession permanent; retraction independent. |

UNIQUE `(sourceArtifactId, sourceRevisionId, pipeline, pipelineVersion, key)`
partial (non-manual); `ON CONFLICT DO NOTHING`. **Revision activation
(gated + total):** under the fence (prospect row locked), activation first
validates `job.sourceRevisionId ==` the artifact's CURRENT
`enrichmentRevision` AND `job.pipelineVersion ==` the server's current
pipeline version — mismatch ⇒ job `stale`, nothing written (a late rev-1
completing after rev-2 activated can never insert). On acceptance it
supersedes **every** prior active row for that (artifact, pipeline) — any
revision, any pipelineVersion, including keys the new result omits — then
inserts the new rows. **Zero-claim results still activate** (supersede all,
insert none), so "current revision" never has to be inferred from surviving
rows. Re-runs of the same accepted revision are no-ops. [R4 #2]
Read path: UNION ALL (prospect-join + manual consumerId rows), excluding
superseded/retracted. Manual facts survive relinks, die on their consumer's
erasure.

### 3.2 `consumer_profiles`

As v3: summary ≤ 1200; profileJson (claim schema §6.4); consumerScore CHECK
0–100 NULL; scoreBreakdown; `scoredConfigVersion` (stamped even when NULL);
`scoringAlgorithmVersion`; `scoreInputHash`; **`inputVersion` BIGINT +
`syncedInputVersion`** (dirty ⇔ >); `profileInputHash`; modelVersion +
timestamps.

### 3.3 `enrichment_jobs`

| Column | Notes |
|---|---|
| `kind` ENUM(`map`,`extract`,`synthesize`), subjects, `sourceArtifactId`, `sourceRevisionId`, `sourceContentHash`, `inputHash`, `promptVersion`, `payload`, `pipelineVersion` (composite, enqueue-stamped), `status`, lease columns, `attempts`, `lastError` | Kind-aware CHECKs: each kind's identity columns NOT NULL, irrelevant ones NULL. [R3 #6] |

**Map payload = minimized snapshot:** only normalized taxonomy-relevant
fields (never contact data, free-text notes, or unrelated form fields),
serialized cap 8 KB (reject + log over-cap keys). Synthesis jobs carry **no
DTO payload** — the DTO is rebuilt at claim (§6.3). **Erasure nulls
`payload` + `lastError` on jobs of EVERY status** (done/dead/cancelled rows
survive 30 days for replay — their PII must not; prospects are scrubbed, not
deleted, so FK cascade never fires). [R3 #4]

Status enum gains `stale` (`pending`,`leased`,`done`,`stale`,`dead`,
`cancelled`). Kind-scoped partial UNIQUEs:
map `(kind, subjectProspectId, sourceRevisionId, pipelineVersion)` and
extract `(kind, subjectProspectId, sourceArtifactId, sourceRevisionId,
pipelineVersion)` — pending/leased/done participate (dead/cancelled/stale
don't);
synthesize `(kind, subjectConsumerId, inputHash, promptVersion)` —
**pending/leased ONLY**: a `done` synth job must never block re-enqueueing a
hash that recurs (profile flows A→B→A within the 30-day retention would
otherwise be stuck at B forever). Synth completion replay is validated by
job id + lease token, not the unique. Test: completed-A → completed-B →
A-again re-enqueues and converges. [R4 #1]

Claim SQL (CTE + `FOR UPDATE SKIP LOCKED`), 15-min leases,
`POST /jobs/renew`, atomic expiry reclaim (`attempts++`), retained lease
tokens: as v3. **Renewal during inference:** the worker runs a 5-minute
heartbeat timer WHILE the model call is in flight (not just between items —
one slow item can outlive the lease); renewal failure aborts the item and
its result is not submitted. [R3 #7]

### 3.4 `resolveCurrentFacts` — total comparator (fresh-scoped throughout) [R3 #8]

1. Candidates: non-superseded, non-retracted rows (activation §3.1
   guarantees only the current revision/pipeline's rows remain active — no
   "latest" inference from surviving rows is ever needed).
2. `newest` = max clamped `sourceEventAt`; **fresh set** = within 180 days of
   it. **Every subsequent step draws ONLY from the fresh set** — scalars,
   collection baselines, AND partials.
3. Scalar winner: max by `(rank, confidence, sourceEventAt, id)`.
4. Collections: baseline = fresh `complete:true` winner by the same tuple
   (`v:[]` = explicitly none). Partials: fresh, `sourceEventAt` after the
   baseline's, sorted by the total tuple, first-wins dedupe on
   `(birth_year_band, gender ?? 'unknown')`; baseline entries win dupes.
   Output ordering canonical: by `birth_year_band` then gender. No baseline ⇒
   deduped union of fresh partials.
5. Supersession permanent; retracting a superseding row revives nothing.

Property tests: total order, order-independence, fresh-boundary exact edge,
old-complete/new-partial, duplicate partials, future-dated clamp.

## 4. Fact taxonomy v1

Unchanged (v2 §4): allowlist + per-key schemas + normalizers +
`TAXONOMY_VERSION` (feeds composite pipeline versions); ethnicity only from
form/manual/explicit self-identification; `preferred_language` = **the
preferred contact language** (not demonstrated ability — defined for
entailment §6.4); engagement is telemetry, not observations.

## 5. Phase A — deterministic mapper

- Outbox map job inside capture `t` (after create, drain post-commit).
- **Snapshot:** minimized (§3.3), frozen at enqueue with
  `sourceRevisionId = 1`. Staff edits to mapped fields (the `updateProspect`
  choke point — new body-schema validation for those fields rides along)
  increment the prospect's enrichment revision + enqueue a new map job;
  activation supersedes old rows. Ordinary-capture `demographics` = `form`,
  confidence 1.0.
- **Quiz `factKey`:** save-time validation added to the campaign clamp
  (currently verbatim-clones quiz config — this is NEW code, PR 1);
  map-time re-validation skips + logs invalid pre-existing mappings.
  [R3 #13]
- Backfill = reconciliation sweep enqueuing map jobs at current
  `(pipelineVersion, sourceRevisionId)`, **run as a separately-invoked,
  observable backfill mode** (not silently inside the nightly sweep).
  [R3 #10]

## 6. Phase B — extraction + synthesis worker

### 6.1 Worker

As v3, plus the in-flight 5-min heartbeat (§3.3). Launchd ≥ 1 h after the
server sweep window.

### 6.2 API (claim / renew / complete / status)

As v3 (per-job SAVEPOINTs, deterministic per-job statuses, idempotent
replay, `User:`-turns slicing, hashed-key timingSafeEqual auth), with the
limiter redesigned: [R3 #11]

- The global limiter **fully exempts `/api/enrichment/*`** — middleware
  limits compose to the MINIMUM, so leaving the 200/15-min pre-route bucket
  in place would cap the worker no matter how generous the later one is
  (and let anyone sharing the worker's IP exhaust its budget). [R4 #3]
- The router mounts two local limiters instead: a **small IP-keyed bucket
  charged only to requests that FAIL auth** (invalid/unauthenticated traffic
  is bounded), and the **generous budget keyed on the constant worker-key
  ID** (sha256 prefix of the configured key — never the presented bearer
  string, which would let attackers mint unbounded keys and would write
  secrets into limiter storage). Test: bad keys hit the small cap; a valid
  worker sails past it.

### 6.3 Input versioning + synthesis binding [R3 #1, #2]

- `bumpEnrichmentInput(consumerId, tx)` = **UPSERT** on `consumer_profiles`
  (first-time consumers can't lose bumps). Choke points: revision
  activation, retraction, manual facts, consent events, WA delivery, draw
  entry/boost, screening verdict, spine relink (both consumers), **and
  prospect lifecycle mutations that feed the DTO/score — `leadStatus`,
  `conversionDate`, prospect delete** (staff-editable today,
  `prospectService.js:1474`). The DTO builder documents its exact field
  list; every listed field's writer bumps in the same transaction. [R3 #2]
- **Enqueue:** sweep locks the profile row, reads `inputVersion` V, builds
  the DTO, hashes H, inserts the synthesize job keyed by H.
- **Claim binding:** claim REBUILDS the DTO under the fence and compares its
  hash to `job.inputHash` — **the worker only ever receives a DTO whose hash
  equals the job's**; mismatch marks the job `stale` immediately. The output
  is therefore provably generated from the job's input, closing the A→B→A
  window at claim. [R3 #1]
- **Completion CAS:** lock profile row FOR UPDATE → read `inputVersion` V →
  rebuild DTO/hash → require hash `=== job.inputHash` → write outputs with a
  **conditional update `WHERE inputVersion = V`** (an engagement commit
  between rebuild and write fails the update → job `stale`). Sets
  `profileInputHash = job.inputHash`, `syncedInputVersion = V`. A→B→A race
  test required. [R3 #1, #2]

### 6.4 Output guards — entailment table, then prose [R3 #5]

`profileJson` claim types with **exact server-checked predicates**:

| Claim | Predicate |
|---|---|
| `dependants: {count: n, exact: bool}` | `exact:true` requires a resolved complete `family.children` baseline of size n (+ dependant parents if counted); partials-only resolution entails only `exact:false` (lower bound ≥ observed). |
| `lifeStage` enum | Derived table over resolved `family.marital_status` + children presence + `identity.birth_year_band` — server can compute it; the model's value must match the derivation (or `unknown`). |
| `languages` | = resolved `identity.preferred_language` (definition §4), verbatim. |
| `insuranceTriggers[]` | **Server-derived, not model-asserted:** deterministic rules over resolved `life_event.recent` + family/coverage facts produce the trigger labels; the model may only order and reference them. |
| `talkingAngles[]` | Schema-labeled `suggestions`; creative; rendered under "suggested angles"; outside all traceability promises. |

Prose step unchanged: summary generated ONLY from validated claims +
derived triggers; ≤ 1200 chars; lint. Untrusted-source framing + injection
fixtures unchanged.

## 7. Phase C — deterministic scoring

As v3 (§7.1 math: clamp/round-once, min-confidence for fact rules, telemetry
confidence 1.0, config-change ⇒ full recompute, scoreability rule, SGT
decay, `scoreInputHash`/`scoringAlgorithmVersion`/`scoredConfigVersion`
stamped even when NULL; §7.2 configs table + language-primary fit).

### 7.3 Sweep [R3 #9, #10]

Session-level `pg_try_advisory_lock` on a dedicated connection + `finally`
unlock; window re-check after acquisition. **`enrichment_sweep_runs` is a
fence, not a log:** UNIQUE `runDateSgt`, `status`
(`running`/`done`/`failed`), `ownerToken`, `heartbeatAt`, `finishedAt`,
`stats`. Takeover permitted only when `status='running'` AND `heartbeatAt`
stale > 30 min (new owner token; finalization updates are owner-token
fenced). A `failed` run may be retried within the same window; `done` ends
the date. **Repair scan is budgeted:** durable cursor on the runs row, fixed
row + wall-time budget per night, rotating through the population across
runs; lag/coverage counters in `stats` (and `/status`). Initial backfill =
the separate mode (§5), never the nightly budget.

## 8. Phase D — admin surfacing (People only — NOT Prospects)

Unchanged from v3. `/AdminPeople` sortable `consumerScore` (NULL = "—");
person drill-in (`?view=profile`, origin/main) gets score chip + breakdown +
completeness, summary card, observations panel + retraction, suggested
angles under their own header. PR 3 stacks on the People build, fresh
worktree.

## 9. Erasure, consent, retention

As v3 (screeningMetadata scrub fix; cascade deletes observations + profile
row + cancels jobs; retrying owner-recheck fence, relink writer lock order;
eligibility; v1 retraction), **with the retention set REPLACED by owner
decision (Shawn 2026-07-26): customer data is kept FOREVER** — no TTLs on
observations (active/superseded/retracted), evidence, or screening
transcripts; erasure-on-request stays the sole deletion path for personal
data. The only surviving prune is queue hygiene: `done`/`dead`/`cancelled`
**jobs** (plumbing; payloads minimized) after 30 days, lease tokens living
that long for replay [supersedes the R2 #15 TTLs] — **plus:** erasure nulls `payload` +
`lastError` on enrichment jobs of every status addressed **either** by
`subjectConsumerId = :consumerId` **or** by prospect/artifact subjects
belonging to the erased consumer — synth jobs are consumer-subject, not
prospect-subject, and their `lastError` can carry validation/model-output
text (test covers it) (§3.3). [R3 #4, R4 #4]

## 10. Failure modes

V3 set, plus: A→B→A staff edits mint revision 3 (never collide with
revision 1); claim-time DTO binding closes the stale-generation window;
conditional-version write closes the stamp race; single-item model overruns
survive via in-flight heartbeat; over-cap snapshots rejected at enqueue with
named keys logged; sweep crash → stale-heartbeat takeover; unauthenticated
enrichment traffic rate-limited pre-auth.

## 11. Rollout

1. **PR 0 (upstream — the real bottleneck, §18 A1). Owner decision
   2026-07-26: a per-campaign "profile questions" block in the Campaign
   Studio designer** (doesn't exist yet — new Studio feature, spec to
   follow as its own plan). Admin slides selected questions from a FIXED
   question library into a campaign's signup funnel; answers are structured
   choices (never free text) that map deterministically to taxonomy keys.
   Shawn's launch set: annual income range (`finance.annual_income_band` —
   new key), "Do you have a pet?" (`household.pets`), "Do you have
   children?" (`family.children`, partial), expected retirement age
   (`finance.retirement_age_band` — new key), + language preference
   (`identity.preferred_language`). Without this the pipeline automates an
   empty pipe (prod 2026-07-26: taxonomy coverage of existing data = ONE
   key, `birth_year_band`).
2. **PR 1** — migration 089 (owned-transaction DDL + catalog guards), models,
   taxonomy, resolver, mapper + outbox + revision counters (home:
   `prospects.enrichmentRevision` for the form artifact; per-attempt token
   counter for screening) + staff-edit choke point + quiz factKey save/map
   validation, fence helper, relink bump, erasure cascade (+ job-payload
   nulling), tests. Dark. Ship soon regardless of volume — carries the live
   screeningMetadata erasure fix.
3. **PR 2** — routes (claim/renew/complete/status + two-stage limiter),
   worker + launchd, scoring + aggregator + configs, sweep + runs fence +
   backfill mode. Flag off. **Volume gate:** build when ≥50 transcript
   artifacts exist OR PR 0 questions are live and flowing. v1 QA loop =
   review EVERY LLM-extracted fact weekly (feasible for months at current
   volume), not spot-checks.
4. **PR 3** — People UI (People directory is LIVE since 07-26 — extends the
   live `/api/consumers` endpoint; fresh origin/main worktree). **Density
   gate for the score column:** median scoreable consumer has ≥2 assessed
   components; facts panel + summary can ship ahead of the score. Breakdown
   leads the UI; the number follows. Shawn calibrates scoring-config v1
   against his own closing intuition before agents see it (§18 A3).
5. Flip flag (restart), backfill mode, first full run, review, announce.

Preconditions: install Ollama + pull the model on the Mac (M5 Pro/48 GB —
verified ample, 2026-07-26); `pmset` wake schedule or accept
queue-tolerated skipped nights.

Env unchanged.

## 12. Testing

V3 list, plus: A→B→A revision tests (incl. omitted keys + event times);
claim-time DTO-hash mismatch → stale; completion conditional-version race;
bump-upsert on first-time consumer; leadStatus-edit bumps; entailment
predicate table (exact vs lower-bound dependants, lifeStage derivation
match, server-derived triggers); snapshot minimization + cap; erasure nulls
done-job payloads; sweep takeover on stale heartbeat + owner-token fencing;
repair-scan budget + cursor resume; fresh-scoped collection edges (§3.4);
synth A→B→A re-enqueue convergence; rev2-before-rev1 rejected as stale;
same-revision pipeline upgrade supersedes omitted keys; zero-claim
activation; bad keys hit the small IP cap while a valid worker exceeds it;
synth-job `lastError` nulled on erasure.

## 13. Questions

**Resolved:** failed-screening extraction; children array + complete flag;
nightly cadence; evidence = observation lifetime; `preferred_language`
definition; triggers server-derived.
**Open for Shawn before PR 1:** retention numbers (24 mo / 12 mo);
retraction suppression list (v1 ships without); **PR 0 question set** —
which fact-bearing questions go into which funnels (language toggle is the
no-brainer; income/family asks trade conversion for data — Shawn's call
per funnel).

## 14. Codex round 1 — REWORK (8B/12M), all 20 adopted/adapted

Inlined as [R1 #n]; full log in git history (v2).

## 15. Codex round 2 — REWORK (6B/9M/1m), all adopted

Inlined as [R2 #n]; full log in git history (v3). Architecture + capture
outbox confirmed feasible.

## 16. Codex round 3 — REWORK (5B/8M), all adopted

| # | Finding | Disposition |
|---|---|---|
| 1 | CAS doesn't bind output to the DTO that produced it (A→B→A at claim/complete) | **Adopted** — claim rebuilds DTO under the fence and only hands it out if hash = job.inputHash; completion re-verifies + conditional write (§6.3). |
| 2 | inputVersion stamp race; bump list missing prospect lifecycle fields; non-upsert bump | **Adopted** — profile-row lock + `WHERE inputVersion = V` write; bump = upsert; DTO field list enumerated with leadStatus/conversion/delete choke points (§6.3). |
| 3 | Content hash isn't revision identity under A→B→A | **Adopted** — monotonic `sourceRevisionId` minted by source mutation txns; content hash demoted to integrity (§3.1, §3.3). |
| 4 | Map-payload PII survives erasure; snapshot unbounded | **Adopted** — minimized snapshot, 8 KB cap; erasure nulls payloads of ALL job statuses; synthesis jobs carry no DTO (§3.3, §9). |
| 5 | Entailment not implementable from stated claim types | **Adopted** — per-claim predicate table; exact counts need complete baselines else lower-bound; lifeStage server-derivable; triggers server-derived; languages defined (§6.4). |
| 6 | Partial uniques undermined by NULLs / missing version dims | **Adopted** — kind/source-aware NOT-NULL CHECKs; `pipelineVersion` defined as the composite semantic version (§3.1, §3.3). |
| 7 | Renewal doesn't cover a single slow item | **Adopted** — in-flight 5-min heartbeat; renewal failure aborts the item (§3.3). |
| 8 | Collection resolution not fresh-scoped/total; future-dated timestamps | **Adopted** — fresh-scoped everywhere, tuple-sorted first-wins partials, canonical ordering, 24 h skew clamp (§3.4). |
| 9 | Sweep-runs row isn't a fence | **Adopted** — unique runDateSgt + status + ownerToken + heartbeat + stale takeover (§7.3). |
| 10 | Repair scan unbounded | **Adopted** — durable cursor + row/time budget + rotation; backfill = separate mode (§7.3, §5). |
| 11 | Limiter carve-out leaves invalid creds unlimited / raw-token keying | **Adopted** — pre-auth IP bucket stays; post-auth generous limiter keyed on constant key ID (§6.2). |
| 12 | Migration runner isn't atomic | **Adopted** — migration owns one explicit transaction for all DDL + catalog guards (§3, §11). |
| 13 | Quiz factKey save-validation doesn't exist in repo | **Adopted** — reclassified as NEW PR 1 deliverable in the clamp; invalid legacy configs logged + skipped (§2, §5). |

## 17. Codex round 4 — REWORK (2B/1M/1m), all adopted

All five R3 blockers verified closed; "no other wrong-behavior findings";
no architectural reopening. The four residuals:

| # | Finding | Disposition |
|---|---|---|
| 1 | Done synth jobs block A→B→A re-enqueue (unique includes done, 30-day retention) | **Adopted** — synth unique restricted to pending/leased; replay validated by job id + lease token; `stale` added to status enum (§3.3). |
| 2 | Revision activation not monotonic / pipeline-replacement-safe; zero-claim results leave no "latest" trace | **Adopted** — activation gated on artifact-current revision + server-current pipeline (else stale); supersede-all-prior incl. same-revision older-pipeline rows; zero-claim results activate (§3.1, §3.4). |
| 3 | Pre-auth global limiter composes to the minimum — worker capped at 200/15 min anyway | **Adopted** — full global exemption; route-local failed-auth IP bucket + worker-key-ID budget (§6.2). |
| 4 | Erasure job scope ambiguous — synth jobs are consumer-subject; lastError carries text | **Adopted** — both subject addressings, every status, lastError included (§9). |

## 18. Claude adversarial review (Fable 5, 2026-07-26) — product/ops axes Codex was scoped away from

Protocol machinery accepted as-is (5-round Codex convergence stands).
Verdict on the product layer: **APPROVE-WITH-CHANGES** — all folded into §11.

Grounding data (prod, 2026-07-26): 129 consumers, 6 repeat signups (0 with
3+), 2 screening transcripts, 0 quiz submissions, `demographics` = exactly
`{dateOfBirth, age}` on 134/137 prospects.

| # | Finding | Resolution |
|---|---|---|
| A1 | **Score inputs are never collected.** Market fit reads `preferred_language`/`ethnicity`; NO live funnel captures either (nor income/marital/children/property). Taxonomy coverage of existing data = 1 of 18 keys. Built as-specced, ~all 129 consumers score NULL and summaries are husks. | **PR 0 added** (§11): fact-bearing questions into live funnels — the actual bottleneck is upstream collection, not downstream plumbing. "Form locale" removed as a language source (doesn't exist on redeem.sg). |
| A2 | No volume gates — worker/queue infra could ship against 2 artifacts. | Volume gate on PR 2 (≥50 artifacts or PR 0 live), density gate on PR 3's score column; PR 1 ships early regardless (carries the erasure fix). |
| A3 | Invented weights + 4 outcome labels = authoritative-looking astrology; risk of steering agent effort wrongly. | Breakdown-first UI; Shawn calibrates config v1 (he IS ground truth at this scale); score-vs-outcome logging from day one. |
| A4 | Ollama not installed; lid-closed Mac runs nothing at 4 a.m.; no fact-precision gate before agent exposure. | Preconditions block in §11; queue tolerates skipped nights by design (credit); v1 QA = review ALL extracted facts weekly while volume permits. |
| A5 | Pins: revision-counter home unstated; `User:` line-slicing may drop multi-line turns; People endpoint now LIVE (#278/#279). | Counter homes named in §11 PR 1; slice on prefix boundaries not lines; PR 3 language updated. |
