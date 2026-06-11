import { User, LeadPackageAssignment, LeadPackage, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../utils/logger.js';

/**
 * Lead-credit accounting. DI factory (house pattern) so the REAL implementation
 * is unit-testable — the previous test file re-implemented deductLeadCredit
 * inside itself and protected nothing (Codex review finding).
 */
export function makeLeadCreditsService(overrides = {}) {
  const d = { User, LeadPackageAssignment, LeadPackage, sequelize, logger, ...overrides };

  /**
   * Best-effort deduction of lead credits from an agent's account, scoped to a
   * campaign. Draws FIFO (by purchaseDate) from the agent's active package
   * assignments **belonging to `campaignId`** — credits bought for campaign A
   * can never be drained by a campaign-B (or campaignless) lead. Falls back to
   * the campaign-agnostic manual `users.owed_leads_count` bucket, mirroring
   * chargeLeadCredit's two-tier semantics.
   *
   * `campaignId: null` (campaignless lead) skips package deduction entirely —
   * packages are purchased FOR a campaign — and only the manual bucket pays.
   *
   * Options-object signature (NOT positional): a legacy-style call like
   * deductLeadCredit(agentId, 1, t) would have silently read `1` as a campaign
   * and the transaction as an amount. Non-object input is rejected with a
   * structured log + false — this stays best-effort and never throws into
   * callers.
   *
   * Locking note: campaign scoping is two-step — an unlocked read of the
   * campaign's package ids (static rows), then the original single-table
   * `FOR UPDATE` on assignments filtered by those ids. No join under the lock,
   * so none of the FOR-UPDATE-across-join pitfalls apply.
   *
   * @param {object} opts
   * @param {string} opts.agentId
   * @param {string|null} [opts.campaignId]  Campaign whose packages may pay.
   * @param {number} [opts.amount=1]
   * @param {import('sequelize').Transaction|null} [opts.transaction]
   * @returns {Promise<boolean>} true if any deduction occurred
   */
  async function deductLeadCredit(opts) {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
      d.logger.error('deductLeadCredit called with positional args — options object required', {
        receivedType: Array.isArray(opts) ? 'array' : typeof opts,
      });
      return false;
    }
    const { agentId, campaignId = null, amount = 1, transaction = null } = opts;
    if (!agentId || typeof agentId !== 'string' || !(amount > 0)) return false;

    const ownTransaction = !transaction;
    const t = transaction || await d.sequelize.transaction();
    try {
      let remainingToDeduct = amount;

      // 1. FIFO from THIS campaign's package assignments (skipped entirely
      //    when the lead has no campaign).
      if (campaignId) {
        const campaignPackages = await d.LeadPackage.findAll({
          where: { campaignId },
          attributes: ['id'],
          transaction: t,
        });
        const packageIds = campaignPackages.map((p) => p.id);

        if (packageIds.length > 0) {
          const assignments = await d.LeadPackageAssignment.findAll({
            where: {
              agentId,
              status: 'active',
              leadsRemaining: { [Op.gt]: 0 },
              leadPackageId: { [Op.in]: packageIds },
            },
            order: [['purchaseDate', 'ASC']],
            transaction: t,
            lock: t.LOCK.UPDATE,
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
        }
      }

      // 2. If packages didn't cover it, the campaign-agnostic manual bucket.
      if (remainingToDeduct > 0) {
        const agent = await d.User.findByPk(agentId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
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

      // No credit source could pay anything.
      if (remainingToDeduct === amount) {
        return false;
      }

      return true;

    } catch (error) {
      if (ownTransaction) await t.rollback();
      d.logger.error('Error deducting lead credits', { error: error?.message || String(error) });
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
  async function deductExternalLeadBalance(externalAgentId, amount = 1, externalTransaction = null) {
    if (!externalAgentId || amount <= 0) return false;

    const ownTransaction = !externalTransaction;
    const t = externalTransaction || await d.sequelize.transaction();
    try {
      const [rows] = await d.sequelize.query(
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
      d.logger.error('Error deducting external lead balance', { error: error?.message || String(error) });
      return false;
    }
  }

  /**
   * Authoritatively charge ONE lead credit to an agent, scoped to a campaign.
   *
   * This is the GATE for hard-quota campaigns. Unlike `deductLeadCredit` (best-effort,
   * returns true even on a partial charge), this:
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
  async function chargeLeadCredit(agentId, campaignId, externalTransaction = null) {
    if (!agentId || !campaignId) return false;

    const ownTransaction = !externalTransaction;
    const t = externalTransaction || await d.sequelize.transaction();
    try {
      // 1) Oldest active package for THIS campaign that still has a credit.
      //    SKIP LOCKED so concurrent charges pick different rows (or skip) — the
      //    last credit is taken by exactly one caller, never double-spent.
      const [pkgRows] = await d.sequelize.query(
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
        const [owedRows] = await d.sequelize.query(
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
      d.logger.error('Error charging lead credit', { error: error?.message || String(error), agentId, campaignId });
      if (ownTransaction) {
        await t.rollback().catch(() => {});
        return false;
      }
      // Caller owns the transaction — surface the error so it rolls back rather than
      // continuing on a poisoned transaction.
      throw error;
    }
  }

  return { deductLeadCredit, deductExternalLeadBalance, chargeLeadCredit };
}

// --- Backward-compatible named exports (house pattern) ---
const _default = makeLeadCreditsService();
export const deductLeadCredit = _default.deductLeadCredit;
export const deductExternalLeadBalance = _default.deductExternalLeadBalance;
export const chargeLeadCredit = _default.chargeLeadCredit;
