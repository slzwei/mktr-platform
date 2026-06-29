import { sequelize, Prospect, ProspectActivity, User } from '../models/index.js';
import { chargeLeadCredit } from './leadCredits.js';
import { persistEventDeliveries, flushDeliveries } from './webhookService.js';
import { buildLeadCreatedPayload, destinationForAgent, externalIdForDestination } from './prospectHelpers.js';
import { checkAndRecord as dncCheckAndRecord } from './dncService.js';
import { logger } from '../utils/logger.js';

/**
 * dncGate — the "born-held-pending, release-on-clear" state machine for the create path.
 * Design: docs/plans/dnc-scrubbing.md §5.3–§5.5. Modeled on releaseSweep.js (atomic
 * reason-scoped claim + in-tx authoritative charge + persistEventDeliveries outbox + flush),
 * NOT assignProspect (whose release claim is reason-blind and would misfire lead.assigned).
 */

const defaultDeps = {
  sequelize,
  Prospect,
  ProspectActivity,
  User,
  chargeLeadCredit,
  persistEventDeliveries,
  flushDeliveries,
  buildLeadCreatedPayload,
  destinationForAgent,
  externalIdForDestination,
  checkAndRecord: dncCheckAndRecord,
  logger,
  // Injectable so gateHeldDncLead can be unit-tested without the release tx (the real
  // function is hoisted and bound below).
  releaseDncClearedLead: (...args) => releaseDncClearedLead(...args),
};

/**
 * Release a lead that was held `dnc_pending` and has now come back deliverable, assigning it
 * to `agentId` and firing its FIRST lead.created. One transaction: a reason-scoped atomic
 * claim (so a concurrent release/backfill can't deliver twice), an authoritative charge
 * (rolled back → re-held if the agent has no credit, unless already charged at capture),
 * and the delivery row persisted in the SAME tx (crash-safe outbox). Never throws.
 */
export async function releaseDncClearedLead({ prospect, agentId, alreadyCharged = false }, overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  if (!agentId) {
    d.logger.warn('[DNC] cleared lead has no intended agent — left held for backfill/admin', { prospectId: prospect.id });
    return { released: false, reason: 'no_intended_agent' };
  }

  const t = await d.sequelize.transaction();
  try {
    // Atomic, reason-scoped claim — the 'dnc_pending' scope IS the fence (assignProspect's
    // claim is reason-blind, so we don't reuse it).
    const [claim] = await d.sequelize.query(
      `UPDATE prospects
          SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
              "quarantinedAt" = NULL, "quarantineReason" = NULL, "updatedAt" = NOW()
        WHERE id = :id AND "quarantineReason" = 'dnc_pending' AND "quarantinedAt" IS NOT NULL
        RETURNING id`,
      { replacements: { agentId, id: prospect.id }, transaction: t }
    );
    if (!Array.isArray(claim) || claim.length === 0) {
      await t.rollback();
      return { released: false, reason: 'lost_claim' };
    }

    // Authoritative charge (skip if capture-time decideAssignment already charged this lead).
    if (!alreadyCharged) {
      const charged = await d.chargeLeadCredit(agentId, prospect.campaignId || null, t);
      if (!charged) {
        await t.rollback();
        d.logger.warn('[DNC] release: agent has no credit — re-holding', { prospectId: prospect.id, agentId });
        return { released: false, reason: 'no_credit' };
      }
    }

    await d.ProspectActivity.create(
      {
        prospectId: prospect.id,
        type: 'assigned',
        actorUserId: null,
        description: `Released after DNC clear and assigned to agent ${agentId}`,
        metadata: { assignedAgentId: agentId, released: true, via: 'dnc_clear' },
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

    // Persist the first lead.created delivery INSIDE the tx (outbox) so a crash after commit
    // can't strand a released, charged lead that was never queued.
    const deliveryPairs = await d.persistEventDeliveries(
      'lead.created',
      () => d.buildLeadCreatedPayload(withCampaign, 'direct', agentForWebhook, agentId, withCampaign?.campaign || null, null, null),
      { destination },
      t
    );
    // Fail closed: never release a CHARGED lead we can't durably deliver.
    if (!deliveryPairs || deliveryPairs.length === 0) {
      await t.rollback();
      d.logger.warn('[DNC] release: no delivery subscriber — re-holding', { prospectId: prospect.id, destination });
      return { released: false, reason: 'no_subscriber' };
    }

    await t.commit();
    d.flushDeliveries(deliveryPairs);
    await prospect.reload().catch(() => {});
    return { released: true };
  } catch (err) {
    await t.rollback().catch(() => {});
    d.logger.error('[DNC] release failed', { prospectId: prospect.id, error: err?.message || String(err) });
    return { released: false, error: err?.message };
  }
}

/**
 * Post-commit gate for a lead born held `dnc_pending`. Runs the DNC check, then:
 *   - clear, OR registered but voice-clear → release to the intended agent (first lead.created)
 *   - registered on voice → keep held, relabel `dnc_registered`
 *   - pending/error → stays `dnc_pending`; the backfill retries.
 * Never throws. Returns { outcome: 'released'|'held', status }.
 */
export async function gateHeldDncLead(prospect, overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  // Captured BEFORE checkAndRecord overwrites dncMetadata with the result blob.
  const intendedAgentId = prospect.dncMetadata?.intendedAgentId || null;
  const alreadyCharged = prospect.dncMetadata?.alreadyCharged === true;

  let result;
  try {
    result = await d.checkAndRecord(prospect);
  } catch (err) {
    d.logger.error('[DNC] gate check failed (left held)', { prospectId: prospect.id, error: err?.message || String(err) });
    return { outcome: 'held', status: 'error' };
  }

  // Voice is the channel agents use; registered-on-voice is the block trigger. A lead
  // registered only on text/fax (voice clear) is still deliverable, with flags in the payload.
  const deliver = result.status === 'clear' || (result.status === 'registered' && !result.noVoiceCall);
  if (deliver) {
    const rel = await d.releaseDncClearedLead({ prospect, agentId: intendedAgentId, alreadyCharged }, overrides);
    return { outcome: rel.released ? 'released' : 'held', status: result.status, release: rel };
  }
  if (result.status === 'registered') {
    await prospect.update({ quarantineReason: 'dnc_registered' }).catch(() => {});
    d.logger.info('[DNC] lead held — registered on the no-voice-call register', { prospectId: prospect.id });
    return { outcome: 'held', status: 'registered' };
  }
  // pending / error → leave dnc_pending for the backfill to retry.
  return { outcome: 'held', status: result.status };
}

export default { releaseDncClearedLead, gateHeldDncLead };
