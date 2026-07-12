# Redeem Ops — Outreach Cadences (sequencing engine)

**Status:** v2 DRAFT — revised after Codex review (gpt-5.6-sol xhigh, 2026-07-12, verdict RETHINK
on v1; all 4 blockers verified against code and addressed below). Not yet built.
**Depends on:** Redeem Ops Phases 1–7 (live), Discover (live). Migrations through 056 applied.

## 1. Problem

Discover fills the top of the funnel at machine scale, but every follow-up `outreach_tasks` row
is created by hand — nothing outside `taskService` writes one. Today's only automation is the
stale sweep (flags at >48h no first outreach / >14d inactivity): it detects neglect instead of
preventing it. A **cadence** (Outreach.io "sequence") fixes this: an ordered step template a
partner is *enrolled* into; the engine materializes the next task at the right time; completing
a task with a **disposition** advances/branches; replies and stage changes exit automatically.

Deviations from Outreach: channels are call/WhatsApp/IG/visit-first (SG F&B merchants); email is
a support touch; **all steps are manual tasks in v1** (no auto-send).

## 2. Goals / non-goals

**Goals (P1):** versioned cadence definitions (seeded, no builder UI), enrollment lifecycle with
per-owner capacity cap, linearizable advance-on-disposition, automatic exits/pauses wired into
existing choke points, tasks in the existing queue/tasks surfaces via one shared component.

**Non-goals (P1):** auto-send anything, mailbox sync/reply detection, builder UI, A/B tests,
open/click tracking, per-step analytics, automatic pipeline-stage movement.

## 3. Phase 0 — transaction-primitive refactor (prerequisite PR, pure refactor)

Codex-verified: the promised atomic completion **cannot be composed from today's services** —
`taskService.updateTask` reads via `findByPk` outside any transaction then opens its own
(`taskService.js:117,146`); `partnerService.logActivity` likewise (`partnerService.js:496,508`);
`recomputeNextTaskAt` reads the MIN with no partner lock (`taskService.js:31`). Before any cadence
code:

- Extract caller-transaction primitives, keeping public signatures behavior-identical:
  `completeTaskTx(task, disposition-free updates, user, t)`, `logActivityTx(partner, body, user, t, opts)`,
  `recomputeNextTaskAtTx(partnerId, t)` (recompute once, after all task writes, partner row locked),
  `changeStageTx(partner, toStage, user, t, …)`, `resumeSnoozeTx/pauseTx` equivalents.
- All reads that feed decisions move inside the transaction with `FOR UPDATE` on the row.
- `logActivityTx` gains `opts.suppressCadenceHooks` (recursion guard: the activity a cadence
  completion writes must not re-enter the cadence engine).
- Cadence hooks are **dependency-inverted**: services expose `registerCadenceHooks({onInboundActivity,
  onStageChange, onSnooze, onUnsnooze, onRelease, onReassign, onMergeDuplicate, onArchive})`, wired in
  `bootstrap.js` (house precedent: the Phase-6 fulfilment capture hook composition root). No
  circular imports; hooks run **inside the owning transaction**.
- Ship as its own PR with tests proving no behavior change.

## 4. Data model (migration 057 — schema ONLY, per-column guards + `IF NOT EXISTS` indexes; NO seed)

