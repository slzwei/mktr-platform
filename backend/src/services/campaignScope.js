import { Op } from 'sequelize';

/**
 * Campaign query scoping (P4-4, split out of campaignService): the two
 * role WHERE-builders every campaign read/write path starts from. (The
 * half-built tenant filter was removed in P4-8 — it never applied: the
 * Campaign model never declared tenant_id, and the value would always have
 * been the default tenant anyway.)
 *
 * buildCampaignWhere — VISIBILITY scope: non-admins see their own campaigns
 *   plus public ones (list/get/analytics/duplicate).
 * buildOwnerWhere — OWNERSHIP scope: non-admins may only MUTATE their own
 *   (update/archive/restore/delete/launch/metrics/summary).
 */

export function buildCampaignWhere(req, extra = {}) {
  const where = { ...extra };

  if (req.user.role !== 'admin') {
    // The role scope lives inside Op.and — never as a bare where[Op.or] — so a
    // later filter that also needs an OR group (e.g. the search filter) cannot
    // overwrite it. Assigning the same symbol key twice silently drops the
    // first group, which leaked every campaign to any authenticated user.
    where[Op.and] = [
      ...(where[Op.and] || []),
      { [Op.or]: [{ createdBy: req.user.id }, { isPublic: true }] }
    ];
  }

  return where;
}

export function buildOwnerWhere(req, extra = {}) {
  const where = { ...extra };

  if (req.user.role !== 'admin') {
    where.createdBy = req.user.id;
  }

  return where;
}
