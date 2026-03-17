import { Op } from 'sequelize';
import { LeadPackage, LeadPackageAssignment } from '../models/index.js';

/**
 * Fetch counts of unique campaigns each agent is assigned to via active lead packages.
 * Returns an object keyed by agent ID string, with integer counts as values.
 */
export async function getAssignedCampaignCounts() {
  const allAssignments = await LeadPackageAssignment.findAll({
    where: { status: 'active', leadsRemaining: { [Op.gt]: 0 } },
    include: [{
      model: LeadPackage,
      as: 'package',
      attributes: ['campaignId'],
      required: true
    }]
  });

  const assignedCounts = {};
  for (const assignment of allAssignments) {
    if (assignment.package && assignment.package.campaignId) {
      const agentId = String(assignment.agentId);
      if (!assignedCounts[agentId]) assignedCounts[agentId] = new Set();
      assignedCounts[agentId].add(assignment.package.campaignId);
    }
  }
  // Convert Sets to counts
  Object.keys(assignedCounts).forEach(k => {
    assignedCounts[k] = assignedCounts[k].size;
  });

  return assignedCounts;
}

/**
 * Compute stats object for a single agent row (with eager-loaded associations).
 * @param {object} agent - Sequelize User instance with assignedProspects, commissions, createdCampaigns, assignedPackages loaded
 * @param {object} assignedCounts - Map of agentId -> number of assigned campaigns
 * @returns {object} Plain object with stats attached
 */
export function computeAgentStats(agent, assignedCounts) {
  const totalProspects = agent.assignedProspects.length;
  const convertedProspects = agent.assignedProspects.filter(p => p.leadStatus === 'won').length;
  const totalCommissions = agent.commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const paidCommissions = agent.commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const createdCampaignsCount = agent.createdCampaigns.length;
  const assignedCampaignsCount = assignedCounts[String(agent.id)] || 0;
  const tiedCampaignsCount = createdCampaignsCount + assignedCampaignsCount;
  const activeCreatedCampaigns = agent.createdCampaigns.filter(c => c.status === 'active').length;

  // Calculate total leads owed (manual + active packages)
  const manualLeads = agent.owed_leads_count || 0;
  const packageLeads = agent.assignedPackages
    ? agent.assignedPackages.reduce((sum, pkg) => sum + (pkg.leadsRemaining || 0), 0)
    : 0;
  const totalLeadsOwed = manualLeads + packageLeads;

  return {
    ...agent.toJSON(),
    owed_leads_count: totalLeadsOwed,
    owed_leads_manual_count: manualLeads,
    stats: {
      totalProspects,
      convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      totalCommissions,
      paidCommissions,
      pendingCommissions: totalCommissions - paidCommissions,
      totalCampaigns: createdCampaignsCount,
      activeCampaigns: activeCreatedCampaigns,
      tiedCampaignsCount
    }
  };
}

/**
 * Compute stats for a single agent using pre-computed subquery counts (listAgents).
 * Avoids loading all prospects/commissions into memory.
 */
export function computeAgentStatsFromCounts(agent, assignedCounts) {
  const plain = agent.toJSON();
  const totalProspects = parseInt(plain.prospectCount) || 0;
  const convertedProspects = parseInt(plain.convertedCount) || 0;
  const totalCommissions = parseFloat(plain.totalCommissions) || 0;
  const paidCommissions = parseFloat(plain.paidCommissions) || 0;
  const createdCampaignsCount = parseInt(plain.createdCampaignsCount) || 0;
  const activeCampaignsCount = parseInt(plain.activeCampaignsCount) || 0;
  const assignedCampaignsCount = assignedCounts[String(agent.id)] || 0;
  const tiedCampaignsCount = createdCampaignsCount + assignedCampaignsCount;

  // Calculate total leads owed (manual + active packages)
  const manualLeads = agent.owed_leads_count || 0;
  const packageLeads = plain.assignedPackages
    ? plain.assignedPackages.reduce((sum, pkg) => sum + (pkg.leadsRemaining || 0), 0)
    : 0;
  const totalLeadsOwed = manualLeads + packageLeads;

  return {
    ...plain,
    owed_leads_count: totalLeadsOwed,
    owed_leads_manual_count: manualLeads,
    stats: {
      totalProspects,
      convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      totalCommissions,
      paidCommissions,
      pendingCommissions: totalCommissions - paidCommissions,
      totalCampaigns: createdCampaignsCount,
      activeCampaigns: activeCampaignsCount,
      tiedCampaignsCount
    }
  };
}
