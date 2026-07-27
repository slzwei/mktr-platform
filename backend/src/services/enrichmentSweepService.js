import { randomUUID } from 'crypto';
import { sequelize } from '../models/index.js';
import {
  getActiveScoringConfig, findStaleConsumerIds, findConsumerIdsAfter,
  scoreOneConsumer, scoringEnabled,
} from './consumerScoringService.js';
import {
  findStaleLeadIds, findLeadIdsAfter, scoreOneLead,
} from './leadScoringService.js';
import { LEAD_ALGORITHM_VERSION } from '../utils/consumerScoring.js';
import { logger } from '../utils/logger.js';

/**
 * Nightly enrichment sweep + backfill mode
 * (docs/plans/consumer-profile-enrichment.md §7.3, §5; Codex R3 #9/#10).
 *
 * THREE INDEPENDENT GUARDS, because each stops a different failure:
 *
 * 1. A session-level `pg_try_advisory_lock` on a DEDICATED connection stops
 *    two app instances sweeping at once. Session-level, not xact-level: the
 *    sweep runs for minutes and must not hold a transaction open the whole
 *    time. `try_` (never blocking) means the loser returns immediately
 *    instead of piling up connections behind a lock.
 * 2. The `enrichment_sweep_runs` row is a FENCE, not a log — one live
 *    nightly per SGT date. `done` ends the date; `failed` may retry within
 *    it. This is what makes a restart loop safe: a crashed process that
 *    comes back up ten times does not sweep ten times.
 * 3. `ownerToken` fences every stats/finalization write, so a zombie that
 *    wakes up after its run was taken over cannot clobber its successor's
 *    numbers.
 *
 * BUDGETED, ROTATING REPAIR (R3 #10). Config-stale consumers are scored
 * first — those are provably wrong right now. Whatever budget remains goes
 * to a rotation through the whole population from a durable cursor, because
 * facts can change under a still-current config and no SQL predicate can
 * detect that (the hash check inside scoreOneConsumer makes each no-op
 * cheap). The cursor persists on the run row, so tonight resumes where last
 * night stopped instead of re-treading the head of the table forever.
 *
 * Backfill is a SEPARATE, separately-observable mode (§5) — never folded
 * into the nightly budget, so a one-off catch-up can't masquerade as a
 * healthy nightly or silently consume the night's rows.
 */

const ADVISORY_LOCK_KEY = 870778093; // 093-series; distinct from the migration runner's
const STALE_HEARTBEAT_MINUTES = 30;
const HEARTBEAT_EVERY_ROWS = 25;

const DEFAULT_ROW_BUDGET = 500;
const DEFAULT_TIME_BUDGET_MS = 5 * 60 * 1000;

/** YYYY-MM-DD in Asia/Singapore (UTC+8, no DST). */
export function sgtDateString(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Run `fn` holding a session-scoped advisory lock on a dedicated connection.
 * Returns {acquired: false} without calling fn when another holder exists.
 * The unlock + release run in `finally` — a throwing fn must never leak the
 * lock, or every subsequent night would no-op until the process restarts.
 */
export async function withAdvisoryLock(key, fn) {
  const cm = sequelize.connectionManager;
  const conn = await cm.getConnection({ type: 'write' });
  const raw = (sql) => conn.query(sql);
  let acquired = false;
  try {
    const res = await raw(`SELECT pg_try_advisory_lock(${key}) AS ok`);
    acquired = Boolean(res?.rows?.[0]?.ok ?? res?.[0]?.ok);
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await fn() };
  } finally {
    if (acquired) {
      try {
        await raw(`SELECT pg_advisory_unlock(${key})`);
      } catch (err) {
        logger.warn('[enrichmentSweep] advisory unlock failed', { error: err.message });
      }
    }
    try {
      await cm.releaseConnection(conn);
    } catch {
      // Pool already disposed (shutdown) — nothing useful left to do.
    }
  }
}

/**
 * Claim tonight's nightly run: insert a fresh row, retry a previously
 * `failed` one, or take over a `running` row whose owner has gone quiet.
 * Returns null when the date is already `done` or another live owner holds it.
 */
