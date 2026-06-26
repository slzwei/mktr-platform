import { Op } from 'sequelize';
import { Prospect, ProspectActivity, Campaign, User, sequelize } from '../models/index.js';
import { resolveLeadRouting } from './systemAgent.js';
import { chargeLeadCredit } from './leadCredits.js';
import { persistEventDeliveries, flushDeliveries } from './webhookService.js';
import { buildLeadCreatedPayload, destinationForAgent, externalIdForDestination } from './prospectHelpers.js';
import { logger } from '../utils/logger.js';

/**
 * Auto-release sweep for lead-quota held queues.
 *
 * When an agent's credits increase (package assigned / topped up), the held queue for
 * that campaign is drained FIFO (oldest quarantinedAt first), releasing leads to funded
 * agents and charging AUTHORITATIVELY until credits run out — so it only releases as far
 * as the credits stretch (unlike a manual admin release, which is best-effort).
 *
 * Each release is one transaction: the prospect is CLAIMED with a conditional UPDATE
 * (idempotent — a concurrent sweep / double-click can't release twice) and charged in the
 * SAME tx. If the charge fails (credits exhausted) the claim is rolled back (the lead stays
 * held) and the sweep stops. lead.created fires post-commit as the lead's first delivery
 * to Lyfe (it never saw the suppressed create webhook).
 */

const defaultDeps = {
  Prospect, ProspectActivity, Campaign, User, sequelize,
  resolveLeadRouting, chargeLeadCredit, persistEventDeliveries, flushDeliveries,
  buildLeadCreatedPayload, destinationForAgent, externalIdForDestination, logger,
};

// Safety bound so a single sweep can never loop unboundedly.
const MAX_RELEASE_PER_SWEEP = 500;

// A lead that signed up more than this many days ago is NEVER auto-released to an
// agent — it must wait in the admin dispatch queue for a human to decide. (A stale
// lead must not silently buzz an agent as if it were fresh.) The dispatch queue
// surfaces these with NO age cap, so nothing is lost — only the *automatic* path is gated.
const AUTO_RELEASE_MAX_AGE_DAYS = 7;

