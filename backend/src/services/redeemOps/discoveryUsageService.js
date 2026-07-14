import { DiscoveryDailyUsage, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';

const KINDS = {
  results: { column: 'resultsUsed', label: 'search results' },
  profiles: { column: 'profilesUsed', label: 'enrichment profiles' },
};

/**
 * Atomic usage reservations. Per-user enforcement is one INSERT..ON CONFLICT
 * statement; the team SUM remains advisory under the existing single-instance
 * TOCTOU posture.
 */
export function makeDiscoveryUsageService(overrides = {}) {
  const d = { DiscoveryDailyUsage, sequelize, ...overrides };

  async function teamUsed(kind, sgDate, transaction = null) {
    const { column } = KINDS[kind];
    const [[row]] = await d.sequelize.query(
      `SELECT COALESCE(SUM("${column}"), 0)::int AS used
         FROM discovery_daily_usage
        WHERE "sgDate" = :sgDate`,
      { replacements: { sgDate }, transaction },
    );
    return Number(row?.used) || 0;
  }

  async function reserve(kind, {
    userId, sgDate, amount, userCap, teamCap, transaction = null,
  }) {
    const spec = KINDS[kind];
    const n = Math.max(0, Math.trunc(Number(amount) || 0));
    if (n === 0) return 0;
    if (n > userCap) throw new AppError(`Daily ${spec.label} limit reached`, 429);

    const usedByTeam = await teamUsed(kind, sgDate, transaction);
    if (usedByTeam + n > teamCap) {
      throw new AppError(`Team daily ${spec.label} limit reached — try again tomorrow`, 429);
    }

    const isResults = kind === 'results';
    const [rows] = await d.sequelize.query(
      `INSERT INTO discovery_daily_usage
              ("userId", "sgDate", "resultsUsed", "profilesUsed", "createdAt", "updatedAt")
       VALUES (:userId, :sgDate, :results, :profiles, NOW(), NOW())
       ON CONFLICT ("userId", "sgDate") DO UPDATE
               SET "${spec.column}" = discovery_daily_usage."${spec.column}" + :amount,
                   "updatedAt" = NOW()
             WHERE discovery_daily_usage."${spec.column}" + :amount <= :userCap
       RETURNING "${spec.column}" AS used`,
      {
        replacements: {
          userId, sgDate, amount: n, userCap,
          results: isResults ? n : 0,
          profiles: isResults ? 0 : n,
        },
        transaction,
      },
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError(`Daily ${spec.label} limit reached`, 429);
    }
    return Number(rows[0].used) || 0;
  }

  async function refund(kind, { userId, sgDate, amount, transaction = null }) {
    const { column } = KINDS[kind];
    const n = Math.max(0, Math.trunc(Number(amount) || 0));
    if (n === 0) return null;
    const [rows] = await d.sequelize.query(
      `UPDATE discovery_daily_usage
          SET "${column}" = GREATEST(0, "${column}" - :amount),
              "updatedAt" = NOW()
        WHERE "userId" = :userId AND "sgDate" = :sgDate
        RETURNING "${column}" AS used`,
      { replacements: { userId, sgDate, amount: n }, transaction },
    );
    return rows?.[0] ? Number(rows[0].used) || 0 : null;
  }

  async function getUsage(userId, sgDate) {
    const row = await d.DiscoveryDailyUsage.findOne({ where: { userId, sgDate } });
    return {
      resultsUsed: Number(row?.resultsUsed) || 0,
      profilesUsed: Number(row?.profilesUsed) || 0,
    };
  }

  return {
    reserveResults: (args) => reserve('results', args),
    reserveProfiles: (args) => reserve('profiles', args),
    refundResults: (args) => refund('results', args),
    refundProfiles: (args) => refund('profiles', args),
    getUsage,
  };
}

const _default = makeDiscoveryUsageService();
export default _default;
