import { Op } from 'sequelize';
import { sequelize, Prospect, Campaign } from '../models/index.js';
import { screeningConfig, makeScreeningGate } from './screeningGate.js';
import { makeRetellScreeningService } from './retellScreeningService.js';
import * as retellClient from './retellClient.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';
import { logger } from '../utils/logger.js';

/**
 * screeningSweepService — the restart-safe recovery net for the screening gate
 * (docs/plans/retell-screening-calls.md §10). DB-driven, never setTimeout-
 * dependent: everything a lost webhook, crash, or outage strands is resolved
 * here within one tick.
 *
 * Pass order is load-bearing (Codex #5): terminalize BEFORE dialing, and rows
 * touched by an earlier job are excluded from later jobs in the same pass — a
 * lead can never be dialed and released in one sweep.
 *   1. qualified-delivery retries (release failed after a qualified verdict)
 *   2. stale in-flight resolution (poll bound ids; expire silent sentinels)
 *   3. TTL enforcement (max hold age → unreachable policy; qualified → release)
 *   4. drain (master/campaign gate off → release pending unscreened)
 *   5. due retries LAST (dial guards re-checked inside startScreeningAttempt)
 *
 * Runs when the feature is enabled OR pending rows exist (drain mode) — a kill
 * switch must never strand held leads (§10.4).
 */

const JOB_LOCK_KEY = 'screening_sweep';
const MAX_PER_RUN = 100;

let running = false;

const defaultDeps = {
  sequelize,
  Prospect,
  Campaign,
  retellClient,
  logger,
  gate: makeScreeningGate(),
  dialer: makeRetellScreeningService(),
};

