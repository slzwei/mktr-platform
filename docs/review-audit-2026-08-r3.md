# .review round-3 remediation — final record (Aug 2026)

The `.review/` dashboard tracked the 17-task queue from the **third** review of
this repo (2026-08-02), run after the first (45-task) and second (32-task)
audits closed. **All 17 tasks are resolved.** This document is the exported
final state — written immediately before the scaffolding was deleted, since the
dashboard was only ever the interface to this record.

Every task shipped as its own CI-gated PR, squash-merged: **#403–#418**
(2026-08-03, autonomous run). One sanctioned bundle: **H1+H5** rode a single PR
(#403) because both restructure the same transaction boundary in
`campaignService` — fixing them separately would have rewritten the same lines
twice. Everything else was one task = one PR, serial, each branched off
freshly-merged main.

Statuses: every task `done` = defect confirmed live at the cited code before
editing, fix verified against the real mechanism, regression test proven to
**fail before and pass after** (pre-fix output captured by temporarily
restoring the origin/main source — never `git stash`; this is a shared
checkout), CI green, merged to main. **Nothing was blocked, skipped, or
refuted** — all 17 reviewer claims reproduced exactly as described (two with
line numbers drifted by the P3-3/P4-4 refactors, mechanisms intact).

## The tasks

### High

- **H1 — Draw rail commits before the campaign activation save** — `done`,
  PR #403. Pre-fix: a slug-conflict 409 on the arming PUT left a committed
  activation + allocated stock on an inactive campaign (`Activation.count = 1`,
  expected 0). `ensureDrawBoostRail` now joins the caller's transaction;
  `updateCampaign` and `setCampaignLaunchState` commit rail + campaign write as
  one unit, advisory lock held to the caller's commit.
- **H5 — Campaign writes and agent-assignment writes commit independently** —
  `done`, PR #403 (bundled with H1: same transaction boundary, stated in the
  PR). Pre-fix: POST with a ghost `assigned_agents` UUID committed the campaign
  then 500ed on the join-table FK (orphan row); PUT committed the rename before
  the assignment write failed. Ids now resolve to real users (422 with the
  offending ids; newly-added agents must be active, retained ones may stay
  through deactivation), and create/update + assignment sync share one
  transaction.
- **H2 — Partner onboarding endpoints bypass row-level ownership** — `done`,
  PR #404. Pre-fix: cross-owner GET/PATCH/lazy-seed all returned 200 (an
  outreach_exec could read and rewrite another owner's checklist), ghost
  partner/assignee ids 500ed, and any user id was accepted as assignee. Both
  endpoints now load the parent and apply `canActOnPartnerRow`; the lazy seed
  sits behind the gate; `assigneeUserId` must be an active Redeem Ops
  principal.
- **H3 — Concurrent demographic edits collapse to one enrichment revision** —
  `done`, PR #405. Pre-fix: all 6 concurrency rounds collapsed to
  `enrichmentRevision = 2` (stale-instance increment + `ON CONFLICT DO
  NOTHING` kept one payload — potentially the loser's). The edit now writes
  fields, a column-relative `UPDATE … RETURNING` bump, the snapshot built from
  the returned row, and the outbox insert in one transaction.
- **H4 — Unassigned leads can be marked won; assignment races the precheck** —
  `done`, PR #406. Pre-fix: an unassigned lead (null agent, null external)
  returned 200 and persisted `won`; the deterministic race test (unassignment
  injected between read and write) resolved and left a won-and-unassigned row.
  The precheck rejects null assignees (external mktr-leads assignees count),
  and the transition is a conditional UPDATE whose WHERE re-checks assignment
  under the row lock — zero affected rows = 400, hook never fires.

### Medium

- **M1 — Two independent QR lifecycle fields make deactivation ineffective** —
  `done`, PR #407. Pre-fix: bulk deactivate/archive left `active = true` (the
  printed QR stayed publicly resolvable after a successful deactivation);
  PUT `{active:false}` left `status = 'active'` (the authenticated scan path
  stayed open). `status` is canonical, `active` a dual-written mirror;
  migration 106 reconciles drifted rows (deactivation intent wins) and adds
  `CHECK ck_qr_tags_lifecycle_coherent`.
- **M2 — QR dedup checks only the most recent scanner and races** — `done`,
  PR #408. Pre-fix: A-B-A within the window counted A unique twice; 4
  concurrent same-client scans were all unique. The window query is scoped to
  `(qrTagId, ipHash, ua)`, claimed under a per-(tag, scanner) advisory xact
  lock, scan row + counters in one transaction; migration 107 adds the
  supporting index.
