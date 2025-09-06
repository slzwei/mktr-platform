import dotenv from 'dotenv';
import { User, QrTag, Campaign } from '../models/index.js';

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
    console.warn('DEFAULT_AGENT_ID provided but not a valid active agent. Fallling back to SYSTEM_AGENT_EMAIL.');
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

  // 4) Try campaign assigned_agents
  if (campaignId) {
    const campaign = await Campaign.findByPk(campaignId);
    const assigned = Array.isArray(campaign?.assigned_agents) ? campaign.assigned_agents : [];
    const fromCampaign = await findFirstActiveAgentByIds(assigned);
    if (fromCampaign) return fromCampaign;
  }

  // 5) Fallback to System Agent
  const systemId = await getSystemAgentId();
  return systemId;
}


