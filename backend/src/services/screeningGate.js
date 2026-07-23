import { sequelize, Prospect, ProspectActivity, User, Campaign } from '../models/index.js';
import { chargeLeadCredit, refundLeadCredit, deductLeadCredit } from './leadCredits.js';
import { persistEventDeliveries, flushDeliveries } from './webhookService.js';
import { buildLeadCreatedPayload, destinationForAgent, externalIdForDestination } from './prospectHelpers.js';
import { resolveLeadRouting } from './systemAgent.js';
import { phoneVerificationIsCurrent } from './consumerService.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';
import { SCREENING_REASONS } from './screeningConstants.js';
import { logger } from '../utils/logger.js';

/**
 * screeningGate — state machine for the AI screening-call hold
 * (docs/plans/retell-screening-calls.md §2.2, §9).
 *
 * State lives in DISCRETE prospect columns (quarantineReason,
 * screeningActiveCallId, screeningVerdict, …); screeningMetadata is evidence
 * only. Every transition is a single conditional UPDATE fencing on those
 * columns — losers no-op, duplicate webhook events replay harmlessly, and an
 * admin release (which clears quarantineReason via the reason-blind claim)
 * makes every later screening transition lose its fence. NEVER read-modify-
 * write screeningMetadata; evidence appends ride the fenced statement as
 * jsonb_set/|| expressions.
 *
 * Modeled on dncGate.js (born-held / release-on-clear, in-tx outbox,
 * fail-closed re-hold) with one deliberate divergence: the release charge is
 * authoritative ONLY for quota-enforced/priced campaigns; soft campaigns get
 * the same best-effort deduct they get on the direct capture path — a soft
 * campaign with zero funded packages must not strand its screened leads on
 * `no_credit` (dncGate charges unconditionally, but every DNC campaign is
 * quota-enforced in practice; screening campaigns need not be).
 */

const defaultDeps = {
  sequelize,
  Prospect,
  ProspectActivity,
  User,
  Campaign,
  chargeLeadCredit,
  refundLeadCredit,
  deductLeadCredit,
  persistEventDeliveries,
  flushDeliveries,
  buildLeadCreatedPayload,
  destinationForAgent,
  externalIdForDestination,
  resolveLeadRouting,
  logger,
};

// ---------------------------------------------------------------------------
// Config + predicates
// ---------------------------------------------------------------------------

function intEnv(name, fallback, min) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return min != null ? Math.max(min, Math.floor(n)) : Math.floor(n);
}

/** Env snapshot for the screening feature. `configured` gates every dial. */
export function screeningConfig() {
  const enabled = String(process.env.RETELL_SCREENING_ENABLED || 'false').toLowerCase() === 'true';
  const agentId = (process.env.RETELL_SCREENING_AGENT_ID || '').trim();
  const fromNumber = (process.env.RETELL_SCREENING_FROM_NUMBER || '').trim();
  // Clamp campaign-adjacent values before they can reach an API body
  // (CLAUDE.md security rule — never pass raw config into a request).
  const agentOk = /^agent_[a-z0-9]{10,64}$/i.test(agentId);
  const fromOk = /^\+[1-9]\d{9,14}$/.test(fromNumber);
  return {
    enabled,
    agentId: agentOk ? agentId : null,
    fromNumber: fromOk ? fromNumber : null,
    configured: enabled && agentOk && fromOk && !!process.env.RETELL_API_KEY,
    dryRun: String(process.env.SCREENING_DRY_RUN || 'false').toLowerCase() === 'true',
    maxAttempts: intEnv('SCREENING_MAX_ATTEMPTS', 3, 1),
    retryMinutes: intEnv('SCREENING_RETRY_MINUTES', 120, 5),
    callWindow: (process.env.SCREENING_CALL_WINDOW || '10:00-20:00').trim(),
    maxConcurrent: intEnv('SCREENING_MAX_CONCURRENT', 3, 1),
    maxDialsPerDay: intEnv('SCREENING_MAX_DIALS_PER_DAY', 50, 1),
    staleCallMinutes: intEnv('SCREENING_STALE_CALL_MINUTES', 30, 5),
    maxHoldHours: intEnv('SCREENING_MAX_HOLD_HOURS', 24, 1),
    onUnreachable: String(process.env.SCREENING_ON_UNREACHABLE || 'release').toLowerCase() === 'hold' ? 'hold' : 'release',
    sweepIntervalMinutes: intEnv('SCREENING_SWEEP_INTERVAL_MINUTES', 5, 2),
  };
}

