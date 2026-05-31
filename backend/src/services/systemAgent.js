import dotenv from 'dotenv';
import { User, QrTag, RoundRobinCursor, LeadPackageAssignment, LeadPackage, ExternalAgent, ExternalCampaignAgent, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../utils/logger.js';
import { pickFromRing } from './leadRing.js';

// In-process queue to serialize round-robin updates per campaign (prevents race conditions)
const rrQueues = new Map();
function enqueueCampaign(campaignId, task) {
  const chain = (rrQueues.get(campaignId) || Promise.resolve())
    .then(task)
    .finally(() => {
      // Clear queue when this task finishes if it's still the last one
      if (rrQueues.get(campaignId) === chain) rrQueues.delete(campaignId);
    });
  rrQueues.set(campaignId, chain.catch(() => { }));
  return chain;
}

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

async function findFirstActiveAgentByIds(candidateIds = []) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) return null;
  const users = await User.findAll({ where: { id: candidateIds, role: 'agent', isActive: true } });
  const byId = new Set(candidateIds);
  // preserve order from candidateIds
  for (const id of candidateIds) {
    const found = users.find(u => u.id === id);
    if (found) return found.id;
  }
  return null;
}

export async function resolveAssignedAgentId({ reqUser, requestedAgentId, campaignId, qrTagId }) {
  // 1) If requester is an agent, they self-assign
  if (reqUser && reqUser.role === 'agent') {
    return reqUser.id;
  }

  // 2) If requester is admin and provided a valid active agent, accept it
  if (reqUser && reqUser.role === 'admin' && requestedAgentId) {
    const valid = await User.findOne({ where: { id: requestedAgentId, role: 'agent', isActive: true } });
    if (valid) return valid.id;
  }

  // 3) Try the agent the QR is directly assigned to (admin sets this via
  //    the QR edit/create form: agentAssignmentMode='direct' + assignedAgent*).
  //    Prefer `assignedAgentId` (the field the admin UI actually writes).
  //    Fall back to `ownerUserId` for legacy QRs created before
  //    assignedAgentId was dual-written from the resolved phone match.
  if (qrTagId) {
    const qr = await QrTag.findByPk(qrTagId);
    const candidateId = qr?.assignedAgentId || qr?.ownerUserId;
    if (candidateId) {
      const agent = await User.findOne({ where: { id: candidateId, role: 'agent', isActive: true } });
      if (agent) return agent.id;
    }
  }

  // 4) Try active Lead Package Assignments with round-robin rotation
  // This REPLACES the old manual 'assigned_agents' list.
  // Agents are only in the pool if they have a purchased package for this campaign with leads remaining.
  if (campaignId) {
    // Find all active assignments for this campaign with credits > 0
    const assignments = await LeadPackageAssignment.findAll({
      where: {
        status: 'active',
        leadsRemaining: { [Op.gt]: 0 }
      },
      include: [{
        model: LeadPackage,
        as: 'package',
        where: { campaignId },
        required: true,
        attributes: [] // Only need filtering
      }],
      attributes: ['agentId']
    });

    const candidateIds = [...new Set(assignments.map(a => a.agentId))];

    if (candidateIds.length > 0) {
      // Filter to active agents only
      const activeAgents = (await User.findAll({
        where: { id: candidateIds, role: 'agent', isActive: true },
        attributes: ['id'],
        order: [['createdAt', 'ASC']]
      })).map(u => u.id);

      if (activeAgents.length > 0) {
        // Round-robin via a per-campaign MONOTONIC counter. The increment is a
        // single atomic `UPDATE ... RETURNING` — correct under concurrent
        // webhooks AND multiple backend instances. Modulo is applied only at
        // READ time, so rotation stays fair when the agent roster grows/shrinks
        // (storing the modulo'd value would pin the cursor to the smallest
        // roster ever seen and starve later-added agents). enqueueCampaign still
        // serializes in-process to reduce contention, but correctness no longer
        // depends on it.
        const result = await enqueueCampaign(campaignId, async () => {
          // campaignId is UNIQUE on round_robin_cursor, so findOrCreate is race-safe.
          await RoundRobinCursor.findOrCreate({
            where: { campaignId },
            defaults: { campaignId, cursor: 0 },
          });
          const [, [updated]] = await RoundRobinCursor.update(
            { cursor: sequelize.literal('"cursor" + 1') },
            { where: { campaignId }, returning: true }
          );
          const nextCursor = updated?.cursor ?? 1;
          return activeAgents[(nextCursor - 1) % activeAgents.length];
        });
        if (result) return result;
      }
    }
  }

  // 5) Fallback to System Agent
  const systemId = await getSystemAgentId();
  return systemId;
}

/**
 * Cross-pool assignment resolver (Phase 0.7). Like resolveAssignedAgentId, but
 * the campaign round-robin spans BOTH internal Lyfe agents (lead packages) AND
 * external buyers (eligible for the campaign with leadBalance > 0). Returns a
 * tagged result so the caller knows which table the assignee lives in — which
 * also drives webhook destination (internal -> Lyfe app, external -> MKTR Leads).
 *
 * ADDITIVE: not yet wired into the live capture path. createProspect / retell /
 * meta are cut over in the Phase 0.7 + 0.5 change, where the external branch also
 * atomically deducts balance (deductExternalLeadBalance) and runs the consent
 * gate, and where an external campaign with no eligible paid buyer quarantines
 * the lead instead of dropping it onto the System Agent.
 *
 * `allowExternal` MUST be computed by the caller as
 *   (campaign.externalEligible === true) && hasValidExternalConsent(prospect)
 * and defaults to false. When false the external pool is not even queried, so
 * the resolver is byte-for-byte internal-only — identical to resolveAssignedAgentId
 * behavior. This is the fail-safe that keeps the live pipeline unchanged until a
 * caller opts a consented, external-eligible lead in.
 *
 *   returns { kind: 'internal', internalAgentId } | { kind: 'external', externalAgentId }
 */
export async function resolveLeadAssignment({ reqUser, requestedAgentId, campaignId, qrTagId, allowExternal = false }) {
  // 1) Requester is an agent → self-assign (internal)
  if (reqUser && reqUser.role === 'agent') {
    return { kind: 'internal', internalAgentId: reqUser.id };
  }

  // 2) Admin-requested explicit agent (internal)
  if (reqUser && reqUser.role === 'admin' && requestedAgentId) {
    const valid = await User.findOne({ where: { id: requestedAgentId, role: 'agent', isActive: true } });
    if (valid) return { kind: 'internal', internalAgentId: valid.id };
  }

  // 3) QR directly assigned to an internal agent
  if (qrTagId) {
    const qr = await QrTag.findByPk(qrTagId);
    const candidateId = qr?.assignedAgentId || qr?.ownerUserId;
    if (candidateId) {
      const agent = await User.findOne({ where: { id: candidateId, role: 'agent', isActive: true } });
      if (agent) return { kind: 'internal', internalAgentId: agent.id };
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
      ...internalActive.map((id) => ({ kind: 'internal', internalAgentId: id })),
      ...externalActive.map((id) => ({ kind: 'external', externalAgentId: id })),
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

  // 5) Fallback → System Agent (internal). NOTE: the cutover must NOT let an
  //    external-only campaign reach here — no eligible paid buyer => quarantine.
  const systemId = await getSystemAgentId();
  return { kind: 'internal', internalAgentId: systemId };
}


