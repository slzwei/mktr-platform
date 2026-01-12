import { User, LeadPackageAssignment, sequelize } from '../models/index.js';
import { Op } from 'sequelize';

/**
 * Deducts lead credits from an agent's account.
 * Prioritizes active Lead Package Assignments (FIFO), then User.owed_leads_count.
 * @param {string} agentId - UUID of the agent
 * @param {number} amount - Number of leads to deduct (default 1)
 * @returns {Promise<boolean>} - True if deduction occurred (fully or partially)
 */
export async function deductLeadCredit(agentId, amount = 1) {
    if (!agentId || amount <= 0) return false;

    const t = await sequelize.transaction();
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

        await t.commit();

        // Log if we couldn't deduct full amount (unpaid lead?)
        if (remainingToDeduct > 0 && remainingToDeduct < amount) {
            // Partial deduction
        } else if (remainingToDeduct === amount) {
            // No deduction possible
            return false;
        }

        return true;

    } catch (error) {
        await t.rollback();
        console.error('Error deducting lead credits:', error);
        // Don't throw, just return false so we don't break the prospect creation flow
        return false;
    }
}