/**
 * Does the campaign's screening gate apply to this prospect-like object
 * (incoming capture payload or a loaded row)? Fail-safe OFF: an unreadable
 * design_config must never auto-dial (opposite of DNC's fail-enabled read —
 * plan §3.2). The verified-stamp requirement is the abuse fence: the public
 * create endpoint accepts raw unverified POSTs, and those must never trigger
 * a paid call (Codex #1); the stamp's phone binding also self-invalidates
 * after a staff phone edit (Codex #11).
 */
export function screeningApplies({ campaign, prospect }, cfg = screeningConfig()) {
  if (!cfg.configured) return false;
  if (!campaign || !prospect) return false;
  const design = readLegacyViewSafe(campaign.design_config, {});
  if (design.screeningCallAtSubmit !== true) return false;
  if (!prospect.phone) return false;
  if (prospect.leadSource === 'call_bot') return false;
  if (prospect.externalAgentId) return false;
  return phoneVerificationIsCurrent(prospect);
}

export { SCREENING_REASONS };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Merge evidence keys into screeningMetadata inside a fenced UPDATE. */
function metaMergeSql(column = '"screeningMetadata"') {
  return `${column} = COALESCE(${column}, '{}'::jsonb) || :metaPatch::jsonb`;
}

function screeningNotesAppend(kind, detail = {}) {
  const lines = [
    '',
    `--- AI Screening (${new Date().toISOString()}) ---`,
    kind === 'qualified'
      ? `Qualified: yes${detail.reason ? ` — ${detail.reason}` : ''}`
      : kind === 'not_qualified'
        ? `Qualified: no${detail.reason ? ` — ${detail.reason}` : ''}`
        : `Unreachable after ${detail.attempts ?? '?'} attempt(s)`,
  ];
  if (detail.summary) lines.push(String(detail.summary).slice(0, 2000));
  return lines.join('\n');
}

