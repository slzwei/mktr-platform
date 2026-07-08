import { sequelize } from '../../models/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Claim-inactivity sweep (brief §16, docs/redeem-ops/ERD.md §6). Flags only —
 * records are NEVER auto-released; managers act on the flags (queue + pipeline
 * views). Runs in-process on the bootstrap interval (house pattern: releaseSweep).
 *
 *  - atRiskFlag: claimed >48h ago, still no first outreach.
 *  - staleFlag:  no meaningful activity for >14 days — EXCEPT a FOLLOW_UP_LATER
 *    partner with a future open task (that's a deliberate parked state), and
 *    terminal stages (PARTNERED/NOT_INTERESTED/DISQUALIFIED).
 *
 * Both flags are cleared automatically when real activity is logged
 * (partnerService.logActivity).
 */
export async function runRedeemOpsStaleSweep() {
  const [, atRisk] = await sequelize.query(
    `UPDATE partner_organisations
        SET "atRiskFlag" = TRUE, "updatedAt" = NOW()
      WHERE "ownerUserId" IS NOT NULL
        AND "firstOutreachAt" IS NULL
        AND "claimedAt" < NOW() - INTERVAL '48 hours'
        AND "atRiskFlag" = FALSE
        AND "archivedAt" IS NULL AND "mergedIntoId" IS NULL`
  );

  const [, stale] = await sequelize.query(
    `UPDATE partner_organisations p
        SET "staleFlag" = TRUE, "updatedAt" = NOW()
      WHERE p."ownerUserId" IS NOT NULL
        AND COALESCE(p."lastActivityAt", p."claimedAt") < NOW() - INTERVAL '14 days'
        AND p."staleFlag" = FALSE
        AND p."archivedAt" IS NULL AND p."mergedIntoId" IS NULL
        AND p."pipelineStage" NOT IN ('PARTNERED', 'NOT_INTERESTED', 'DISQUALIFIED')
        AND NOT (
          p."pipelineStage" = 'FOLLOW_UP_LATER'
          AND EXISTS (
            SELECT 1 FROM outreach_tasks t
             WHERE t."partnerOrganisationId" = p.id
               AND t.status IN ('open', 'in_progress')
               AND t."dueAt" > NOW()
          )
        )`
  );

  const atRiskCount = atRisk?.rowCount ?? 0;
  const staleCount = stale?.rowCount ?? 0;
  if (atRiskCount > 0 || staleCount > 0) {
    logger.info('redeem_ops.stale_sweep.done', { atRiskFlagged: atRiskCount, staleFlagged: staleCount });
  }
  return { atRiskFlagged: atRiskCount, staleFlagged: staleCount };
}