export async function claimNightlyRun(dateSgt) {
  const ownerToken = randomUUID();

  const [inserted] = await sequelize.query(
    `INSERT INTO enrichment_sweep_runs
       (id, "runDateSgt", "runType", status, "ownerToken", "heartbeatAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), :date, 'nightly', 'running', :token, now(), now(), now())
     ON CONFLICT DO NOTHING
     RETURNING id, "ownerToken", cursor`,
    { replacements: { date: dateSgt, token: ownerToken } }
  );
  if (inserted?.length) return { id: inserted[0].id, ownerToken, cursor: inserted[0].cursor || null };

  // Unique index only covers running|done — a failed row is retryable, and
  // reviving it in place keeps one row per date instead of accreting rubble.
  const [revived] = await sequelize.query(
    `UPDATE enrichment_sweep_runs
        SET status = 'running', "ownerToken" = :token, "heartbeatAt" = now(),
            "finishedAt" = NULL, "updatedAt" = now()
      WHERE "runDateSgt" = :date AND "runType" = 'nightly' AND status = 'failed'
      RETURNING id, cursor`,
    { replacements: { date: dateSgt, token: ownerToken } }
  );
  if (revived?.length) return { id: revived[0].id, ownerToken, cursor: revived[0].cursor || null };

  // Stale-heartbeat takeover. The predicate is evaluated by the database
  // inside the UPDATE, so two simultaneous takers cannot both win.
  const [taken] = await sequelize.query(
    `UPDATE enrichment_sweep_runs
        SET "ownerToken" = :token, "heartbeatAt" = now(), "updatedAt" = now()
      WHERE "runDateSgt" = :date AND "runType" = 'nightly' AND status = 'running'
        AND "heartbeatAt" < now() - interval '${STALE_HEARTBEAT_MINUTES} minutes'
      RETURNING id, cursor`,
    { replacements: { date: dateSgt, token: ownerToken } }
  );
  if (taken?.length) {
    logger.warn('[enrichmentSweep] took over a stale run', { dateSgt, runId: taken[0].id });
    return { id: taken[0].id, ownerToken, cursor: taken[0].cursor || null };
  }

  return null; // already done, or a live owner is mid-sweep
}

/** Owner-token-fenced heartbeat. Returns false if we've been taken over. */
export async function heartbeat(runId, ownerToken) {
  const [rows] = await sequelize.query(
    `UPDATE enrichment_sweep_runs SET "heartbeatAt" = now(), "updatedAt" = now()
      WHERE id = :id AND "ownerToken" = :token RETURNING id`,
    { replacements: { id: runId, token: ownerToken } }
  );
  return Boolean(rows?.length);
}

/** Owner-token-fenced finalization. A zombie's late write is a no-op. */
export async function finalizeRun(runId, ownerToken, { status, stats, cursor }) {
  const [rows] = await sequelize.query(
    `UPDATE enrichment_sweep_runs
        SET status = :status, stats = :stats::jsonb, cursor = :cursor::jsonb,
            "finishedAt" = now(), "updatedAt" = now()
      WHERE id = :id AND "ownerToken" = :token
      RETURNING id`,
    {
      replacements: {
        id: runId,
        token: ownerToken,
        status,
        stats: JSON.stringify(stats || {}),
        cursor: JSON.stringify(cursor || {}),
      },
    }
  );
  return Boolean(rows?.length);
}

/**
 * Score a list of consumers, respecting the row + wall-time budget.
 * One consumer's failure is logged and counted, never fatal — a single bad
 * row must not cost the night's remaining budget.
 */
async function processBatch(ids, ctx, { scoreOne, rowCap, deadline, grain } = {}) {
  const score = scoreOne || ctx.scoreOne;
  const cap = rowCap ?? ctx.rowBudget;
  const by = deadline ?? ctx.deadline;

  for (const id of ids) {
    if (ctx.rowsUsed >= cap) return 'row_budget';
    if (Date.now() >= by) return 'time_budget';

    try {
      const res = await score(id, { now: Date.now() });
      ctx.stats[res.status] = (ctx.stats[res.status] || 0) + 1;
    } catch (err) {
      ctx.stats.errors = (ctx.stats.errors || 0) + 1;
      logger.error('[enrichmentSweep] scoring failed', { grain: grain || 'consumer', id, error: err.message });
    }

    ctx.rowsUsed += 1;
    ctx.lastId = id;

    if (ctx.rowsUsed % HEARTBEAT_EVERY_ROWS === 0 && ctx.runId) {
      const alive = await ctx.heartbeatFn(ctx.runId, ctx.ownerToken);
      if (!alive) {
        logger.warn('[enrichmentSweep] lost ownership mid-run — standing down', { runId: ctx.runId });
        return 'taken_over';
      }
    }
  }
  return null;
}