async function processPass(d, cfg) {
  const touched = new Set();
  const counts = { releasedQualified: 0, staleResolved: 0, ttl: 0, drained: 0, dialed: 0, errors: 0 };
  const now = new Date();

  // ── 1. Qualified but undelivered (release rolled back: no_credit /
  //       no_subscriber / agent gone). Retry delivery; never redial.
  const qualified = await d.Prospect.findAll({
    where: { quarantineReason: 'screening_pending', screeningVerdict: 'qualified', screeningActiveCallId: null },
    order: [['quarantinedAt', 'ASC']],
    limit: MAX_PER_RUN,
  });
  for (const p of qualified) {
    touched.add(p.id);
    const rel = await d.gate.releaseScreenedLead({ prospect: p, via: 'sweep_qualified_retry' });
    if (rel.released) counts.releasedQualified++;
  }

  // ── 2. Stale in-flight: bound call ids polled via get-call (only a definite
  //       result clears the attempt — transient errors leave it); silent
  //       'pend_' sentinels past the stale window expire as failed attempts.
  const staleCutoff = new Date(now.getTime() - cfg.staleCallMinutes * 60 * 1000);
  const stale = await d.Prospect.findAll({
    where: {
      quarantineReason: 'screening_pending',
      screeningActiveCallId: { [Op.ne]: null },
      updatedAt: { [Op.lt]: staleCutoff },
    },
    limit: MAX_PER_RUN,
  });
  for (const p of stale) {
    touched.add(p.id);
    const activeId = p.screeningActiveCallId;
    try {
      if (activeId.startsWith('pend_')) {
        // No webhook ever bound it — the call almost certainly never happened.
        await d.dialer.resolveAttemptFailure(p, activeId, { cfg, kind: 'dispatch_expired' });
        counts.staleResolved++;
        continue;
      }
      const call = await d.retellClient.getCall(activeId);
      if (call === null) {
        // 404 — definitely unknown to Retell. Safe to fail the attempt.
        await d.dialer.resolveAttemptFailure(p, activeId, { cfg, kind: 'call_unknown' });
        counts.staleResolved++;
      } else if (call.call_status === 'ended' || call.call_analysis || call.disconnection_reason) {
        await d.dialer.applyCallOutcome(p, call, { cfg, finalIfNoAnalysis: true });
        counts.staleResolved++;
      }
      // still ongoing / registered → leave for the next pass
    } catch (err) {
      counts.errors++;
      d.logger.warn('[Screening] sweep stale poll failed (left for next pass)', { prospectId: p.id, error: err?.message });
    }
  }

  // ── 3. TTL: no lead holds longer than maxHoldHours. Verdict-less rows hit
  //       the unreachable policy; qualified rows were job 1's (and stay so).
  const ttlCutoff = new Date(now.getTime() - cfg.maxHoldHours * 60 * 60 * 1000);
  const expired = await d.Prospect.findAll({
    where: {
      quarantineReason: 'screening_pending',
      screeningActiveCallId: null,
      screeningVerdict: null,
      quarantinedAt: { [Op.lt]: ttlCutoff },
      id: { [Op.notIn]: [...touched].length ? [...touched] : ['00000000-0000-0000-0000-000000000000'] },
    },
    limit: MAX_PER_RUN,
  });
  for (const p of expired) {
    touched.add(p.id);
    await d.gate.applyUnreachablePolicy(p, { via: 'screening_ttl', cfg });
    counts.ttl++;
  }

  // ── 4. Drain: feature off or campaign gate off → release pending rows
  //       unscreened (in-flight calls resolve via job 2 first, then drain
  //       next pass). A disabled feature must never keep holding leads.
  const pending = await d.Prospect.findAll({
    where: {
      quarantineReason: 'screening_pending',
      screeningActiveCallId: null,
      screeningVerdict: null,
      id: { [Op.notIn]: [...touched].length ? [...touched] : ['00000000-0000-0000-0000-000000000000'] },
    },
    order: [['quarantinedAt', 'ASC']],
    limit: MAX_PER_RUN,
  });
  const campaignGateCache = new Map();
  const gateOnFor = async (campaignId) => {
    if (!campaignId) return false;
    if (campaignGateCache.has(campaignId)) return campaignGateCache.get(campaignId);
    const camp = await d.Campaign.findByPk(campaignId).catch(() => null);
    const on = readLegacyViewSafe(camp?.design_config, {}).screeningCallAtSubmit === true;
    campaignGateCache.set(campaignId, { on, camp });
    return { on, camp };
  };

  for (const p of pending) {
    const { on } = (await gateOnFor(p.campaignId)) || {};
    if (!cfg.configured || !on) {
      touched.add(p.id);
      await d.gate.releaseScreenedLead({ prospect: p, unscreened: true, via: 'screening_drain' });
      counts.drained++;
    }
  }

  // ── 5. Due retries LAST. startScreeningAttempt re-runs every dial guard
  //       (stamp, DNC, consent, window, budget, concurrency).
  if (cfg.configured && !cfg.dryRun) {
    const due = await d.Prospect.findAll({
      where: {
        quarantineReason: 'screening_pending',
        screeningActiveCallId: null,
        screeningVerdict: null,
        screeningNextAttemptAt: { [Op.lte]: now },
        screeningAttemptCount: { [Op.lt]: cfg.maxAttempts },
        id: { [Op.notIn]: [...touched].length ? [...touched] : ['00000000-0000-0000-0000-000000000000'] },
      },
      order: [['screeningNextAttemptAt', 'ASC']],
      limit: Math.min(MAX_PER_RUN, cfg.maxConcurrent * 2),
    });
    for (const p of due) {
      const cached = await gateOnFor(p.campaignId);
      const r = await d.dialer.startScreeningAttempt(p, { campaign: cached?.camp || null, cfg });
      if (r.status === 'dialed') counts.dialed++;
      if (r.status === 'deferred' && ['budget_exhausted', 'concurrency_full'].includes(r.reason)) break;
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) d.logger.info(counts, 'screening.sweep.done');
  return { ran: true, ...counts };
}

/** Run one sweep pass. Never throws. */
export async function runScreeningSweep(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const cfg = overrides.cfg || screeningConfig();

  if (!cfg.configured) {
    // Drain-aware: only run while screening rows exist (kill-switch cleanup).
    const pendingCount = await d.Prospect.count({ where: { quarantineReason: 'screening_pending' } }).catch(() => 0);
    if (pendingCount === 0) return { ran: false, reason: 'disabled_no_backlog' };
  }
  if (running) {
    d.logger.info('[Screening] sweep skip — previous run still in progress');
    return { ran: false, reason: 'already_running' };
  }
  running = true;
  try {
    return await d.sequelize.transaction(async (lockTx) => {
      const [{ locked }] = await d.sequelize.query(
        `SELECT pg_try_advisory_xact_lock(hashtext(:k)) AS locked`,
        { replacements: { k: JOB_LOCK_KEY }, type: d.sequelize.QueryTypes.SELECT, transaction: lockTx }
      );
      if (!locked) {
        d.logger.info('[Screening] sweep skip — job lock held elsewhere');
        return { ran: false, reason: 'lock_held' };
      }
      return processPass(d, cfg);
    });
  } catch (err) {
    d.logger.error('[Screening] sweep failed', { error: err?.message || String(err) });
    return { ran: false, reason: 'error', error: err?.message };
  } finally {
    running = false;
  }
}

export default { runScreeningSweep };
