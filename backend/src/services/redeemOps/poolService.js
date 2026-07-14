import { Op, QueryTypes } from 'sequelize';
import {
  ProspectingPool, ProspectingPoolMember, PartnerOrganisation, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeClaimService } from './claimService.js';

/**
 * Prospecting pools + Claim Next (docs/redeem-ops/ERD.md §3.8–3.9, brief §21).
 * claim-next picks the oldest available member with FOR UPDATE SKIP LOCKED
 * (house pattern: chargeLeadCredit) so concurrent staff get DIFFERENT prospects,
 * then runs the same atomic partner claim as the direct claim path. A partner
 * that was claimed outside the pool between listing and claiming is skipped and
 * its membership marked removed.
 */
export function makePoolService(overrides = {}) {
  const d = {
    ProspectingPool, ProspectingPoolMember, PartnerOrganisation, sequelize, logger,
    claims: makeClaimService(), ...overrides,
  };

  async function createPool(body, user) {
    if (!body.name || !String(body.name).trim()) throw new AppError('Pool name is required', 400);
    return d.ProspectingPool.create({
      name: String(body.name).trim(),
      description: body.description || null,
      category: String(body.category ?? '').trim() || null,
      area: body.area || null,
      createdBy: user.id,
    });
  }

  async function listPools() {
    const pools = await d.ProspectingPool.findAll({ order: [['createdAt', 'DESC']] });
    const counts = await d.ProspectingPoolMember.findAll({
      attributes: ['poolId', 'status', [d.sequelize.fn('COUNT', '*'), 'count']],
      group: ['poolId', 'status'],
      raw: true,
    });
    const byPool = {};
    for (const c of counts) {
      byPool[c.poolId] = byPool[c.poolId] || {};
      byPool[c.poolId][c.status] = Number(c.count);
    }
    return pools.map((p) => {
      const memberCounts = byPool[p.id] || {};
      const status = !p.isActive ? 'archived' : (memberCounts.available || 0) > 0 ? 'active' : 'exhausted';
      return { ...p.toJSON(), memberCounts, status };
    });
  }

  async function updatePool(poolId, body, user) {
    const pool = await d.ProspectingPool.findByPk(poolId);
    if (!pool) throw new AppError('Pool not found', 404);
    const updates = {};
    for (const f of ['name', 'description', 'category', 'area', 'isActive']) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (updates.category !== undefined) updates.category = String(updates.category ?? '').trim() || null;
    await pool.update(updates);
    return pool;
  }

  /** Bulk-add partners; ineligible (merged/archived/disqualified/restricted) are skipped. */
  async function addMembers(poolId, partnerIds, user) {
    const pool = await d.ProspectingPool.findByPk(poolId);
    if (!pool || !pool.isActive) throw new AppError('Pool not found', 404);
    if (!Array.isArray(partnerIds) || partnerIds.length === 0) {
      throw new AppError('partnerIds array is required', 400);
    }
    const eligible = await d.PartnerOrganisation.findAll({
      where: {
        id: { [Op.in]: partnerIds },
        mergedIntoId: null,
        archivedAt: null,
        availability: { [Op.notIn]: ['disqualified', 'restricted'] },
      },
      attributes: ['id'],
    });
    let added = 0;
    for (const p of eligible) {
      const [, created] = await d.ProspectingPoolMember.findOrCreate({
        where: { poolId, partnerOrganisationId: p.id },
        defaults: { poolId, partnerOrganisationId: p.id, addedBy: user.id },
      });
      if (created) added += 1;
    }
    return { requested: partnerIds.length, eligible: eligible.length, added };
  }

  /**
   * Claim the next eligible prospect from the pool for `user`.
   * Returns the claimed partner id, or null when the pool is exhausted.
   */
  async function claimNext(poolId, user) {
    const pool = await d.ProspectingPool.findByPk(poolId);
    if (!pool || !pool.isActive) throw new AppError('Pool not found', 404);

    // Bounded retry: a SKIP LOCKED candidate can still lose the partner-level
    // conditional UPDATE to a direct (non-pool) claim — skip it and try the next.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await d.sequelize.transaction(async (t) => {
        const candidates = await d.sequelize.query(
          `SELECT m.id AS "memberId", m."partnerOrganisationId" AS "partnerId"
             FROM prospecting_pool_members m
             JOIN partner_organisations p ON p.id = m."partnerOrganisationId"
            WHERE m."poolId" = :poolId
              AND m.status = 'available'
              AND p."ownerUserId" IS NULL
              AND p.availability = 'available'
              AND p."archivedAt" IS NULL
              AND p."mergedIntoId" IS NULL
            ORDER BY m."createdAt" ASC
            LIMIT 1
            FOR UPDATE OF m SKIP LOCKED`,
          { replacements: { poolId }, type: QueryTypes.SELECT, transaction: t }
        );
        if (candidates.length === 0) return { done: true, partnerId: null };

        const { memberId, partnerId } = candidates[0];
        const claimed = await d.claims.claimPartnerTx(partnerId, user, t, 'pool_claim_next');
        if (!claimed) {
          // Lost the partner to a concurrent direct claim — retire the membership
          // so the pool doesn't keep offering an owned business.
          await d.ProspectingPoolMember.update(
            { status: 'removed' },
            { where: { id: memberId }, transaction: t }
          );
          return { done: false, partnerId: null };
        }
        await d.ProspectingPoolMember.update(
          { status: 'claimed', claimedBy: user.id, claimedAt: new Date() },
          { where: { id: memberId }, transaction: t }
        );
        return { done: true, partnerId };
      });
      if (result.done) return result.partnerId;
    }
    return null;
  }

  return { createPool, listPools, updatePool, addMembers, claimNext };
}

const _default = makePoolService();
export default _default;