/**
 * The shared engine for both modes. Config-stale first, then the rotation.
 *
 * `deps` exists so the phase logic — budgets, cursor advancement, the
 * one-pass rotation — is testable without a database. Those rules are pure
 * control flow over a list of ids, and the redundant-wrap bug lived there
 * precisely because nothing could exercise it in isolation.
 */
export async function sweepConsumers({
  runId, ownerToken, cursor, rowBudget, timeBudgetMs, deps = {},
}) {
  const getConfig = deps.getActiveScoringConfig || getActiveScoringConfig;
  const findStale = deps.findStaleConsumerIds || findStaleConsumerIds;
  const findAfter = deps.findConsumerIdsAfter || findConsumerIdsAfter;
  const findStaleLeads = deps.findStaleLeadIds || findStaleLeadIds;
  const findLeadsAfter = deps.findLeadIdsAfter || findLeadIdsAfter;

  const { version: configVersion, config } = await getConfig();
  const algorithmVersion = config.algorithmVersion;

  const ctx = {
    runId,
    ownerToken,
    rowBudget,
    deadline: Date.now() + timeBudgetMs,
    rowsUsed: 0,
    lastId: null,
    scoreOne: deps.scoreOneConsumer || scoreOneConsumer,
    scoreOneLeadFn: deps.scoreOneLead || scoreOneLead,
    heartbeatFn: deps.heartbeat || heartbeat,
    stats: { scored: 0, unchanged: 0, skipped: 0, errors: 0 },
  };

  /**
   * THE ROTATION RESERVATION (§6, Codex round 3a/3b).
   *
   * A row-count reservation alone guarantees nothing. The deadline is checked
   * before every row (processBatch above) and the rotation runs only when no
   * stop occurred, so a wall-clock stop inside the stale phase yields ZERO
   * rotation — and on a population whose stale backlog recurs nightly (config
   * churn), the rotation would starve indefinitely.
   *
   * So the reservation is two-dimensional: the stale phases stop ADMITTING at
   * 80% of the row cap AND 80% of the deadline, leaving the rotation the final
   * 20% admission window of each. ADMISSION is what is reserved, not literal
   * wall-clock — an in-flight row can still overrun the moment of the check.
   */
  const ROTATION_RESERVE = 0.2;
  const staleLimits = {
    rowCap: Math.max(1, Math.floor(rowBudget * (1 - ROTATION_RESERVE))),
    deadline: Date.now() + Math.max(1, Math.floor(timeBudgetMs * (1 - ROTATION_RESERVE))),
  };

  // Phase 1 — provably-stale rows (never scored, or scored under an old
  // config/algorithm). These are wrong right now, so they get first claim.
  //
  // The cursor must ADVANCE even though scoring a row normally clears its
  // own staleness: a consumer that throws, or that comes back 'skipped'
  // (erased mid-run, vanished), never gets stamped and would be handed back
  // by the very next query. Without a monotonic cursor a single poison row
  // would re-fail its way through the entire night's budget.
  // Why the budget check names its own reason: `stoppedBy` is the only
  // signal an operator has for whether a run finished its work or merely ran
  // out of room, and those demand opposite responses (ignore vs raise the
  // budget). Breaking out silently reported both as "exhausted".
  const budgetSpent = (limits = {}) => {
    const cap = limits.rowCap ?? ctx.rowBudget;
    const by = limits.deadline ?? ctx.deadline;
    if (ctx.rowsUsed >= cap) return 'row_budget';
    if (Date.now() >= by) return 'time_budget';
    return null;
  };

  /** One provably-stale phase, bounded by the reserved stale window. */
  async function stalePhase({ find, scoreOne, grain, findArgs }) {
    let phaseCursor = null;
    for (;;) {
      const spent = budgetSpent(staleLimits);
      if (spent) return spent;
      const batch = await find({
        ...findArgs,
        limit: Math.min(200, Math.max(1, staleLimits.rowCap - ctx.rowsUsed)),
        afterId: phaseCursor,
      });
      if (!batch.length) return null;
      const stop = await processBatch(batch, ctx, { scoreOne, grain, ...staleLimits });
      phaseCursor = ctx.lastId;
      if (stop) return stop;
    }
  }

  /** One rotation phase, against the FULL budget, from a durable cursor. */
  async function rotationPhase({ find, scoreOne, grain, startCursor }) {
    let phaseCursor = startCursor;
    for (;;) {
      const spent = budgetSpent();
      if (spent) return { stop: spent, cursor: phaseCursor, wrapped: false };
      const batch = await find({
        afterId: phaseCursor,
        limit: Math.min(200, ctx.rowBudget - ctx.rowsUsed),
      });
      if (!batch.length) {
        // End of the id space. Reset so the next run starts from the top.
        return { stop: null, cursor: null, wrapped: true };
      }
      const stop = await processBatch(batch, ctx, { scoreOne, grain });
      phaseCursor = ctx.lastId;
      if (stop) return { stop, cursor: phaseCursor, wrapped: false };
    }
  }

  // Phase 1 — provably-stale CONSUMERS, then provably-stale LEADS. Both are
  // wrong right now, so they share first claim on the budget; the lead phase
  // includes every dirty-marked lead (§10), which is how an event-driven move
  // that outlived its in-process rescore still lands the same night.
  let staleStop = await stalePhase({
    find: findStale, scoreOne: ctx.scoreOne, grain: 'consumer',
    findArgs: { configVersion, algorithmVersion },
  });
  const consumerStaleScored = ctx.rowsUsed;

  if (staleStop !== 'taken_over') {
    // No configVersion: under per-campaign configs (§9) there is no single
    // expected version to compare against, so findStaleLeadIds resolves each
    // lead's own campaign → product → global chain in SQL. `configVersion`
    // above stays the GLOBAL one and still governs the consumer phase, which
    // has no campaign to key off.
    const leadStop = await stalePhase({
      find: findStaleLeads, scoreOne: ctx.scoreOneLeadFn, grain: 'lead',
      findArgs: {},
    });
    staleStop = leadStop === 'taken_over' ? leadStop : (staleStop || leadStop);
  }

  const staleScored = ctx.rowsUsed;
  const leadStaleScored = staleScored - consumerStaleScored;

  // A stale phase that stopped on its RESERVED window has not spent the run's
  // budget — only a takeover ends the night early. This is the whole point of
  // the reservation: 'row_budget' here means "the stale slice is full", not
  // "there is no room left".
  let stop = staleStop === 'taken_over' ? 'taken_over' : null;

  // Phase 2 — budgeted rotation for hash-level staleness (facts can move
  // under a still-current config, and no SQL predicate detects that).
  //
  // ONE PASS PER RUN, never a wrap. Walking off the end used to reset the
  // cursor and start over, so a population smaller than the row budget got
  // re-examined until the budget ran out — on 130 consumers that was ~370
  // redundant hash checks a night, every night, reported as useful work. The
  // cursor is durable, so stopping at the end and resuming next run covers
  // the same ground without the churn.
  let rotationCursor = cursor?.lastConsumerId || null;
  let leadRotationCursor = cursor?.lastProspectId || null;
  let rotationWrapped = false;
  let leadRotationWrapped = false;
  let consumerRotationScored = 0;

  if (!stop) {
    const r = await rotationPhase({
      find: findAfter, scoreOne: ctx.scoreOne, grain: 'consumer',
      startCursor: rotationCursor,
    });
    rotationCursor = r.cursor;
    rotationWrapped = r.wrapped;
    stop = r.stop;
    consumerRotationScored = ctx.rowsUsed - staleScored;
  }

  if (stop !== 'taken_over') {
    // Safe to call unconditionally: an exhausted budget makes this return on
    // its first check. Each grain keeps its OWN cursor, so a run that only
    // had room for consumers does not silently advance the lead rotation past
    // leads it never looked at.
    const r = await rotationPhase({
      find: findLeadsAfter, scoreOne: ctx.scoreOneLeadFn, grain: 'lead',
      startCursor: leadRotationCursor,
    });
    leadRotationCursor = r.cursor;
    leadRotationWrapped = r.wrapped;
    stop = r.stop || stop;
  }

  return {
    stats: {
      ...ctx.stats,
      rowsUsed: ctx.rowsUsed,
      staleScored,
      consumerStaleScored,
      leadStaleScored,
      rotationScored: ctx.rowsUsed - staleScored,
      consumerRotationScored,
      leadRotationScored: ctx.rowsUsed - staleScored - consumerRotationScored,
      // 'exhausted' means what it says: no stale rows left and BOTH rotations
      // reached the end of their population within budget. These per-phase
      // numbers are the measured throughput §6 promises instead of a
      // calendar — the rotation period is population ÷ this, and a starving
      // rotation shows up here as a persistent zero.
      stoppedBy: stop || (rotationWrapped && leadRotationWrapped ? 'exhausted' : 'no_work'),
      configVersion,
      algorithmVersion,
      leadAlgorithmVersion: LEAD_ALGORITHM_VERSION,
    },
    cursor: { lastConsumerId: rotationCursor, lastProspectId: leadRotationCursor },
    takenOver: stop === 'taken_over',
  };
}

