import { Op } from 'sequelize';
import { RedeemOpsCategory, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { makeRedeemOpsAuditService } from './auditService.js';

/**
 * Admin-managed category taxonomy (migration 052). The three consuming columns
 * stay plain strings; this service is the only writer of the taxonomy and the
 * shared validator for every category write path (partner/pool/reward create+update).
 *
 * Consolidating seeded variants ("Nails" → "Nail Salon") is the primary admin job,
 * so merge is first-class: rename refuses to collide (409) and points here instead.
 *
 * Concurrency stance: validate-then-commit, no locks. A save that validated against
 * a name mid-rename can land the old string — harmless (strings, not FKs) and
 * self-healing: rename/merge cascades are idempotent re-runnable UPDATEs.
 */
const CATEGORY_TABLES = ['partner_organisations', 'prospecting_pools', 'reward_offers'];

// analyticsService folds NULL categories into the literal 'Uncategorised'; a real
// category with that name would silently merge with the null bucket.
const RESERVED_NAMES = ['uncategorised', 'uncategorized'];

export function makeCategoryService(overrides = {}) {
  const d = {
    RedeemOpsCategory, sequelize, audit: makeRedeemOpsAuditService(), ...overrides,
  };

  function cleanName(raw) {
    const name = String(raw ?? '').trim();
    if (!name) throw new AppError('Category name is required', 400);
    if (name.length > 64) throw new AppError('Category name must be 64 characters or fewer', 400);
    if (RESERVED_NAMES.includes(name.toLowerCase())) {
      throw new AppError(`'${name}' is reserved for records with no category`, 400);
    }
    return name;
  }

  function cleanSearchTerms(raw, fallbackName) {
    if (raw === undefined) return undefined;
    const values = Array.isArray(raw) ? raw : [raw];
    const seen = new Set();
    const cleaned = [];
    for (const value of values) {
      const term = String(value ?? '').trim().slice(0, 64);
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      cleaned.push(term);
      if (cleaned.length === 20) break;
    }
    return cleaned.length > 0 ? cleaned : [fallbackName];
  }

  /** IG analog of cleanSearchTerms with NO name fallback: a category name is not
   *  a hashtag, so an emptied list stores NULL ("no IG tags curated yet") and
   *  resolveCategoryForInstagram refuses the search until an admin curates tags. */
  function cleanHashtags(raw) {
    if (raw === undefined) return undefined;
    const values = Array.isArray(raw) ? raw : [raw];
    const seen = new Set();
    const cleaned = [];
    for (const value of values) {
      const tag = String(value ?? '').trim().replace(/^#+/, '').trim().toLowerCase().slice(0, 64);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      cleaned.push(tag);
      if (cleaned.length === 20) break;
    }
    return cleaned.length > 0 ? cleaned : null;
  }

  function whereNameCi(name) {
    return d.sequelize.where(d.sequelize.fn('LOWER', d.sequelize.col('name')), name.toLowerCase());
  }

  async function findActiveCategory(name) {
    const match = await d.RedeemOpsCategory.findOne({
      where: { [Op.and]: [whereNameCi(name), { isActive: true }] },
    });
    if (!match) {
      throw new AppError(`Unknown category '${name}' — ask an admin to add it in Settings`, 422);
    }
    return match;
  }

  async function listCategories({ includeInactive = false } = {}) {
    return d.RedeemOpsCategory.findAll({
      where: includeInactive ? {} : { isActive: true },
      order: [[d.sequelize.fn('LOWER', d.sequelize.col('name')), 'ASC']],
    });
  }

  async function createCategory(body, user, requestId = null) {
    const name = cleanName(body?.name);
    const providerSearchTerms = cleanSearchTerms(body?.searchTerms, name) ?? [name];
    const igHashtags = cleanHashtags(body?.igHashtags) ?? null;
    const existing = await d.RedeemOpsCategory.findOne({ where: whereNameCi(name) });
    if (existing) throw new AppError(`Category '${existing.name}' already exists`, 409);
    try {
      const category = await d.RedeemOpsCategory.create({ name, providerSearchTerms, igHashtags });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'settings.category_created',
        entityType: 'redeem_ops_category', entityId: category.id,
        after: { name, searchTerms: providerSearchTerms, ...(igHashtags ? { igHashtags } : {}) },
        requestId,
      });
      return category;
    } catch (err) {
      // The DB functional index backstops a create/create race; NODE_ENV=test DBs
      // are sync()-built and may lack it, which is why the findOne above is the
      // authoritative check rather than a fast path.
      if (err?.name === 'SequelizeUniqueConstraintError') {
        throw new AppError(`Category '${name}' already exists`, 409);
      }
      throw err;
    }
  }

  /**
   * Rename and/or (de)activate. Rename cascades the string onto every consuming
   * row so analytics grouping and the ?category= filter stay coherent. Renaming
   * onto a DIFFERENT existing name is refused — that operation is mergeCategory.
   * Case-only renames of the same category are allowed (canonical casing fix).
   */
  async function updateCategory(id, body, user, requestId = null) {
    const category = await d.RedeemOpsCategory.findByPk(id);
    if (!category) throw new AppError('Category not found', 404);

    const updates = {};
    let cascade = null;
    if (body?.name !== undefined) {
      const newName = cleanName(body.name);
      if (newName !== category.name) {
        const clash = await d.RedeemOpsCategory.findOne({ where: whereNameCi(newName) });
        if (clash && clash.id !== category.id) {
          throw new AppError(`'${clash.name}' already exists — merge into it instead`, 409);
        }
        cascade = { from: category.name, to: newName };
        updates.name = newName;
      }
    }
    if (body?.isActive !== undefined) updates.isActive = !!body.isActive;
    if (body?.searchTerms !== undefined) {
      const effectiveName = updates.name || category.name;
      updates.providerSearchTerms = cleanSearchTerms(body.searchTerms, effectiveName);
    }
    if (body?.igHashtags !== undefined) updates.igHashtags = cleanHashtags(body.igHashtags);
    if (Object.keys(updates).length === 0) return category;

    const touchesHashtags = 'igHashtags' in updates;
    const before = {
      name: category.name,
      isActive: category.isActive,
      searchTerms: category.providerSearchTerms,
      ...(touchesHashtags ? { igHashtags: category.igHashtags } : {}),
    };
    await d.sequelize.transaction(async (t) => {
      await category.update(updates, { transaction: t });
      if (cascade) {
        for (const table of CATEGORY_TABLES) {
          await d.sequelize.query(
            `UPDATE ${table} SET category = :to WHERE LOWER(category) = LOWER(:from)`,
            { replacements: cascade, transaction: t }
          );
        }
      }
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'settings.category_updated',
        entityType: 'redeem_ops_category', entityId: category.id,
        before,
        after: {
          name: updates.name ?? before.name,
          isActive: updates.isActive ?? before.isActive,
          searchTerms: updates.providerSearchTerms ?? before.searchTerms,
          ...(touchesHashtags ? { igHashtags: updates.igHashtags } : {}),
        },
        requestId, transaction: t,
      });
    });
    return category;
  }

  /**
   * Consolidate: move every row carrying the source name onto the target's
   * canonical name, then delete the source. The only way to defragment seeded
   * variants — delete refuses while referenced and rename refuses to collide.
   */
  async function mergeCategory(id, body, user, requestId = null) {
    const targetId = body?.targetId;
    if (!targetId) throw new AppError('targetId is required', 400);
    if (String(targetId) === String(id)) throw new AppError('Cannot merge a category into itself', 400);

    const [source, target] = await Promise.all([
      d.RedeemOpsCategory.findByPk(id),
      d.RedeemOpsCategory.findByPk(targetId),
    ]);
    if (!source || !target) throw new AppError('Category not found', 404);
    if (!target.isActive) throw new AppError('Cannot merge into a retired category', 400);

    let rowsMoved = 0;
    await d.sequelize.transaction(async (t) => {
      for (const table of CATEGORY_TABLES) {
        const [, meta] = await d.sequelize.query(
          `UPDATE ${table} SET category = :to WHERE LOWER(category) = LOWER(:from)`,
          { replacements: { from: source.name, to: target.name }, transaction: t }
        );
        rowsMoved += meta?.rowCount ?? 0;
      }
      const targetTerms = target.providerSearchTerms?.length
        ? target.providerSearchTerms
        : [target.name];
      const mergedSearchTerms = cleanSearchTerms([
        ...targetTerms,
        ...(source.providerSearchTerms || []),
        source.name,
      ], target.name);
      await target.update({ providerSearchTerms: mergedSearchTerms }, { transaction: t });
      await source.destroy({ transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'settings.category_merged',
        entityType: 'redeem_ops_category', entityId: source.id,
        before: { name: source.name },
        after: {
          mergedInto: target.name, targetId: target.id, rowsMoved,
          searchTerms: mergedSearchTerms,
        },
        requestId, transaction: t,
      });
    });
    return { rowsMoved, target };
  }

  /** Hard delete — only for unreferenced rows (just-created typos). */
  async function deleteCategory(id, user, requestId = null) {
    const category = await d.RedeemOpsCategory.findByPk(id);
    if (!category) throw new AppError('Category not found', 404);

    await d.sequelize.transaction(async (t) => {
      let refs = 0;
      for (const table of CATEGORY_TABLES) {
        const [[row]] = await d.sequelize.query(
          `SELECT COUNT(*)::int AS count FROM ${table} WHERE LOWER(category) = LOWER(:name)`,
          { replacements: { name: category.name }, transaction: t }
        );
        refs += row?.count ?? 0;
      }
      if (refs > 0) {
        throw new AppError(`'${category.name}' is used by ${refs} record(s) — merge or retire it instead`, 409);
      }
      await category.destroy({ transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'settings.category_deleted',
        entityType: 'redeem_ops_category', entityId: category.id,
        before: { name: category.name }, requestId, transaction: t,
      });
    });
    return { deleted: true };
  }

  /**
   * Shared write-time validator for partner/pool/reward category writes.
   *
   * - undefined → undefined (field absent; update loops skip it, creates coalesce to null)
   * - blank → null (explicit clear; renders as "Uncategorised")
   * - equals the row's CURRENT stored value (case-insensitive) → passed through
   *   unchanged, even if retired/legacy — an admin rename must never 422 an
   *   unrelated edit (PartnerDetail sends category on every save)
   * - matches an ACTIVE category case-insensitively → canonical stored casing
   * - otherwise → 422 telling the user who can fix it
   */
  async function resolveCategoryName(input, { currentValue = undefined } = {}) {
    if (input === undefined) return undefined;
    const name = String(input ?? '').trim();
    if (!name) return null;
    if (currentValue && name.toLowerCase() === String(currentValue).trim().toLowerCase()) {
      return currentValue;
    }
    const match = await findActiveCategory(name);
    return match.name;
  }

  async function resolveCategoryForSearch(input) {
    const name = String(input ?? '').trim();
    const match = await findActiveCategory(name);
    return {
      name: match.name,
      searchTerms: match.providerSearchTerms?.length
        ? match.providerSearchTerms
        : [match.name],
    };
  }

  /** Instagram-discovery resolver (migration 065). Unlike resolveCategoryForSearch
   *  there is NO name fallback — a category without curated hashtags is not
   *  IG-searchable, and the 422 names the fix. */
  async function resolveCategoryForInstagram(input) {
    const name = String(input ?? '').trim();
    const match = await findActiveCategory(name);
    if (!match.igHashtags?.length) {
      throw new AppError(`Category '${match.name}' has no Instagram hashtags — add them in Settings`, 422);
    }
    return { name: match.name, hashtags: match.igHashtags };
  }

  return {
    listCategories, createCategory, updateCategory, mergeCategory, deleteCategory,
    resolveCategoryName, resolveCategoryForSearch, resolveCategoryForInstagram,
  };
}

const _default = makeCategoryService();
export default _default;
