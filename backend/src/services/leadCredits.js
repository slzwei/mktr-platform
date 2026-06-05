import { User, LeadPackageAssignment, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../utils/logger.js';

/**
 * Deducts lead credits from an agent's account.
 * Prioritizes active Lead Package Assignments (FIFO), then User.owed_leads_count.
 * @param {string} agentId - UUID of the agent
 * @param {number} amount - Number of leads to deduct (default 1)
 * @returns {Promise<boolean>} - True if deduction occurred (fully or partially)
 */
export async function deductLeadCredit(agentId, amount = 1, externalTransaction = null) {
    if (!agentId || amount <= 0) return false;

    // If caller passed a transaction, use it (no nested transaction).
    // Otherwise create our own.
    const ownTransaction = !externalTransaction;
    const t = externalTransaction || await sequelize.transaction();
    try {
        let remainingToDeduct = amount;

        // 1. Try to deduct from Lead Assignments first (FIFO)
        const assignments = await LeadPackageAssignment.findAll({
            where: {
                agentId,
                status: 'active',
                leadsRemaining: { [Op.gt]: 0 }
            },
            order: [['purchaseDate', 'ASC']],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        for (const assignment of assignments) {
            if (remainingToDeduct <= 0) break;

            const available = assignment.leadsRemaining;
            const deduction = Math.min(available, remainingToDeduct);

            assignment.leadsRemaining -= deduction;
            remainingToDeduct -= deduction;

            if (assignment.leadsRemaining === 0) {
                assignment.status = 'completed';
            }

            await assignment.save({ transaction: t });
        }

        // 2. If packages didn't cover it, try owed_leads_count on User
        if (remainingToDeduct > 0) {
            const agent = await User.findByPk(agentId, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (agent && agent.owed_leads_count > 0) {
                const available = agent.owed_leads_count;
                const deduction = Math.min(available, remainingToDeduct);

                agent.owed_leads_count -= deduction;
                remainingToDeduct -= deduction;

                await agent.save({ transaction: t });
            }
        }

        if (ownTransaction) await t.commit();

        // Log if we couldn't deduct full amount (unpaid lead?)
        if (remainingToDeduct > 0 && remainingToDeduct < amount) {
            // Partial deduction
        } else if (remainingToDeduct === amount) {
            // No deduction possible
            return false;
        }

        return true;

    } catch (error) {
        if (ownTransaction) await t.rollback();
        logger.error('Error deducting lead credits', { error: error?.message || String(error) });
        // Don't throw, just return false so we don't break the prospect creation flow
        return false;
    }
}

/**
 * Atomically deduct `amount` from an external agent's GLOBAL prepaid balance.
 *
 * The check-and-decrement is a single conditional UPDATE (... WHERE
 * "leadBalance" >= amount RETURNING id), so it is race-safe under concurrent
 * assignments and across multiple backend instances. Returns true only if the
 * balance was actually decremented.
 *
 * IMPORTANT: unlike deductLeadCredit (internal, best-effort), a `false` here
 * MUST block delivery to that buyer — external leads are paid, so a lead is
 * never handed to a buyer whose balance we could not charge.
 *
 * @param {string} externalAgentId
 * @param {number} amount
 * @param {import('sequelize').Transaction|null} externalTransaction
 * @returns {Promise<boolean>}
 */
export async function deductExternalLeadBalance(externalAgentId, amount = 1, externalTransaction = null) {
    if (!externalAgentId || amount <= 0) return false;

    const ownTransaction = !externalTransaction;
    const t = externalTransaction || await sequelize.transaction();
    try {
        const [rows] = await sequelize.query(
            `UPDATE external_agents
                SET "leadBalance" = "leadBalance" - :amount, "updatedAt" = NOW()
              WHERE id = :id AND "leadBalance" >= :amount
              RETURNING id`,
            { replacements: { id: externalAgentId, amount }, transaction: t }
        );
        const ok = Array.isArray(rows) && rows.length > 0;

        if (ownTransaction) await t.commit();
        return ok;
    } catch (error) {
        if (ownTransaction) await t.rollback();
        logger.error('Error deducting external lead balance', { error: error?.message || String(error) });
        return false;
    }
}

/**
 * Authoritatively charge ONE lead credit to an agent, scoped to a campaign.
 *
 * This is the GATE for hard-quota campaigns. Unlike `deductLeadCredit` (best-effort,
 * campaign-agnostic, returns true even on a partial/zero charge), this:
 *   - draws ONLY from packages tied to `campaignId` (so the charge matches the
 *     campaign that made the agent eligible in the round-robin),
 *   - is atomic & race-safe: a CTE picks the oldest eligible package
 *     `FOR UPDATE SKIP LOCKED` and decrements it in one statement, so the last credit
 *     is never double-spent and `leadsRemaining` never goes negative,
 *   - returns true ONLY if a full credit was charged. A `false` MUST block delivery —
 *     the caller quarantines the lead rather than hand it out unpaid.
 *
 * Falls back to the agent's campaign-agnostic `owed_leads_count` bucket. When a caller
 * transaction is passed it is used (NOT committed); otherwise this owns its own.
 * A clean "no credit" outcome returns false WITHOUT poisoning the caller's transaction
 * (the guarded UPDATEs simply match zero rows); only real DB errors propagate.
 *
 * @param {string} agentId
 * @param {string} campaignId
 * @param {import('sequelize').Transaction|null} externalTransaction
 * @returns {Promise<boolean>} true iff exactly one credit was charged
 */
export async function chargeLeadCredit(agentId, campaignId, externalTransaction = null) {
    if (!agentId || !campaignId) return false;

    const ownTransaction = !externalTransaction;
    const t = externalTransaction || await sequelize.transaction();
    try {
        // 1) Oldest active package for THIS campaign that still has a credit.
        //    SKIP LOCKED so concurrent charges pick different rows (or skip) — the
        //    last credit is taken by exactly one caller, never double-spent.
        const [pkgRows] = await sequelize.query(
            `WITH picked AS (
                 SELECT a.id
                   FROM lead_package_assignments a
                   JOIN lead_packages p ON p.id = a."leadPackageId"
                  WHERE a."agentId" = :agentId
                    AND a.status = 'active'
                    AND a."leadsRemaining" >= 1
                    AND p."campaignId" = :campaignId
                  ORDER BY a."purchaseDate" ASC
                  LIMIT 1
                  FOR UPDATE OF a SKIP LOCKED
             )
             UPDATE lead_package_assignments lpa
                SET "leadsRemaining" = lpa."leadsRemaining" - 1,
                    status = CASE WHEN lpa."leadsRemaining" - 1 = 0 THEN 'completed' ELSE lpa.status END,
                    "updatedAt" = NOW()
               FROM picked
              WHERE lpa.id = picked.id
              RETURNING lpa.id`,
            { replacements: { agentId, campaignId }, transaction: t }
        );

        let charged = Array.isArray(pkgRows) && pkgRows.length > 0;

        // 2) Fallback: the agent's campaign-agnostic owed_leads_count bucket.
        if (!charged) {
            const [owedRows] = await sequelize.query(
                `UPDATE users
                    SET owed_leads_count = owed_leads_count - 1, "updatedAt" = NOW()
                  WHERE id = :agentId AND owed_leads_count >= 1
                  RETURNING id`,
                { replacements: { agentId }, transaction: t }
            );
            charged = Array.isArray(owedRows) && owedRows.length > 0;
        }

        if (ownTransaction) await t.commit();
        return charged;
    } catch (error) {
        logger.error('Error charging lead credit', { error: error?.message || String(error), agentId, campaignId });
        if (ownTransaction) {
            await t.rollback().catch(() => {});
            return false;
        }
        // Caller owns the transaction — surface the error so it rolls back rather than
        // continuing on a poisoned transaction.
        throw error;
    }
}
