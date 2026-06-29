import { Op } from 'sequelize';
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

// In-process guard: never let two runs (e.g. an overlapping interval tick) overlap.
let running = false;

async function processPendingHolds(d) {
  // Held `dnc_pending` leads on contactable (non-terminal) leads, oldest first.
  const candidates = await d.Prospect.findAll({
    where: {
      quarantineReason: 'dnc_pending',
      quarantinedAt: { [Op.ne]: null },
      leadStatus: { [Op.notIn]: ['won', 'lost'] },
    },
    order: [['quarantinedAt', 'ASC']],
    limit: MAX_PER_RUN,
  });

  let released = 0;
  let held = 0;
  let errors = 0;
  for (const prospect of candidates) {
    const r = await d.gateHeldDncLead(prospect); // never throws
    if (r.outcome === 'released') released++;
    else if (r.status === 'error' || r.status === 'pending') errors++;
    else held++;
  }

  d.logger.info({ released, held, errors, total: candidates.length }, 'dnc.backfill.done');
  return { ran: true, released, held, errors, total: candidates.length };
}

/**
 * Run one backfill pass. Never throws. Returns a summary (or a skip reason).
 */
export async function runDncBackfill(overrides = {}) {
  const d = { sequelize, Prospect, gateHeldDncLead, dncReady, logger, ...overrides };

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