/**
 * Nightly sweep. Safe to call repeatedly — the date fence makes extra calls
 * no-ops once the night is done.
 */
// No `now` parameter by design: the SGT date is deliberately re-derived
// INSIDE the lock (below), so a caller-supplied clock read from before the
// wait could name a night that is already over.
export async function runNightlySweep({
  rowBudget = DEFAULT_ROW_BUDGET,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
} = {}) {
  if (!scoringEnabled()) return { ran: false, reason: 'flag_off' };

  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEY, async () => {
    // Re-derive the date AFTER acquiring the lock: we may have waited across
    // the SGT midnight boundary, and claiming yesterday would burn the fence
    // for a night that is already over (§7.3 window re-check).
    const dateSgt = sgtDateString(Date.now());

    const claim = await claimNightlyRun(dateSgt);
    if (!claim) return { ran: false, reason: 'already_done_or_running', dateSgt };

    try {
      const { stats, cursor, takenOver } = await sweepConsumers({
        runId: claim.id,
        ownerToken: claim.ownerToken,
        cursor: claim.cursor,
        rowBudget,
        timeBudgetMs,
      });
      if (takenOver) return { ran: false, reason: 'taken_over', dateSgt };

      await finalizeRun(claim.id, claim.ownerToken, { status: 'done', stats, cursor });
      logger.info('[enrichmentSweep] nightly complete', { dateSgt, ...stats });
      return { ran: true, dateSgt, stats };
    } catch (err) {
      logger.error('[enrichmentSweep] nightly failed', { dateSgt, error: err.message });
      // 'failed' (not 'done') so tonight can still be retried — the unique
      // index deliberately excludes failed rows.
      await finalizeRun(claim.id, claim.ownerToken, {
        status: 'failed', stats: { error: err.message }, cursor: claim.cursor,
      });
      throw err;
    }
  });

  if (!outcome.acquired) return { ran: false, reason: 'lock_held' };
  return outcome.value;
}

