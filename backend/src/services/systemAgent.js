import dotenv from 'dotenv';
import { User, QrTag, Campaign, RoundRobinCursor, LeadPackageAssignment, LeadPackage, sequelize } from '../models/index.js';
import { Op } from 'sequelize';

// In-process queue to serialize round-robin updates per campaign (reduces SQLite lock contention)
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
    console.warn('DEFAULT_AGENT_ID provided but not a valid active agent. Falling back to SYSTEM_AGENT_EMAIL.');
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

  // 3) Try QR tag owner if active agent
  if (qrTagId) {
    const qr = await QrTag.findByPk(qrTagId);
    if (qr?.ownerUserId) {
      const owner = await User.findOne({ where: { id: qr.ownerUserId, role: 'agent', isActive: true } });
      if (owner) return owner.id;
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
        attributes: ['id']
      })).map(u => u.id);

      if (activeAgents.length > 0) {
        // Use transaction to avoid race under load
        // Serialize updates in-process; do a simple read-modify-write with retries
        const result = await enqueueCampaign(campaignId, async () => {
          let attempts = 0;
          while (attempts < 5) {
            try {
              let cursor = await RoundRobinCursor.findOne({ where: { campaignId } });
              if (!cursor) {
                cursor = await RoundRobinCursor.create({ campaignId, cursor: 0 });
              }
              const index = cursor.cursor % activeAgents.length;
              const chosen = activeAgents[index];
              await cursor.update({ cursor: (cursor.cursor + 1) % activeAgents.length });
              return chosen;
            } catch (e) {
              const msg = String(e?.message || '').toLowerCase();
              if (msg.includes('busy') || msg.includes('locked')) {
                attempts++;
                await new Promise(r => setTimeout(r, 50 * attempts));
                continue;
              }
              throw e;
            }
          }
          // As a last resort, pick deterministically to avoid failing lead creation
          const fallback = activeAgents[Math.floor(Math.random() * activeAgents.length)];
          return fallback;
        });
        if (result) return result;
      }
    }
  }

  // 5) Fallback to System Agent
  const systemId = await getSystemAgentId();
  return systemId;
}