async function loadCampaignFor(prospect, d) {
  if (!prospect.campaignId) return null;
  return d.Campaign.findByPk(prospect.campaignId).catch(() => null);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function makeScreeningGate(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /**
   * DNC-clear handoff: dnc_pending → screening_pending (plan §6). Keeps
   * quarantinedAt (the total-hold TTL keeps running), seeds the evidence
   * bookkeeping from the DNC hold. Fence-lost (admin released meanwhile) ⇒
   * no-op. Caller (dncGate) fires the dial trigger on success.
   */
  async function transitionDncToScreening(prospect, { intendedAgentId = null, alreadyCharged = false } = {}) {
    const metaPatch = JSON.stringify({ intendedAgentId, alreadyCharged, attempts: {} });
    const [rows] = await d.sequelize.query(
      `UPDATE prospects
          SET "quarantineReason" = 'screening_pending',
              ${metaMergeSql()},
              "updatedAt" = NOW()
        WHERE id = :id AND "quarantineReason" = 'dnc_pending' AND "quarantinedAt" IS NOT NULL
        RETURNING id`,
      { replacements: { id: prospect.id, metaPatch } }
    );
    const transitioned = Array.isArray(rows) && rows.length > 0;
    if (transitioned) {
      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'updated',
        actorUserId: null,
        description: 'Held — DNC clear, pending AI screening call',
        metadata: { quarantined: true, reason: 'screening_pending', via: 'dnc_handoff' },
      }).catch(() => {});
      await prospect.reload().catch(() => {});
    }
    return { transitioned };
  }

  /**
   * Release a screened lead as its FIRST delivery (plan §9.2). One tx:
   * reason+verdict-scoped claim (with notes append + evidence merge riding the
   * same statement) → charge (authoritative for quota/priced campaigns, else
   * best-effort) → activity → in-tx outbox → commit → flush. Fail-closed:
   * `no_credit` / `no_subscriber` roll back the claim (stays held). Never throws.
   *
   * `unscreened: true` releases a verdict-less lead (unreachable policy /
   * drain) — fence flips to `screeningVerdict IS NULL` and the payload block
   * carries `unreachable: true`.
   */
  async function releaseScreenedLead({ prospect, unscreened = false, via = 'screening_qualified' }) {
    const meta = prospect.screeningMetadata || {};
    const campaign = await loadCampaignFor(prospect, d);

    let agentId = meta.intendedAgentId || null;
    if (!agentId && prospect.campaignId) {
      // Intended agent gone (deactivated, joined later, quota re-shuffle) —
      // re-resolve. Only a real funded route may receive the lead; the
      // System-Agent fallback would recreate the known delivery gap.
      const routing = await d.resolveLeadRouting({
        reqUser: null, requestedAgentId: null, campaignId: prospect.campaignId, qrTagId: null,
      }).catch(() => null);
      if (routing?.agentId && routing.via !== 'fallback') agentId = routing.agentId;
    }
    if (!agentId) {
      d.logger.warn('[Screening] release: no deliverable agent — left held', { prospectId: prospect.id });
      return { released: false, reason: 'no_intended_agent' };
    }

    const alreadyCharged = meta.alreadyCharged === true && meta.chargeRefunded !== true;
    const quotaEnforced = campaign?.enforceLeadQuota === true
      || (Number.isInteger(campaign?.leadPriceCents) && campaign.leadPriceCents > 0);

    const t = await d.sequelize.transaction();
    try {
      const verdictFence = unscreened ? `"screeningVerdict" IS NULL` : `"screeningVerdict" = 'qualified'`;
      const metaPatch = JSON.stringify(unscreened ? { unreachable: true } : {});
      const notesAppend = unscreened
        ? screeningNotesAppend('unreachable', { attempts: prospect.screeningAttemptCount })
        : screeningNotesAppend('qualified', meta.verdictDetail || {});
      const [claim] = await d.sequelize.query(
        `UPDATE prospects
            SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
                "quarantinedAt" = NULL, "quarantineReason" = NULL,
                "screeningNextAttemptAt" = NULL,
                notes = COALESCE(notes, '') || :notesAppend,
                ${metaMergeSql()},
                "updatedAt" = NOW()
          WHERE id = :id AND "quarantineReason" = 'screening_pending'
            AND "quarantinedAt" IS NOT NULL
            AND "screeningActiveCallId" IS NULL
            AND ${verdictFence}
          RETURNING id`,
        { replacements: { agentId, id: prospect.id, notesAppend, metaPatch }, transaction: t }
      );
      if (!Array.isArray(claim) || claim.length === 0) {
        await t.rollback();
        return { released: false, reason: 'lost_claim' };
      }

      if (!alreadyCharged) {
        if (quotaEnforced) {
          const charged = await d.chargeLeadCredit(agentId, prospect.campaignId || null, t);
          if (!charged) {
            await t.rollback();
            d.logger.warn('[Screening] release: agent has no credit — re-holding', { prospectId: prospect.id, agentId });
            return { released: false, reason: 'no_credit' };
          }
        } else {
          await d.deductLeadCredit({ agentId, campaignId: prospect.campaignId || null, transaction: t })
            .catch((err) => d.logger.error('[Screening] best-effort deduct failed', { error: err?.message || String(err) }));
        }
      }

      await d.ProspectActivity.create(
        {
          prospectId: prospect.id,
          type: 'assigned',
          actorUserId: null,
          description: unscreened
            ? `Released unscreened (${via}) and assigned to agent ${agentId}`
            : `Released after AI screening (qualified) and assigned to agent ${agentId}`,
          metadata: { assignedAgentId: agentId, released: true, via },
        },
        { transaction: t }
      );

      const agent = await d.User.findByPk(agentId, {
        attributes: ['id', 'lyfeId', 'mktrLeadsId', 'phone', 'email', 'firstName', 'lastName'],
        transaction: t,
      });
      const destination = agent ? d.destinationForAgent(agent) : null;
      const agentForWebhook = agent
        ? {
            phone: agent.phone || null,
            email: agent.email || null,
            name: `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
            id: d.externalIdForDestination(agent, destination),
          }
        : null;
      const withCampaign = await d.Prospect.findByPk(prospect.id, {
        include: [{ association: 'campaign', attributes: ['id', 'name'] }],
        transaction: t,
      });

      const deliveryPairs = await d.persistEventDeliveries(
        'lead.created',
        () => d.buildLeadCreatedPayload(withCampaign, 'direct', agentForWebhook, agentId, withCampaign?.campaign || null, null, null),
        { destination },
        t
      );
      if (!deliveryPairs || deliveryPairs.length === 0) {
        await t.rollback();
        d.logger.warn('[Screening] release: no delivery subscriber — re-holding', { prospectId: prospect.id, destination });
        return { released: false, reason: 'no_subscriber' };
      }

      await t.commit();
      d.flushDeliveries(deliveryPairs);
      await prospect.reload().catch(() => {});
      d.logger.info('[Screening] lead released', { prospectId: prospect.id, agentId, unscreened, via });
      return { released: true, agentId };
    } catch (err) {
      await t.rollback().catch(() => {});
      d.logger.error('[Screening] release failed', { prospectId: prospect.id, error: err?.message || String(err) });
      return { released: false, error: err?.message };
    }
  }

  /**
   * Pin a qualified verdict (fenced on the CURRENT attempt's call id) and try
   * to release. Release failure leaves the row pending+qualified — sweep job 1
   * retries delivery; TTL routes it to release, never unreachable (plan §9.1).
   */
  async function applyQualifiedVerdict(prospect, { callId, detail = {} }) {
    const metaPatch = JSON.stringify({ verdictDetail: { ...detail, callId, decidedAt: new Date().toISOString() } });
    const [rows] = await d.sequelize.query(
      `UPDATE prospects
          SET "screeningVerdict" = 'qualified',
              "screeningActiveCallId" = NULL,
              "screeningNextAttemptAt" = NULL,
              ${metaMergeSql()},
              "updatedAt" = NOW()
        WHERE id = :id AND "quarantineReason" = 'screening_pending'
          AND "screeningActiveCallId" = :callId
        RETURNING id`,
      { replacements: { id: prospect.id, callId, metaPatch } }
    );
    if (!Array.isArray(rows) || rows.length === 0) return { outcome: 'stale', applied: false };
    await prospect.reload().catch(() => {});
    const rel = await releaseScreenedLead({ prospect });
    return { outcome: rel.released ? 'released' : 'qualified_pending_delivery', applied: true, release: rel };
  }

  /**
   * Not-qualified verdict → terminal `screening_failed` + credit refund when
   * the capture charged (plan §9.3). This is the product outcome: the lead
   * stays in MKTR's held queue and never reaches an agent.
   */
  async function markScreeningFailed(prospect, { callId, detail = {} }) {
    const meta = prospect.screeningMetadata || {};
    const needsRefund = meta.alreadyCharged === true && meta.chargeRefunded !== true && !!meta.intendedAgentId;
    const t = await d.sequelize.transaction();
    try {
      const metaPatch = JSON.stringify({
        verdictDetail: { ...detail, callId, decidedAt: new Date().toISOString() },
        ...(needsRefund ? { chargeRefunded: true } : {}),
      });
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "quarantineReason" = 'screening_failed',
                "screeningVerdict" = 'not_qualified',
                "screeningActiveCallId" = NULL,
                "screeningNextAttemptAt" = NULL,
                notes = COALESCE(notes, '') || :notesAppend,
                ${metaMergeSql()},
                "updatedAt" = NOW()
          WHERE id = :id AND "quarantineReason" = 'screening_pending'
            AND "screeningActiveCallId" = :callId
          RETURNING id`,
        {
          replacements: {
            id: prospect.id,
            callId,
            metaPatch,
            notesAppend: screeningNotesAppend('not_qualified', detail),
          },
          transaction: t,
        }
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await t.rollback();
        return { outcome: 'stale', applied: false };
      }

      if (needsRefund) {
        await d.refundLeadCredit(meta.intendedAgentId, prospect.campaignId || null, t);
      }

      await d.ProspectActivity.create(
        {
          prospectId: prospect.id,
          type: 'updated',
          actorUserId: null,
          description: `Held — AI screening: not qualified${detail.reason ? ` (${String(detail.reason).slice(0, 140)})` : ''}`,
          metadata: { quarantined: true, reason: 'screening_failed', callId, refunded: needsRefund },
        },
        { transaction: t }
      );

      await t.commit();
      await prospect.reload().catch(() => {});
      d.logger.info('[Screening] lead failed screening — held', { prospectId: prospect.id, callId, refunded: needsRefund });
      return { outcome: 'failed', applied: true };
    } catch (err) {
      await t.rollback().catch(() => {});
      d.logger.error('[Screening] markScreeningFailed error', { prospectId: prospect.id, error: err?.message || String(err) });
      return { outcome: 'error', applied: false };
    }
  }

  /**
   * Attempts/TTL exhausted with no verdict (plan §9.4). `release` policy ⇒
   * deliver unscreened; `hold` ⇒ terminal `screening_unreachable` + refund.
   * Qualified rows never come here (sweep routes them to release).
   */
  async function applyUnreachablePolicy(prospect, { via = 'screening_unreachable', cfg = screeningConfig() } = {}) {
    if (cfg.onUnreachable === 'release') {
      const rel = await releaseScreenedLead({ prospect, unscreened: true, via });
      return { outcome: rel.released ? 'released_unscreened' : 'held', release: rel };
    }

    const meta = prospect.screeningMetadata || {};
    const needsRefund = meta.alreadyCharged === true && meta.chargeRefunded !== true && !!meta.intendedAgentId;
    const t = await d.sequelize.transaction();
    try {
      const metaPatch = JSON.stringify({ unreachable: true, ...(needsRefund ? { chargeRefunded: true } : {}) });
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "quarantineReason" = 'screening_unreachable',
                "screeningActiveCallId" = NULL,
                "screeningNextAttemptAt" = NULL,
                notes = COALESCE(notes, '') || :notesAppend,
                ${metaMergeSql()},
                "updatedAt" = NOW()
          WHERE id = :id AND "quarantineReason" = 'screening_pending'
            AND "screeningActiveCallId" IS NULL
            AND "screeningVerdict" IS NULL
          RETURNING id`,
        {
          replacements: {
            id: prospect.id,
            metaPatch,
            notesAppend: screeningNotesAppend('unreachable', { attempts: prospect.screeningAttemptCount }),
          },
          transaction: t,
        }
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await t.rollback();
        return { outcome: 'stale' };
      }
      if (needsRefund) {
        await d.refundLeadCredit(meta.intendedAgentId, prospect.campaignId || null, t);
      }
      await d.ProspectActivity.create(
        {
          prospectId: prospect.id,
          type: 'updated',
          actorUserId: null,
          description: `Held — AI screening: unreachable after ${prospect.screeningAttemptCount} attempt(s)`,
          metadata: { quarantined: true, reason: 'screening_unreachable', refunded: needsRefund },
        },
        { transaction: t }
      );
      await t.commit();
      await prospect.reload().catch(() => {});
      d.logger.info('[Screening] lead unreachable — held', { prospectId: prospect.id });
      return { outcome: 'held_unreachable' };
    } catch (err) {
      await t.rollback().catch(() => {});
      d.logger.error('[Screening] applyUnreachablePolicy error', { prospectId: prospect.id, error: err?.message || String(err) });
      return { outcome: 'error' };
    }
  }

  return {
    transitionDncToScreening,
    releaseScreenedLead,
    applyQualifiedVerdict,
    markScreeningFailed,
    applyUnreachablePolicy,
  };
}

// --- Backward-compatible default-wired exports (house pattern) ---
const _default = makeScreeningGate();
export const transitionDncToScreening = _default.transitionDncToScreening;
export const releaseScreenedLead = _default.releaseScreenedLead;
export const applyQualifiedVerdict = _default.applyQualifiedVerdict;
export const markScreeningFailed = _default.markScreeningFailed;
export const applyUnreachablePolicy = _default.applyUnreachablePolicy;
