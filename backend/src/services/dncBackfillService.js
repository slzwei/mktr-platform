import { Op, literal } from 'sequelize';
import * as Sentry from '@sentry/node';
import { sequelize, Prospect } from '../models/index.js';
import { gateHeldDncLead } from './dncGate.js';
import { dncReady } from './dncService.js';
import { logger } from '../utils/logger.js';

/**
 * dncBackfillService — recovers leads held `dnc_pending` whose DNC check errored or timed out
 * at capture, by re-running the gate (re-check → release-on-clear / keep-held). This is the
 * fail-safe net behind the synchronous create-path gate: an outage at capture degrades to
 * "held pending", and this job drains the backlog once the API is reachable again.
 *
 * Design: docs/plans/dnc-scrubbing.md §5.5. Because it spends paid credits, it is NOT the bare
 * redeemed-audience scheduler — it adds an in-process re-entrancy guard + a DB advisory JOB
 * lock (so a slow run can't overlap the next tick, and only one instance runs it).
 *
 * Reuse note: per-lead it calls gateHeldDncLead, which itself serializes outbound calls on the
 * 'dnc_call' advisory lock and releases via the crash-safe outbox. For a `dnc_pending` lead the
 * intended agent is still on dncMetadata (checkAndRecord only overwrites it on a SUCCESSFUL
 * check, i.e. the lead is leaving `dnc_pending` anyway), so the release has its agent.
 *
 * Scoped to the self-contained recovery. Deferred (needs more wiring — see §5.5/§10):
 *   - revalidation of clear/registered results before `dncValidUntil`
 *   - reverse flip of long-held `dnc_registered` leads (needs agent re-resolution)
 *   - `lead.updated` for already-delivered leads that flip (needs the lyfe-app receiver)
 */

const JOB_LOCK_KEY = 'dnc_backfill';
const MAX_PER_RUN = 200;

/**
 * Per-lead attempt bound. Without it a lead the registry never resolves — a number PDPC
 * rejects outright (their S501 "no valid telephone number", which our format check can't
 * predict), or a `skipped` result, which gateHeldDncLead leaves as `dnc_pending` — is
 * re-driven every tick forever, silently, with nothing surfacing that it is stuck.
 * On crossing the bound we stop retrying and ALERT: the lead stays held (fail-safe, the
 * bound never delivers anything), it just becomes a visible human decision instead of
 * invisible churn. Default 20 ≈ 10h at the 30-min tick, so ordinary DNC outages still
 * self-heal without a page.
 */
const DEFAULT_MAX_ATTEMPTS = 20;
function maxAttempts() {
  const v = Number(process.env.DNC_BACKFILL_MAX_ATTEMPTS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_ATTEMPTS;
}

const attemptsOf = (prospect) => Number(prospect?.dncMetadata?.backfillAttempts) || 0;

/**
 * Record one more unsuccessful pass over this lead, and alert on the one tick that crosses
 * the bound (afterwards the SQL filter excludes it, so this fires exactly once per lead).
 */
async function recordAttempt(prospect, d, cap) {
  const next = attemptsOf(prospect) + 1;
  if (typeof prospect?.update === 'function') {
    await prospect
      .update({ dncMetadata: { ...(prospect.dncMetadata || {}), backfillAttempts: next } })
      .catch((err) =>
        d.logger.warn('[DNC] backfill attempt-counter write failed', {
          prospectId: prospect.id,
          error: err?.message || String(err),
        })
      );
  }
  if (next >= cap) {
    d.Sentry.captureMessage(`DNC backfill gave up on lead after ${next} attempts`, {
      level: 'error',
      tags: { source: 'dnc', reason: 'backfill_exhausted' },
      extra: { prospect_id: prospect?.id },
    });
    d.logger.error(
      { prospect_id: prospect?.id, attempts: next },
      'dnc.backfill.exhausted'
    );
  }
  return next;
}

// In-process guard: never let two runs (e.g. an overlapping interval tick) overlap.
let running = false;

async function processPendingHolds(d) {
  const cap = d.maxAttempts();
  // Held `dnc_pending` leads on contactable (non-terminal) leads, oldest first. Leads that
  // have already exhausted the attempt bound are excluded in SQL, not in JS, so they can't
  // consume the MAX_PER_RUN slice and starve leads that are still worth re-driving.
  const candidates = await d.Prospect.findAll({
    where: {
      quarantineReason: 'dnc_pending',
      quarantinedAt: { [Op.ne]: null },
      leadStatus: { [Op.notIn]: ['won', 'lost'] },
      [Op.and]: [literal(`COALESCE(("dncMetadata"->>'backfillAttempts')::int, 0) < ${Number(cap)}`)],
    },
    order: [['quarantinedAt', 'ASC']],
    limit: MAX_PER_RUN,
  });

  let released = 0;
  let held = 0;
  let errors = 0;
  let exhausted = 0;
  for (const prospect of candidates) {
    const r = await d.gateHeldDncLead(prospect); // never throws
    if (r.outcome === 'released') {
      released++;
      continue;
    }
    // Anything short of a release means this lead is still sitting in the backlog, so it
    // counts against the bound — including a `registered` verdict whose relabel to
    // `dnc_registered` failed, which would otherwise be re-driven forever.
    const attempts = await d.recordAttempt(prospect, d, cap);
    if (attempts >= cap) exhausted++;
    if (r.status === 'error' || r.status === 'pending') errors++;
    else held++;
  }

  d.logger.info({ released, held, errors, exhausted, total: candidates.length }, 'dnc.backfill.done');
  return { ran: true, released, held, errors, exhausted, total: candidates.length };
}

/**
 * Run one backfill pass. Never throws. Returns a summary (or a skip reason).
 */
export async function runDncBackfill(overrides = {}) {
  const d = { sequelize, Prospect, gateHeldDncLead, dncReady, logger, Sentry, maxAttempts, recordAttempt, ...overrides };

  if (!d.dncReady()) return { ran: false, reason: 'not_ready' };
  if (running) {
    d.logger.info('[DNC] backfill skip — previous run still in progress');
    return { ran: false, reason: 'already_running' };
  }
  running = true;
  try {
    // DB advisory JOB lock — held for the whole pass (auto-released on tx end), so a slow
    // run can't overlap the next tick and only one instance processes the backlog.
    return await d.sequelize.transaction(async (lockTx) => {
      const [{ locked }] = await d.sequelize.query(
        `SELECT pg_try_advisory_xact_lock(hashtext(:k)) AS locked`,
        { replacements: { k: JOB_LOCK_KEY }, type: d.sequelize.QueryTypes.SELECT, transaction: lockTx }
      );
      if (!locked) {
        d.logger.info('[DNC] backfill skip — job lock held elsewhere');
        return { ran: false, reason: 'lock_held' };
      }
      return processPendingHolds(d);
    });
  } catch (err) {
    d.logger.error('[DNC] backfill failed', { error: err?.message || String(err) });
    return { ran: false, reason: 'error', error: err?.message };
  } finally {
    running = false;
  }
}

export default { runDncBackfill };
