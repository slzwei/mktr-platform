import { randomUUID } from 'crypto';
import { sequelize } from '../models/index.js';
import {
  getActiveScoringConfig, findStaleConsumerIds, findConsumerIdsAfter,
  scoreOneConsumer, scoringEnabled,
} from './consumerScoringService.js';
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
async function processBatch(ids, ctx) {
  for (const id of ids) {
    if (ctx.rowsUsed >= ctx.rowBudget) return 'row_budget';
    if (Date.now() >= ctx.deadline) return 'time_budget';

    try {
      const res = await scoreOneConsumer(id, { now: Date.now() });
      ctx.stats[res.status] = (ctx.stats[res.status] || 0) + 1;
    } catch (err) {
      ctx.stats.errors = (ctx.stats.errors || 0) + 1;
      logger.error('[enrichmentSweep] scoring failed', { consumerId: id, error: err.message });
    }

    ctx.rowsUsed += 1;
    ctx.lastId = id;

    if (ctx.rowsUsed % HEARTBEAT_EVERY_ROWS === 0 && ctx.runId) {
      const alive = await heartbeat(ctx.runId, ctx.ownerToken);
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
 */
async function sweepConsumers({ runId, ownerToken, cursor, rowBudget, timeBudgetMs }) {
  const { version: configVersion, config } = await getActiveScoringConfig();
  const algorithmVersion = config.algorithmVersion;

  const ctx = {
    runId,
    ownerToken,
    rowBudget,
    deadline: Date.now() + timeBudgetMs,
    rowsUsed: 0,
    lastId: null,
    stats: { scored: 0, unchanged: 0, skipped: 0, errors: 0 },
  };

  // Phase 1 — provably-stale rows (never scored, or scored under an old
  // config/algorithm). These are wrong right now, so they get first claim.
  //
  // The cursor must ADVANCE even though scoring a row normally clears its
  // own staleness: a consumer that throws, or that comes back 'skipped'
  // (erased mid-run, vanished), never gets stamped and would be handed back
  // by the very next query. Without a monotonic cursor a single poison row
  // would re-fail its way through the entire night's budget.
  let stop = null;
  let staleCursor = null;
  for (;;) {
    if (ctx.rowsUsed >= ctx.rowBudget || Date.now() >= ctx.deadline) break;
    const batch = await findStaleConsumerIds({
      configVersion,
      algorithmVersion,
      limit: Math.min(200, ctx.rowBudget - ctx.rowsUsed),
      afterId: staleCursor,
    });
    if (!batch.length) break;
    stop = await processBatch(batch, ctx);
    staleCursor = ctx.lastId;
    if (stop) break;
  }

  const staleScored = ctx.rowsUsed;

  // Phase 2 — budgeted rotation for hash-level staleness. Resumes from the
  // durable cursor and wraps to the start of the id space when exhausted.
  let rotationCursor = cursor?.lastConsumerId || null;
  if (!stop) {
    for (;;) {
      if (ctx.rowsUsed >= ctx.rowBudget || Date.now() >= ctx.deadline) break;
      const batch = await findConsumerIdsAfter({
        afterId: rotationCursor,
        limit: Math.min(200, ctx.rowBudget - ctx.rowsUsed),
      });
      if (!batch.length) {
        if (rotationCursor === null) break; // population fully walked this run
        rotationCursor = null; // wrap around and keep going
        continue;
      }
      stop = await processBatch(batch, ctx);
      rotationCursor = ctx.lastId;
      if (stop) break;
    }
  }

  return {
    stats: {
      ...ctx.stats,
      rowsUsed: ctx.rowsUsed,
      staleScored,
      rotationScored: ctx.rowsUsed - staleScored,
      stoppedBy: stop || 'exhausted',
      configVersion,
      algorithmVersion,
    },
    cursor: { lastConsumerId: rotationCursor },
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
