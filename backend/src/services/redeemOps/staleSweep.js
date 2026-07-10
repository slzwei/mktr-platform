import { sequelize } from '../../models/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Claim-inactivity sweep (brief §16, docs/redeem-ops/ERD.md §6). Flags only —
 * records are NEVER auto-released; managers act on the flags (queue + pipeline
 * views). Runs in-process on the bootstrap interval (house pattern: releaseSweep).
 *
 *  - atRiskFlag: claimed >48h ago, still no first outreach.
 *  - staleFlag:  no meaningful activity for >14 days — EXCEPT a snoozed
 *    partner whose wake date or open task is still in the future, and
 *    terminal stages (PARTNERED/LOST). Expired snoozes are woken here too.
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
        AND p."pipelineStage" NOT IN ('PARTNERED', 'LOST')
        AND NOT (
          p.availability = 'follow_up_later'
          AND (
            (p."snoozedUntil" IS NOT NULL AND p."snoozedUntil" > NOW())
            OR EXISTS (
              SELECT 1 FROM outreach_tasks t
               WHERE t."partnerOrganisationId" = p.id
                 AND t.status IN ('open', 'in_progress')
                 AND t."dueAt" > NOW()
            )
          )
        )`
  );

  // Wake expired snoozes: back to the working pool/queue.
  const [, woken] = await sequelize.query(
    `UPDATE partner_organisations
        SET availability = CASE WHEN "ownerUserId" IS NULL THEN 'available' ELSE 'owned' END,
            "snoozedUntil" = NULL, "updatedAt" = NOW()
      WHERE availability = 'follow_up_later'
        AND "snoozedUntil" IS NOT NULL AND "snoozedUntil" < NOW()
        AND "archivedAt" IS NULL AND "mergedIntoId" IS NULL`
  );
  const wokenCount = woken?.rowCount ?? 0;
  if (wokenCount > 0) logger.info('redeem_ops.stale_sweep.woken', { woken: wokenCount });

  const atRiskCount = atRisk?.rowCount ?? 0;
  const staleCount = stale?.rowCount ?? 0;
  if (atRiskCount > 0 || staleCount > 0) {
    logger.info('redeem_ops.stale_sweep.done', { atRiskFlagged: atRiskCount, staleFlagged: staleCount });
  }
  return { atRiskFlagged: atRiskCount, staleFlagged: staleCount };
}
