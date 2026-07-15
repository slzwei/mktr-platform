import { Op } from 'sequelize';
import { LeadPackage, LeadPackageAssignment, sequelize } from '../models/index.js';

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
 * Per-agent, per-campaign remaining-credit breakdown for the agent listing.
 * One grouped aggregate query (NOT a deeper include on the paginated
 * findAndCountAll — hasMany includes there risk row duplication; Codex review).
 * Returns { [agentId]: [{ campaignId, campaignName, leadsRemaining }] }.
 */
export async function getAgentPackageBreakdowns() {
  const rows = await sequelize.query(
    `SELECT a."agentId",
            p."campaignId",
            c.name AS "campaignName",
            SUM(a."leadsRemaining")::int AS "leadsRemaining"
       FROM lead_package_assignments a
       JOIN lead_packages p ON p.id = a."leadPackageId"
       LEFT JOIN campaigns c ON c.id = p."campaignId"
      WHERE a.status = 'active' AND a."leadsRemaining" > 0
      GROUP BY a."agentId", p."campaignId", c.name
      ORDER BY c.name NULLS LAST`,
    { type: sequelize.QueryTypes.SELECT }
  );

  const breakdowns = {};
  for (const row of rows) {
    const agentId = String(row.agentId);
    if (!breakdowns[agentId]) breakdowns[agentId] = [];
    breakdowns[agentId].push({
      campaignId: row.campaignId || null,
      campaignName: row.campaignName || null,
      leadsRemaining: row.leadsRemaining,
    });
  }
  return breakdowns;
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
export function computeAgentStatsFromCounts(agent, assignedCounts, packageBreakdowns = {}) {
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

  // Wallet columns are meaningful for EXTERNAL (mktr-leads) agents only —
  // internal agents read null (the UI renders "—"), never a misleading 0.
  const isExternal = plain.mktrLeadsId != null;
  const walletFields = isExternal
    ? {
        walletBalanceCents: parseInt(plain.walletBalanceCents, 10) || 0,
        committedLeads: parseInt(plain.committedLeads, 10) || 0,
        committedValueCents: parseInt(plain.committedValueCents, 10) || 0,
      }
    : { walletBalanceCents: null, committedLeads: null, committedValueCents: null };

  return {
    ...plain,
    ...walletFields,
    assignedThisPeriod: parseInt(plain.assignedThisPeriod, 10) || 0,
    owed_leads_count: totalLeadsOwed,
    owed_leads_manual_count: manualLeads,
    // Per-campaign split of the package portion — credits are campaign-scoped
    // ledgers, so the UI must be able to show more than one merged number.
    owed_leads_breakdown: packageBreakdowns[String(agent.id)] || [],
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