- **M3 — Authenticated QR scan endpoint permits cross-owner tampering** —
  `done`, PR #409. Pre-fix: an agent's POST on an admin-owned tag returned 200
  and moved the counter. Retired outright (the task's first option): it
  duplicated the public tracker path and no frontend surface ever called it —
  route, controller, service function, dead client method and their tests all
  removed.
- **M4 — Inventory reconciliation ignores redemption reversals** — `done`,
  PR #410 (shipped alone — money invariant). Pre-fix: every legitimate
  agent-handover reversal became permanent reported drift (derived 1 vs actual
  0). `redeemedQuantity` now derives as `sum(redeemed) − sum(redeem_reversed)`;
  nothing persisted to back-check — the drift lived only in derived output and
  clears on the next sweep. The real-corruption alarm keeps its teeth
  (control test).
- **M5 — Webhook subscriber deletion vs NOT NULL delivery history** — `done`,
  PR #411. Pre-fix: deleting a used subscriber rejected with the exact
  `null value in column "subscriberId" violates not-null constraint` (SET NULL
  FK vs NOT NULL column). One policy now: history survives — column nullable,
  migration 108 re-asserts the SET NULL FK; listings LEFT JOIN and retry
  rejects cleanly on an orphaned delivery.
- **M6 — Screening alert throttle duplicates under concurrency** — `done`,
  PR #412. Pre-fix: 4 concurrent sweep calls sent 4 ops emails (the loser's
  caught unique error was discarded and execution fell through). Both the
  24h email window and the once-per-lead activity are now one atomic
  `INSERT … ON CONFLICT (scope,key) DO UPDATE … WHERE expired … RETURNING`
  claim — exactly one winner, including the expired-row revive.
- **M7 — Concurrent contact creation leaves multiple primaries** — `done`,
  PR #413. Pre-fix: the concurrent make-primary race left 2 live primaries and
  a raw second primary was storable. Parent-row lock around the demote+set
  pair + partial unique index `uq_pc_one_live_primary` (migration 109, newest
  primary wins the reconciliation — the older row is exactly what cadence was
  mis-selecting).
- **M8 — DOB age gate uses server-local calendar** — `done`, PR #414.
  Pre-fix: `'15/06/1990'` and `'2012-02-31'` both created leads (201, gate
  silently skipped, no age stored); on a UTC host a birthday starting at
  00:00 SGT stayed underage until 08:00 SGT (pinned deterministically in the
  unit test: `sgtAgeFromDob` says 21 where the old local math says 20).
  Strict `YYYY-MM-DD` at the Joi door, `cleanYmd` real-calendar validation,
  SGT tuple comparison, canonical string stored.
- **M9 — Round-robin queue cleanup can never remove campaigns** — `done`,
  PR #415. Pre-fix: the map stored `chain.catch(...)` while cleanup compared
  `chain` — identity always false, the map grew monotonically (1, 2, 3, 4 in
  the test). The stored tail is now the exact compared object; success and
  failure paths drain to empty; serialization and failure-recovery preserved.
- **M10 — Broadcast recipient freezing omits members on page shift** — `done`,
  PR #416. Pre-fix: the scripted shift froze 200/201 recipients with the moved
  consumer silently omitted forever. The freeze now walks
  `enumerateCohortMembers` — keyset over the immutable consumer id — inside
  one REPEATABLE READ transaction; the admin pager keeps its display order.
- **M11 — Hard-deleting a user cascades away paid discovery history** —
  `done`, PR #417. Pre-fix: `permanentlyDeleteUser` CASCADE-erased the run
  (provider run id, costs, raw results) and its candidates. `createdBy` is
  nullable + SET NULL (migration 110), with `createdByEmail` as the immutable
  creator snapshot, backfilled and stamped at run creation.
- **M12 — `/health/metrics` publishes lead volume to anyone** — `done`,
  PR #418. Pre-fix (live in production): anonymous and non-admin requests both
  received the full counter snapshot — lead volume by channel, unserviceable
  leads, delivery reliability. The endpoint now requires an admin JWT
  (`authenticateToken` + `requireAdmin`); plain `/health` stays open for
  Render health checks.

## How each fix was proven

The standard for every task: confirm the defect live at the cited code first,
then a regression test that fails on the pre-fix code — captured by restoring
the origin/main (or pre-fix branch HEAD) source into the working tree, running
the new test, and recording the failing output — and passes after. Race
conditions were made deterministic wherever a seam allowed (the H4
`getSystemAgentId` injection; M6/M2/M7's real-Postgres concurrency waves with
locked claims asserting exact winner counts). The full unit tier ran before
every push; DB-backed and migration suites ran against a real local Postgres;
CI (unit + integration + migration tiers, lint, frontend, E2E smoke) gated
every merge.

Two suites (`redeemOpsRewards`, `emailBroadcastService`) hang locally at the
transport level — a known pre-existing flake family; their coverage ran
authoritatively in CI, and the new tests for those areas also pass in
isolation locally.
