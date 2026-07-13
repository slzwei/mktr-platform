import { DiscoveryTerritory, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { makeRedeemOpsAuditService } from './auditService.js';

const ALL_SINGAPORE = /^all\s+singapore$/i;

/** Admin-curated Discover search filters. Territory names are never validated
 * on discovery runs and are not ownership or assignment records. */
export function makeTerritoryService(overrides = {}) {
  const d = {
    DiscoveryTerritory, sequelize, audit: makeRedeemOpsAuditService(), ...overrides,
  };

  function cleanName(raw) {
    const name = String(raw ?? '').trim();
    if (!name) throw new AppError('Territory name is required', 400);
    if (name.length > 64) throw new AppError('Territory name must be 64 characters or fewer', 400);
    if (ALL_SINGAPORE.test(name)) {
      throw new AppError("'All Singapore' is reserved for the whole-country search option", 400);
    }
    return name;
  }

  function whereNameCi(name) {
    return d.sequelize.where(d.sequelize.fn('LOWER', d.sequelize.col('name')), name.toLowerCase());
  }

  async function listTerritories({ includeInactive = false } = {}) {
    return d.DiscoveryTerritory.findAll({
      where: includeInactive ? {} : { isActive: true },
      order: [[d.sequelize.fn('LOWER', d.sequelize.col('name')), 'ASC']],
    });
  }

  async function createTerritory(body, user, requestId = null) {
    const name = cleanName(body?.name);
    const existing = await d.DiscoveryTerritory.findOne({ where: whereNameCi(name) });
    if (existing) throw new AppError(`Territory '${existing.name}' already exists`, 409);

    try {
      const territory = await d.DiscoveryTerritory.create({ name });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'settings.territory_created',
        entityType: 'discovery_territory', entityId: territory.id,
        after: { name, isActive: territory.isActive }, requestId,
      });
      return territory;
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        throw new AppError(`Territory '${name}' already exists`, 409);
      }
      throw err;
    }
  }

  async function updateTerritory(id, body, user, requestId = null) {
    const territory = await d.DiscoveryTerritory.findByPk(id);
    if (!territory) throw new AppError('Territory not found', 404);

    const updates = {};
    if (body?.name !== undefined) {
      const name = cleanName(body.name);
      if (name !== territory.name) {
        const clash = await d.DiscoveryTerritory.findOne({ where: whereNameCi(name) });
        if (clash && clash.id !== territory.id) {
          throw new AppError(`Territory '${clash.name}' already exists`, 409);
        }
        updates.name = name;
      }
    }
    if (body?.isActive !== undefined) updates.isActive = !!body.isActive;
    if (Object.keys(updates).length === 0) return territory;

    const before = { name: territory.name, isActive: territory.isActive };
    try {
      await d.sequelize.transaction(async (transaction) => {
        await territory.update(updates, { transaction });
        await d.audit.recordAuditEvent({
          actorUser: user, action: 'settings.territory_updated',
          entityType: 'discovery_territory', entityId: territory.id,
          before,
          after: { name: territory.name, isActive: territory.isActive },
          requestId, transaction,
        });
      });
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        throw new AppError(`Territory '${updates.name}' already exists`, 409);
      }
      throw err;
    }
    return territory;
  }

  async function deleteTerritory(id, user, requestId = null) {
    const territory = await d.DiscoveryTerritory.findByPk(id);
    if (!territory) throw new AppError('Territory not found', 404);

    await d.sequelize.transaction(async (transaction) => {
      await territory.destroy({ transaction });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'settings.territory_deleted',
        entityType: 'discovery_territory', entityId: territory.id,
        before: { name: territory.name, isActive: territory.isActive },
        requestId, transaction,
      });
    });
    return { deleted: true };
  }

  return { listTerritories, createTerritory, updateTerritory, deleteTerritory };
}

const _default = makeTerritoryService();
export default _default;
