import { Op } from 'sequelize';
import { Campaign } from '../models/index.js';

/**
 * Build a Sequelize WHERE clause that scopes prospects to the user's access level.
 * - admin: no filter (sees all)
 * - agent: only prospects assigned to them
 * - other roles: only prospects from campaigns they created
 */
export async function buildProspectWhere(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'agent') return { assignedAgentId: user.id };

  // Other roles: scope to their campaigns
  const userCampaigns = await Campaign.findAll({
    where: { createdBy: user.id },
    attributes: ['id']
  });
  return { campaignId: { [Op.in]: userCampaigns.map(c => c.id) } };
}