### 4.1 `outreach_cadences` — a row is one immutable VERSION
```
id UUID PK; key STRING(64) NOT NULL;        -- immutable machine key, e.g. 'fnb_call_first'
version INTEGER NOT NULL;                    -- UNIQUE (key, version)
name STRING(120) NOT NULL;                   -- display only, never an identifier
description TEXT; targetCategory STRING(64) NULL;
isActive BOOLEAN NOT NULL default true;      -- retired versions: false (never delete)
createdBy UUID NOT NULL FK users RESTRICT; timestamps.
```
Editing a definition = insert version n+1, retire n. Live enrollments keep their frozen version.
`targetCategory` must be added to `categoryService` rename/merge cascades (it's a 4th consumer).

### 4.2 `outreach_cadence_steps`
```
id UUID PK; cadenceId UUID NOT NULL FK RESTRICT;
stepOrder INTEGER NOT NULL CHECK >= 1;       -- display ordering; UNIQUE (cadenceId, stepOrder)
channel STRING(24) NOT NULL;                 -- call | whatsapp | email | instagram_dm | visit | custom
mode STRING(12) NOT NULL default 'manual';   -- 'auto' reserved (P3, email only)
title STRING(160) NOT NULL; scriptTemplate TEXT;
priority STRING(12) NOT NULL default 'medium';
```

### 4.3 `outreach_cadence_transitions` — explicit edges (replaces v1's conditional-skip)
```
id UUID PK; cadenceId UUID NOT NULL FK RESTRICT;
fromStepId UUID NULL FK steps RESTRICT;      -- NULL = entry edge (enrollment start)
disposition STRING(24) NOT NULL;             -- or '*' default edge
toStepId UUID NULL FK steps RESTRICT;        -- NULL = finish (state completed)
terminalAction STRING(24) NULL;              -- exit_not_interested | finish | NULL
delayDays INTEGER NOT NULL default 0 CHECK >= 0;  -- AFTER the from-step's completion
timeWindow STRING(16) NOT NULL default 'any';     -- any | morning | afternoon | off_peak
UNIQUE (fromStepId, disposition)
```
Resolution: exact `(fromStepId, disposition)` edge, else `(fromStepId,'*')`, else finish. Branch
context is carried by the edge itself — no lost-disposition problem, branch-specific delays are
free, and the D0/D2 arithmetic ambiguity from v1 is gone (delays live on edges, always relative
to the previous completion; the seeded gaps below are edge delays, not absolute day numbers).

### 4.4 `outreach_cadence_enrollments`
```
id UUID PK; cadenceId UUID NOT NULL FK RESTRICT;   -- frozen version row
partnerOrganisationId UUID NOT NULL FK CASCADE;
state STRING(16) NOT NULL default 'active';        -- active | paused | completed | exited
currentStepId UUID NULL FK steps RESTRICT;
lastDisposition STRING(24) NULL;
exitReason STRING(32) NULL;   -- replied | stage_advanced | lost | not_interested | released |
                              -- archived | merged | manual_stop | finished
enrolledBy UUID NOT NULL FK users RESTRICT; pausedAt/endedAt DATE NULL; timestamps.
PARTIAL UNIQUE INDEX (partnerOrganisationId) WHERE state IN ('active','paused')
INDEX (state, updatedAt)
```

### 4.5 `outreach_tasks` additions (+ integrity)
```
cadenceEnrollmentId UUID NULL FK RESTRICT; cadenceStepId UUID NULL FK RESTRICT;
snapshotRecipient STRING(160) NULL;          -- resolved phone/email/handle/address at materialization
-- scriptTemplate renders INTO description at materialization (frozen snapshot)
CHECK ((cadenceEnrollmentId IS NULL) = (cadenceStepId IS NULL))
PARTIAL UNIQUE INDEX (cadenceEnrollmentId) WHERE status IN ('open','in_progress')
```
Service-enforced (tested, not DB-checked): step belongs to enrollment's cadence; task partner ==
enrollment partner. FKs are RESTRICT so history survives definition retirement.

### 4.6 `outreach_suppressions` (compliance, minimal P1)
```
id UUID PK; channel STRING(24) NOT NULL;     -- call | whatsapp | email | any
value STRING(160) NOT NULL;                  -- normalized phone/email
reason STRING(32) NOT NULL;                  -- opt_out | dnc_listed | bounced | complaint
source STRING(32); expiresAt DATE NULL; timestamps. UNIQUE (channel, value)
```
Materialization gate: recipient in suppressions → step outcome `blocked` (skip + audit + owner
notified). Applies to manual steps too. PDPC's B2B exclusion is purpose-based, not line-type-based;
when `DNC_API_ENABLED` flips, call/whatsapp materialization runs `dncGate` and records
result + checkedAt on the task snapshot. Until then: suppressions + honest badge.

### 4.7 Constants (constants.js, exposed via `publicConstants`)
`CADENCE_CHANNELS`, `CADENCE_ENROLLMENT_STATES`, `CADENCE_EXIT_REASONS`, `CADENCE_TIME_WINDOWS`,
and an exhaustive **per-channel disposition matrix** (no global list — call+`sent` is nonsense):
```
CHANNEL_DISPOSITIONS = {
  call:         ['connected','no_answer','not_interested','replied'],
  whatsapp:     ['sent','replied','not_interested'],
  email:        ['sent','replied','not_interested'],
  instagram_dm: ['sent','replied','not_interested'],
  visit:        ['met','closed','not_interested'],
  custom:       ['done','not_interested'],
}
ACTIVITY_TYPES += 'visit' (also MEANINGFUL_ACTIVITY_TYPES)  -- Codex Q3: agreed
```

## 5. Engine semantics (`makeCadenceService(overrides={})` — house factory style)

### 5.1 Enroll — with capacity cap (P1, Codex Q7: agreed)
Preconditions inside one transaction: partner live + **owned** (or actor manager), no live
enrollment (partial-unique backstops the check), owner's active-enrollment count < cap
(default 60; manager override flag audited) counted under lock. Resolve the entry edge,
**materialize the first task synchronously**, audit. Enrollment requires an owner because tasks
require an assignee — see §7 for the Discover/pool implication.

### 5.2 Completion — the linearizable core
Dedicated endpoint `POST /api/redeem-ops/cadence-tasks/:taskId/complete { disposition, alsoMarkLost? }`.
One transaction, one lock order everywhere (**enrollment → partner → task**):
1. `SELECT enrollment FOR UPDATE`; require `state='active'` and `currentStepId == task.cadenceStepId`.
2. `SELECT partner FOR UPDATE` (live check). 3. Complete task with a status predicate
   (`UPDATE … WHERE status IN ('open','in_progress')`); 0 rows → replay: return the recorded
   result (idempotent) or 409.
4. Validate disposition against `CHANNEL_DISPOSITIONS[step.channel]`.
5. `logActivityTx(…, {suppressCadenceHooks:true})` with an **honest** mapping: call+connected →
   `call_connected`; call+no_answer → `call_attempt`; sent → channel's `*_sent`/`instagram_dm`;
   visit+met → `visit`; replied → channel's `*_reply` (direction inbound); **not_interested →
   the channel-truthful outbound type** (e.g. `call_connected`, summary "Not interested") — never
   a fake `follow_up` (v1 would have stamped `firstOutreachAt` dishonestly).
6. Terminal handling: `not_interested` → exit(not_interested); if `alsoMarkLost` (UI confirm
   dialog) → `changeStageTx(LOST, lostReason='not_interested')` in the SAME transaction — no
   contradictory half-state. `replied` → exit(replied) + UI one-click stage suggestion
   (no auto stage move — Codex Q5: agreed, activity logging never moves stages in this codebase).
7. Otherwise resolve edge → materialize next task; `recomputeNextTaskAtTx` once at the end.

### 5.3 Materialization (used by enroll/advance/resume/reconcile)
- **Channel prerequisites**: resolve recipient (call/whatsapp → contact mobile else org
  `primaryPhone`; email → contact email else `primaryEmail`; instagram_dm → handle; visit →
  active location). Missing or suppressed → outcome `blocked`: skip via the step's `'*'` edge,
  audit, notify owner. Snapshot resolved recipient + rendered script onto the task (allowlisted
  plain-text merge engine; unresolved placeholder ⇒ blocked, never a template leaked to a card).
- **Scheduling**: `dueAt = previous completion + delayDays`, clamped into the SGT `timeWindow`
  (new `sgtWindowClamp` helper — `sgtDayWindow` only yields day bounds). If the window already
  passed today, **roll forward to the next allowed day** (never due-in-the-past). No weekend
  skip for F&B cadences (merchants trade weekends); `off_peak` = 15:00–17:00 SGT.
- Assignee = partner owner at materialization time.

### 5.4 Exits & pauses — hooks INSIDE owning transactions (composition-root registered)
| Trigger (Tx hook) | Effect on live enrollment |
|---|---|
| inbound meaningful activity (not suppressed) | exit(replied); cancel open cadence task |
| `changeStageTx` → MEETING/PROPOSAL/PARTNERED | exit(stage_advanced) |
| `changeStageTx` → LOST | exit(lost) |
| partner snooze | pause (+ cancel open cadence task). **Snooze ⇒ cadence pause, but cadence "Pause" ≠ snooze** — pausing a cadence must not flip global partner availability (Codex #10: agreed; UI copy states the difference) |
| unsnooze (manual) | resume via `resumeTx`: re-materialize current step, anchor = resume time |
| **sweep snooze-wake** | the sweep's raw-SQL wake (`staleSweep.js:51`) bypasses services — it must `RETURNING id` and invoke `resumeTx` per woken partner (or mark enrollments `wake_pending` for the reconciler). Verified gap; without this, paused cadences never resume |
| release | exit(released) |
| reassign | keep enrollment; reassign the open cadence task in the same tx |
| merge | **exit/cancel the duplicate's enrollment BEFORE task repointing** (else survivor gets tasks pointing at a foreign enrollment and a partial-unique collision); survivor's enrollment wins |
| archive / hard delete | exit(archived) / cascade per existing delete semantics |
All exits cancel the open cadence task and write an audit event in the same transaction.

### 5.5 Generic task APIs must not bypass the engine (verified blocker)
`taskService.updateTask` currently lets assignee OR **creator** flip status/reassign/edit
(`taskService.js:117-131`), and TasksPage exposes Complete/Cancel/Reopen/Edit. Rules:
- On cadence tasks, generic PATCH may edit only `description`/`priority`. Status changes,
  `dueAt`, `assigneeUserId`, and provenance fields → 409 pointing at the disposition endpoint
  (manager reassign goes through the reassign hook). Reopen is never valid on a cadence task.
- Cancel = "stop cadence" only (explicit endpoint, records manual_stop).
- Both MyQueue and TasksPage render the shared cadence card (§8) — not just MyQueue.

### 5.6 Reconciliation tick (small, safe)
In-process on the bootstrap interval, but: `pg_try_advisory_lock` + re-entrancy guard (the
existing bare `setInterval` sweeps can overlap — verified), `FOR UPDATE SKIP LOCKED` row claims.
Scope: (a) active enrollments with no open cadence task NOT caused by a deliberate stop
(cancellation writes reason+generation, reconciler skips those); (b) `wake_pending` resumes;
(c) P3 auto-sends. Log counters: orphans repaired, duplicates prevented, failed advances, due
backlog. Nothing else — normal advance stays synchronous.

## 6. Email steps

**P1 (manual):** email step = task whose card shows the rendered snapshot ([Copy] + `mailto:`).
Rep sends from their own Zoho mailbox, taps `sent`. Reply arrives in their real inbox; logging
the inbound activity exits the cadence.
**P3 (auto, `REDEEM_OPS_CADENCE_AUTOSEND`):** verified: the current mailer cannot carry this —
single cached transporter, no reply-to/threading/unsubscribe headers, no idempotency
(`mailer.js:17-38`). Requires a separate outreach transport + **`outreach_send_attempts` outbox**
(claim → send with idempotency key → persist provider Message-ID → advance; send never inside
the DB transaction). Transport options: per-rep Zoho SMTP/OAuth (sends as the rep) or SES from an
isolated warmed subdomain (`partners.redeem.sg`) — never root `redeem.sg` (consumer transactional
mail). Bounce/complaint webhooks → `outreach_suppressions` BEFORE auto mode ships.
`List-Unsubscribe` + honored opt-out (Spam Control Act / IMDA).

## 7. Enrollment surfaces & ownership (Codex #12 verified: Discover returns counts, partners start unowned)

- P1: enroll button on Partner Detail (owned partners), bulk from **my owned** partners list.
- P2: pool/Discover moments need an **atomic claim-and-enroll** op (claim via `claimPartnerTx`
  + enroll in one transaction, capacity preflight) and `addToPartners` must return created
  partner IDs (today: counts only, `discoveryService.js:541-547`). Prompt fires post-claim.

## 8. UI spec (Fresha idiom)

1. **One shared `CadenceTaskCard`** used by MyQueue AND TasksPage: cadence chip
   (`F&B call-first v1 · 3/7`), **expandable** script (queue rows are compact `DocketRow`s —
   always-inline doesn't fit; verified), channel-valid disposition buttons only, per-task pending
   state, confirm + undo-window for terminal dispositions (`not_interested` opens the
   "also mark Lost?" confirm that drives §5.2's atomic path).
2. **Partner Detail**: compact cadence summary directly under the header on mobile (the 320px
   right rail lands below all tab content on mobile — verified), full card in the desktop rail:
   step list with done/skipped/current/blocked states + SGT dates, exit reason, Pause/Stop,
   atomic Switch (exit old + enroll new version in one call).
3. **Queue accounting** (Codex Q6 verified — real double-count today: `todoToday` sums
   due-tasks + awaiting-first-outreach, `MyQueue.jsx:73`): awaiting-first-outreach excludes
   partners with an open cadence first-touch task that is not overdue.
4. **Coverage stat** (team pipeline): % of owned partners with an open *outreach-type* task
   (call/whatsapp/email/instagram_dm/visit/follow_up) — NOT bare `nextTaskAt`, which counts
   admin/meeting tasks.
5. Settings → Cadences: read-only version list per key. Builder UI deferred; `settings.manage`.

## 9. Permissions & flags

- Enroll/pause/stop/complete: partner owner; managers (existing `isManager` set) any.
- Definitions (create/retire versions — even before builder UI, via seeds): `settings.manage`.
- Flags: backend `REDEEM_OPS_CADENCES_ENABLED` (routes + tick + hooks no-op when off), frontend
  `VITE_REDEEM_OPS_CADENCES_ENABLED` (SPA has only the master flag today — verified).

## 10. Seeds — bootstrap, not migration (Codex Q4 verified: migrations run before `initSystemAgent`, `createdBy` FK would dangle on fresh DBs)

Idempotent `ensureCadences()` in bootstrap after `initSystemAgent`, advisory-lock guarded,
keyed by immutable `(key, version)`:
- **`fnb_call_first` v1** (edge delays, not absolute days): call#1 —(no_answer, +0d, off_peak)→
  WhatsApp intro —(*, +2d)→ call#2 —(no_answer, +2d)→ IG DM —(*, +3d)→ call#3 —(no_answer, +3d)→
  visit —(*, +4d)→ break-up WhatsApp —(sent)→ finish. `connected`/`replied` edges terminate or
  fast-forward per matrix.
- **`revival_60d` v1**: WhatsApp check-in —(*, +5d)→ call —(no_answer, +7d)→ email → finish.

## 11. Phasing

- **P0:** transaction-primitive refactor + hook registry (pure refactor PR, no behavior change).
- **P1:** migration 057 + models/constants; cadenceService (enroll/complete/exit/pause/resume/
  reconcile + capacity cap); hook wiring incl. sweep-wake fix; disposition endpoint + generic-PATCH
  guard; `CadenceTaskCard` in MyQueue + TasksPage; Partner Detail card; queue dedup; suppressions
  gate; bootstrap seeds; dark flags.
- **P2:** claim-and-enroll (pool/Discover, `addToPartners` returns IDs); coverage stat; Settings
  read-only view; DNC gate wiring when enabled.
- **P3:** auto-email (outreach transport + outbox + bounce suppression), Zoho reply auto-exit
  (IMAP/API poll), builder UI, per-step funnel analytics.

## 12. Testing

House pattern (jest from `backend/`, throwaway pg on 5433). Beyond the usual unit/route coverage:
**concurrency tests** — double-complete race (two tx, one wins, replay semantics), completion vs
inbound-exit race, merge-vs-advance, tick overlap (advisory lock), crash between task-create and
enrollment-update (reconciler repairs); migration guarded re-run; P0 refactor equivalence suite.

## 13. Resolved questions (v1 §12 → Codex answers, verified where they touch code)

1. Branching: explicit transition edges, not conditional-skip. 2. Reassign keeps / release exits;
merge exits duplicate BEFORE repointing. 3. `visit` becomes a real activity type. 4. Seeds in
bootstrap. 5. No automatic stage movement; one-click suggestion after `replied`. 6. Queue
excludes scheduled cadence first-touches; coverage counts outreach-type tasks only. 7. Capacity
cap ships in P1.