/**
 * Backfill mode (§5) — a separately-invoked, separately-observable catch-up.
 * Own runType, own budget, no date fence, and it always walks from the
 * supplied cursor so an operator can restart it in slices.
 */
export async function runBackfill({
  rowBudget = 5000,
  timeBudgetMs = 30 * 60 * 1000,
  afterId = null,
} = {}) {
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEY, async () => {
    const dateSgt = sgtDateString(Date.now());
    const ownerToken = randomUUID();

    const [rows] = await sequelize.query(
      `INSERT INTO enrichment_sweep_runs
         (id, "runDateSgt", "runType", status, "ownerToken", "heartbeatAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), :date, 'backfill', 'running', :token, now(), now(), now())
       RETURNING id`,
      { replacements: { date: dateSgt, token: ownerToken } }
    );
    const runId = rows[0].id;

    try {
      const { stats, cursor } = await sweepConsumers({
        runId,
        ownerToken,
        cursor: { lastConsumerId: afterId },
        rowBudget,
        timeBudgetMs,
      });
      await finalizeRun(runId, ownerToken, { status: 'done', stats, cursor });
      logger.info('[enrichmentSweep] backfill complete', { ...stats });
      return { ran: true, stats, cursor };
    } catch (err) {
      await finalizeRun(runId, ownerToken, {
        status: 'failed', stats: { error: err.message }, cursor: { lastConsumerId: afterId },
      });
      throw err;
    }
  });

  if (!outcome.acquired) return { ran: false, reason: 'lock_held' };
  return outcome.value;
}