export function makeReleaseSweep(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  async function sweepCampaign(campaignId) {
    if (!campaignId) return 0;

    // Only quota-enforced campaigns ever hold leads; skip everything else cheaply.
    const campaign = await d.Campaign.findByPk(campaignId);
    if (!campaign || campaign.enforceLeadQuota !== true) return 0;

    // Only auto-release leads that are still FRESH; stale ones wait for the admin.
    const freshCutoff = new Date(Date.now() - AUTO_RELEASE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    let released = 0;
    for (let i = 0; i < MAX_RELEASE_PER_SWEEP; i++) {
      // Oldest held lead for this campaign (FIFO). Only INTERNAL lead-quota holds
      // (quarantineReason 'no_funded_agent') are eligible — external holds
      // ('no_funded_external_buyer') must NEVER be released to Lyfe by this internal
      // sweep; they can only ever be delivered via the external (MKTR Leads) channel.
      // Stale leads (signed up before freshCutoff) are skipped — they must be dispatched
      // by an admin from the queue, never auto-released here.
      const held = await d.Prospect.findOne({
        where: {
          campaignId,
          quarantinedAt: { [Op.ne]: null },
          quarantineReason: 'no_funded_agent',
          createdAt: { [Op.gt]: freshCutoff },
        },
        order: [['quarantinedAt', 'ASC']],
      });
      if (!held) break; // no fresh held leads left to auto-release

      // Pick a funded agent (round-robin among campaign package agents with credits).
      const routing = await d.resolveLeadRouting({ reqUser: null, requestedAgentId: null, campaignId, qrTagId: null });
      if (!routing.agentId || routing.via !== 'package') break; // no funded agent → stop

      const agentId = routing.agentId;
      const t = await d.sequelize.transaction();
      let didRelease = false;
      let deliveryPairs = [];
      try {
        // Atomic claim — exactly one releaser wins this held prospect.
        const [claimRows] = await d.sequelize.query(
          `UPDATE prospects
              SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
                  "quarantinedAt" = NULL, "quarantineReason" = NULL, "updatedAt" = NOW()
            WHERE id = :prospectId AND "quarantinedAt" IS NOT NULL
            RETURNING id`,
          { replacements: { agentId, prospectId: held.id }, transaction: t }
        );
        if (!Array.isArray(claimRows) || claimRows.length === 0) {
          await t.rollback();
          continue; // someone else released it; try the next held lead
        }
        // Authoritative charge in the SAME tx; on failure roll back the claim (re-hold).
        const charged = await d.chargeLeadCredit(agentId, campaignId, t);
        if (!charged) {
          await t.rollback();
          break; // credits exhausted — stop the sweep
        }

        await d.ProspectActivity.create({
          prospectId: held.id,
          type: 'assigned',
          actorUserId: null,
          description: 'Auto-released from hold (lead-quota top-up) and assigned',
          metadata: { assignedAgentId: agentId, released: true, via: 'auto_sweep' },
        }, { transaction: t });

        // Destination-aware delivery: load the agent's provenance (lyfeId AND
        // mktrLeadsId) so the lead.created routes to the agent's OWN app with the
        // correct external id — NOT a legacy event-type broadcast to every subscriber,
        // which would leak a mktr-leads lead's PII to Lyfe and carry the wrong id.
        const agent = await d.User.findByPk(agentId, {
          attributes: ['id', 'lyfeId', 'mktrLeadsId', 'phone', 'email', 'firstName', 'lastName'],
          transaction: t,
        });
        const destination = agent ? d.destinationForAgent(agent) : null;
        const agentForWebhook = agent ? {
          phone: agent.phone || null,
          email: agent.email || null,
          name: `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
          id: d.externalIdForDestination(agent, destination),
        } : null;
        const withCampaign = await d.Prospect.findByPk(held.id, {
          include: [{ association: 'campaign', attributes: ['id', 'name'] }],
          transaction: t,
        });

        // Persist the first lead.created delivery row INSIDE the tx (outbox) so a
        // crash after commit can't strand a released, charged lead that was never queued.
        deliveryPairs = await d.persistEventDeliveries(
          'lead.created',
          () => d.buildLeadCreatedPayload(withCampaign, 'direct', agentForWebhook, agentId, withCampaign?.campaign || null, null, null),
          { destination },
          t
        );
        // Fail closed: never release a CHARGED lead we cannot durably deliver. No
        // subscriber for this destination (or webhooks disabled) → roll back the
        // claim + charge (re-hold) and stop; every lead here would hit the same wall.
        if (deliveryPairs.length === 0) {
          await t.rollback();
          d.logger.warn('[ReleaseSweep] no delivery subscriber — re-holding', { campaignId, prospectId: held.id, destination });
          break;
        }

        await t.commit();
        didRelease = true;
      } catch (err) {
        await t.rollback().catch(() => {});
        d.logger.error('[ReleaseSweep] release failed', { campaignId, prospectId: held.id, error: err?.message || String(err) });
        break;
      }

      if (didRelease) {
        released++;
        d.flushDeliveries(deliveryPairs);
      }
    }

    if (released > 0) d.logger.info('[ReleaseSweep] released held leads', { campaignId, released });
    return released;
  }

  /** Periodic backstop: sweep every quota campaign that currently has held leads. */
  async function sweepAll() {
    // Only consider campaigns with at least one FRESH held lead; campaigns whose holds
    // are all stale have nothing auto-releasable (those wait for an admin to dispatch).
    const freshCutoff = new Date(Date.now() - AUTO_RELEASE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const rows = await d.Prospect.findAll({
      attributes: ['campaignId'],
      // Internal lead-quota holds only — external holds are not releasable here.
      where: {
        quarantinedAt: { [Op.ne]: null },
        quarantineReason: 'no_funded_agent',
        campaignId: { [Op.ne]: null },
        createdAt: { [Op.gt]: freshCutoff },
      },
      group: ['campaignId'],
    });
    let total = 0;
    for (const r of rows) {
      try {
        total += await sweepCampaign(r.campaignId);
      } catch (err) {
        d.logger.warn('[ReleaseSweep] sweepAll: campaign failed', { campaignId: r.campaignId, error: err?.message });
      }
    }
    return total;
  }

  return { sweepCampaign, sweepAll };
}

const _default = makeReleaseSweep();
export const sweepCampaign = _default.sweepCampaign;
export const sweepAll = _default.sweepAll;
