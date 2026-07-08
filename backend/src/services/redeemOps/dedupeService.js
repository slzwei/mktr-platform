import { QueryTypes, Op } from 'sequelize';
import { PartnerOrganisation, User, sequelize } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { normalizeBusinessName, normalizeDomain, normalizeHandle, normalizeUen } from './normalizers.js';

/**
 * Duplicate business detection (docs/redeem-ops/ERD.md §5, brief §14).
 *
 * Tiers:
 *  - EXACT  — same UEN / phone / website domain / social handle / normalized name.
 *             Creating over an exact match requires an explicit overrideReason.
 *  - POTENTIAL — similar normalized name (pg_trgm similarity ≥ 0.55 when the
 *             extension is available, else shared 12-char prefix), surfaced as a
 *             warning with owner/stage/last-activity so the user can decide
 *             (open existing / add as location / continue with reason).
 *
 * Merged and archived rows never match (they're not contactable records).
 */
export function makeDedupeService(overrides = {}) {
  const d = { PartnerOrganisation, User, sequelize, logger, ...overrides };

  let _trgmAvailable = null;
  async function trgmAvailable() {
    if (_trgmAvailable !== null) return _trgmAvailable;
    try {
      const rows = await d.sequelize.query(
        `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`,
        { type: QueryTypes.SELECT }
      );
      _trgmAvailable = rows.length > 0;
    } catch {
      _trgmAvailable = false;
    }
    return _trgmAvailable;
  }

  const LIVE = { mergedIntoId: null, archivedAt: null };
  const MATCH_ATTRS = [
    'id', 'legalName', 'tradingName', 'brandName', 'pipelineStage', 'availability',
    'ownerUserId', 'lastActivityAt', 'category', 'uen', 'primaryPhone',
    'websiteDomain', 'instagramHandle', 'tiktokHandle',
  ];

  function toMatch(row, reason, tier) {
    return { tier, reason, partner: row };
  }

  /**
   * @param {object} probe  Raw form values (un-normalized OK — normalized here)
   * @param {string|null} excludeId  The record being edited (skip self-matches)
   * @returns {{ exact: Match[], potential: Match[] }}
   */
  async function findDuplicates(probe, excludeId = null) {
    const uen = normalizeUen(probe.uen);
    const phone = probe.primaryPhone && String(probe.primaryPhone).trim() ? String(probe.primaryPhone).trim() : null;
    const domain = normalizeDomain(probe.website) || (probe.websiteDomain ? String(probe.websiteDomain).toLowerCase() : null);
    const instagram = normalizeHandle(probe.instagramHandle);
    const tiktok = normalizeHandle(probe.tiktokHandle);
    const name = normalizeBusinessName(probe.tradingName || probe.brandName || probe.legalName || probe.name || '');

    const exact = [];
    const seen = new Set(excludeId ? [excludeId] : []);
    const include = [{ model: d.User, as: 'owner', attributes: ['id', 'fullName'] }];

    const exactChecks = [
      [uen, { uen }, 'Same UEN'],
      [phone, { primaryPhone: phone }, 'Same phone number'],
      [domain, { websiteDomain: domain }, 'Same website domain'],
      [instagram, { instagramHandle: instagram }, 'Same Instagram handle'],
      [tiktok, { tiktokHandle: tiktok }, 'Same TikTok handle'],
      [name, { normalizedName: name }, 'Same business name (normalized)'],
    ];
    for (const [value, where, reason] of exactChecks) {
      if (!value) continue;
      const rows = await d.PartnerOrganisation.findAll({
        where: { ...where, ...LIVE }, attributes: MATCH_ATTRS, include, limit: 5,
      });
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        exact.push(toMatch(row, reason, 'exact'));
      }
    }

    // Potential tier — fuzzy name
    const potential = [];
    if (name) {
      let rows = [];
      if (await trgmAvailable()) {
        rows = await d.sequelize.query(
          `SELECT id FROM partner_organisations
            WHERE "mergedIntoId" IS NULL AND "archivedAt" IS NULL
              AND similarity("normalizedName", :name) >= 0.55
              AND "normalizedName" <> :name
            ORDER BY similarity("normalizedName", :name) DESC
            LIMIT 5`,
          { replacements: { name }, type: QueryTypes.SELECT }
        );
      } else if (name.length >= 12) {
        rows = await d.PartnerOrganisation.findAll({
          where: {
            ...LIVE,
            normalizedName: { [Op.like]: `${name.slice(0, 12)}%`, [Op.ne]: name },
          },
          attributes: ['id'],
          limit: 5,
        });
      }
      const ids = rows.map((r) => r.id).filter((id) => !seen.has(id));
      if (ids.length) {
        const full = await d.PartnerOrganisation.findAll({
          where: { id: ids }, attributes: MATCH_ATTRS, include,
        });
        for (const row of full) {
          seen.add(row.id);
          const sameCategory = probe.category && row.category === probe.category;
          potential.push(toMatch(
            row,
            `Similar business name${sameCategory ? ` in the same category (${row.category})` : ''}`,
            'potential'
          ));
        }
      }
    }

    return { exact, potential };
  }

  return { findDuplicates, trgmAvailable };
}

const _default = makeDedupeService();
export const findDuplicates = _default.findDuplicates;
