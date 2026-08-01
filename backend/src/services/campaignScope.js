import { Op } from 'sequelize';
import { Campaign } from '../models/index.js';
import { getTenantId } from '../middleware/tenant.js';

/**
 * Campaign query scoping (P4-4, split out of campaignService): the two
 * tenant/role WHERE-builders every campaign read/write path starts from.
 *
 * buildCampaignWhere — VISIBILITY scope: non-admins see their own campaigns
 *   plus public ones (list/get/analytics/duplicate).
 * buildOwnerWhere — OWNERSHIP scope: non-admins may only MUTATE their own
 *   (update/archive/restore/delete/launch/metrics/summary).
 */

export function buildCampaignWhere(req, extra = {}) {
  const where = { ...extra };

  try {
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (hasTenantId) {
      where.tenant_id = getTenantId(req);
    }
  } catch (_) { /* skip in dev */ }

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

  try {
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (hasTenantId) {
      where.tenant_id = getTenantId(req);
    }
  } catch (_) { /* tenant column may not exist */ }

  if (req.user.role !== 'admin') {
    where.createdBy = req.user.id;
  }

  return where;
}
