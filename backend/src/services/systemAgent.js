import dotenv from 'dotenv';
import { User, QrTag, RoundRobinCursor, LeadPackageAssignment, LeadPackage, ExternalAgent, ExternalCampaignAgent, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../utils/logger.js';
import { pickFromRing } from './leadRing.js';

// In-process queue to serialize round-robin updates per campaign (prevents race conditions)
const rrQueues = new Map();
export function enqueueCampaign(campaignId, task) {
  const prior = rrQueues.get(campaignId) || Promise.resolve();
  // The caller sees the task's real outcome (rejections propagate)…
  const chain = prior.then(task);
  // …the STORED tail swallows them so the next enqueue still runs…
  const tail = chain.catch(() => { });
  // …and cleanup compares the EXACT object stored. M9: the old code stored
  // chain.catch(...) while finally compared against `chain` — two different
  // Promise objects, so the equality was ALWAYS false and every campaign ever
  // routed left a settled entry in this process-global Map until restart.
  const entry = tail.finally(() => {
    if (rrQueues.get(campaignId) === entry) rrQueues.delete(campaignId);
  });
  rrQueues.set(campaignId, entry);
  return chain;
}

/** Test seam (M9): the queue map must drain back to empty once tasks settle. */
export const rrQueueSize = () => rrQueues.size;

dotenv.config();

let cachedSystemAgentId = null;

export async function initSystemAgent() {
  if (cachedSystemAgentId) return cachedSystemAgentId;

  const defaultAgentId = process.env.DEFAULT_AGENT_ID || null;
  const systemEmail = process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local';

  // If DEFAULT_AGENT_ID provided, validate and use it
  if (defaultAgentId) {
    const existing = await User.findOne({ where: { id: defaultAgentId, role: 'agent', isActive: true } });
    if (existing) {
      cachedSystemAgentId = existing.id;
      return cachedSystemAgentId;
    }
    logger.warn('DEFAULT_AGENT_ID provided but not a valid active agent — falling back to SYSTEM_AGENT_EMAIL');
  }

  // Find or create by email
  let systemAgent = await User.findOne({ where: { email: systemEmail } });
  if (!systemAgent) {
    systemAgent = await User.create({
      email: systemEmail,
      firstName: 'System',
      lastName: 'Agent',
      fullName: 'System Agent',
      role: 'agent',
      isActive: true,
      emailVerified: true
    });
  } else if (systemAgent.role !== 'agent' || !systemAgent.isActive) {
    await systemAgent.update({ role: 'agent', isActive: true });
  }

  cachedSystemAgentId = systemAgent.id;
  return cachedSystemAgentId;
}

export async function getSystemAgentId() {
  if (cachedSystemAgentId) return cachedSystemAgentId;
  return initSystemAgent();
}

/**
 * Resolve a lead's agent AND report which route chose it, so lead-quota enforcement
 * can tell an exempt route (authenticated self / admin-explicit) from a gated route
 * (qr / package / fallback).
 *
 * Returns { agentId, via } with via ∈ 'self' | 'admin' | 'qr' | 'package' | 'fallback'.
 * 'fallback' means nothing matched and agentId is the System Agent (or DEFAULT_AGENT_ID).
 *
 * P4-9: a thin wrapper over resolveLeadAssignment with allowExternal=false —
 * the tiers were a near-verbatim copy that had started to drift. With the
 * external pool off, the resolver never queries external tables, the ring is
 * internal-only (pickFromRing's index === the old `(cursor-1) % len`), and
 * the 'hold' branch is unreachable — selection is identical by construction.
 */
export async function resolveLeadRouting({ reqUser, requestedAgentId, campaignId, qrTagId }) {
  const r = await resolveLeadAssignment({ reqUser, requestedAgentId, campaignId, qrTagId, allowExternal: false });
  return { agentId: r.internalAgentId, via: r.via };
}

/**
 * Cross-pool assignment resolver (Phase 0.7). Like resolveLeadRouting, but
 * the campaign round-robin spans BOTH internal Lyfe agents (lead packages) AND
 * external buyers (eligible for the campaign with leadBalance > 0). Returns a
 * tagged result so the caller knows which table the assignee lives in — which
 * also drives webhook destination (internal -> Lyfe app, external -> MKTR Leads).
 *
 * THE single tier implementation (P4-9): resolveLeadRouting wraps this with
 * allowExternal=false, so the tiers exist exactly once.
 *
 * `allowExternal` MUST be computed by the caller as
 *   (campaign.externalEligible === true) && hasValidExternalConsent(prospect)
 * and defaults to false. When false the external pool is not even queried, so
 * the resolver is byte-for-byte internal-only. This is the fail-safe that keeps
 * the live pipeline unchanged unless a caller opts a consented,
 * external-eligible lead in (createProspect does; retell/meta/sweeps do not).
 *
 * Every return also carries `via` (self | admin | qr | package | external | fallback)
 * so the caller threads a consistent route label into the lead-quota gate.
 *
 *   returns { kind: 'internal', internalAgentId, via } | { kind: 'external', externalAgentId, via }
 *
 * DELIBERATE tier-3 scope (P4-9 drift decision): the QR tier here covers only
 * direct assignedAgentId/ownerUserId. QR round-robin GROUPS and the legacy
 * assignedAgentPhone fallback live in createProspect's PRE-resolver QR-override
 * block, and that is the CORRECT home: only form/QR captures carry a qrTagId
 * (retell/meta/sweep callers pass qrTagId:null, so the richer QR handling is
 * vacuous for them), and the override must run before quota/consent gating.
 * NOTE (external-activation parity, docs/plans/MKTR_LEADS_ACTIVATION_PLAN.md):
 * since createProspect skips that block for external-eligible leads, QR
 * round-robin/phone routing must be folded into this resolver (or the block
 * re-enabled per-tier) before external-QR goes live. Likewise an
 * external-eligible campaign with no funded buyer HOLDs (W1b), never delivers
 * internally.
 */
export async function resolveLeadAssignment({ reqUser, requestedAgentId, campaignId, qrTagId, allowExternal = false }) {
  // 1) Requester is an agent → self-assign (internal)
  if (reqUser && reqUser.role === 'agent') {
    return { kind: 'internal', internalAgentId: reqUser.id, via: 'self' };
  }

  // 2) Admin-requested explicit agent (internal)
  if (reqUser && reqUser.role === 'admin' && requestedAgentId) {
    const valid = await User.findOne({ where: { id: requestedAgentId, role: 'agent', isActive: true } });
    if (valid) return { kind: 'internal', internalAgentId: valid.id, via: 'admin' };
  }

  // 3) QR directly assigned to an internal agent
  if (qrTagId) {
    const qr = await QrTag.findByPk(qrTagId);
    const candidateId = qr?.assignedAgentId || qr?.ownerUserId;
    if (candidateId) {
      const agent = await User.findOne({ where: { id: candidateId, role: 'agent', isActive: true } });
      if (agent) return { kind: 'internal', internalAgentId: agent.id, via: 'qr' };
    }
  }

  // 4) Unified round-robin across internal lead-package agents + external buyers
  if (campaignId) {
    const assignments = await LeadPackageAssignment.findAll({
      where: { status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      include: [{ model: LeadPackage, as: 'package', where: { campaignId }, required: true, attributes: [] }],
      attributes: ['agentId'],
    });
    const internalCandidateIds = [...new Set(assignments.map((a) => a.agentId))];
    const internalActive = internalCandidateIds.length
      ? (await User.findAll({
          where: { id: internalCandidateIds, role: 'agent', isActive: true },
          attributes: ['id'],
          order: [['createdAt', 'ASC']],
        })).map((u) => u.id)
      : [];

    // External pool is queried ONLY when the caller opted this consented,
    // external-eligible lead in. Default (false) => internal-only resolver.
    let externalActive = [];
    if (allowExternal) {
      const extLinks = await ExternalCampaignAgent.findAll({
        where: { campaignId, isActive: true },
        include: [{
          model: ExternalAgent,
          as: 'externalAgent',
          where: { isActive: true, leadBalance: { [Op.gt]: 0 } },
          required: true,
          attributes: ['id', 'createdAt'],
        }],
      });
      externalActive = extLinks
        .map((l) => l.externalAgent)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((a) => a.id);
    }

    const ring = [
      ...internalActive.map((id) => ({ kind: 'internal', internalAgentId: id, via: 'package' })),
      ...externalActive.map((id) => ({ kind: 'external', externalAgentId: id, via: 'external' })),
    ];

    if (ring.length > 0) {
      const selected = await enqueueCampaign(campaignId, async () => {
        // campaignId is UNIQUE on round_robin_cursor, so findOrCreate is race-safe.
        await RoundRobinCursor.findOrCreate({ where: { campaignId }, defaults: { campaignId, cursor: 0 } });
        const [, [updated]] = await RoundRobinCursor.update(
          { cursor: sequelize.literal('"cursor" + 1') },
          { where: { campaignId }, returning: true }
        );
        const nextCursor = updated?.cursor ?? 1;
        return pickFromRing(ring, nextCursor);
      });
      if (selected) return selected;
    }
  }

  // 5) Fallback. For an external-eligible (allowExternal) lead with no funded buyer AND
  //    no funded internal pool agent, HOLD it — never hand a monetized, consented lead to
  //    the free System Agent (plan §0.7). The caller quarantines it; the internal release
  //    sweep is fenced off from these holds. Internal-only callers (allowExternal=false,
  //    e.g. resolveAssignedAgentId/retell/meta) keep the System-Agent fallback unchanged.
  if (allowExternal) {
    return { kind: 'hold', via: 'fallback', holdReason: 'no_funded_external_buyer' };
  }
  const systemId = await getSystemAgentId();
  return { kind: 'internal', internalAgentId: systemId, via: 'fallback' };
}


