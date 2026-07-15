/**
 * Agent wallet + per-campaign lead commitments (docs/plans/agent-wallet-commitments.md).
 *
 * Money-path invariants:
 *  1. Every balance mutation = ONE ledger INSERT + ONE guarded balance UPDATE in the
 *     SAME transaction (applyLedgerEntry). The guarded UPDATE
 *     (`walletBalanceCents + :amount >= 0` in the WHERE) is the atomic overdraft check —
 *     no read-modify-write race.
 *  2. wallet_ledger is append-only audit truth; users.walletBalanceCents is the fast read.
 *  3. A commitment is a normal LeadPackageAssignment (source:'wallet') under a hidden
 *     per-campaign wallet LeadPackage (kind:'wallet', isPublic:false, price 0) — routing,
 *     charging and drain-down are untouched (systemAgent.js joins assignments through
 *     LeadPackage.campaignId regardless of kind/source).
 *  4. The ONLY refund is the campaign-takedown refund (archive; 'completed' is unreachable
 *     today). Pause holds. No self-cancel. Manual admin `adjustment` (note required) is
 *     the sole escape hatch.
 *  5. Commit-ability = campaign active + leadPriceCents non-null. It never reads
 *     campaign.externalEligible (the inert ExternalAgent buyer-pool flag).
 *
 * DI-factory (house pattern) so it unit-tests without a DB.
 */
import { Op } from 'sequelize';
import { User, Campaign, LeadPackage, LeadPackageAssignment, WalletLedger, sequelize } from '../models/index.js';
import { getSystemAgentId } from './systemAgent.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const MAX_COMMIT_QUANTITY = 10000; // fat-finger guard; the wallet balance is the real bound

export function makeWalletService(overrides = {}) {
  const d = { User, Campaign, LeadPackage, LeadPackageAssignment, WalletLedger, sequelize, getSystemAgentId, logger, ...overrides };

  /**
   * The single write path: guarded atomic balance UPDATE + ledger INSERT, in the
   * caller's transaction (or its own). `amountCents` is SIGNED. Throws:
   *  - 409 insufficient_balance when a debit would go below zero
   *  - 404 when the agent row doesn't exist
   * Returns the created ledger row (with balanceAfterCents).
   */
  async function applyLedgerEntry(agentId, amountCents, { type, paymentId = null, assignmentId = null, campaignId = null, note = null, createdBy = null, transaction = null } = {}) {
    if (!Number.isInteger(amountCents) || amountCents === 0) {
      throw new AppError('Ledger amount must be a non-zero integer (cents)', 400);
    }
    if (!type) throw new AppError('Ledger type is required', 400);

    const run = async (t) => {
      const [rows] = await d.sequelize.query(
        `UPDATE users
            SET "walletBalanceCents" = "walletBalanceCents" + :amount
          WHERE id = :agentId AND "walletBalanceCents" + :amount >= 0
          RETURNING "walletBalanceCents"`,
        { replacements: { amount: amountCents, agentId }, transaction: t }
      );
      if (!rows || rows.length === 0) {
        // Distinguish missing user from overdraft for a truthful error.
        const exists = await d.User.count({ where: { id: agentId }, transaction: t });
        if (!exists) throw new AppError('Agent not found', 404);
        throw new AppError('Insufficient wallet balance', 409);
      }
      const balanceAfterCents = rows[0].walletBalanceCents;
      const entry = await d.WalletLedger.create(
        { agentId, type, amountCents, balanceAfterCents, paymentId, assignmentId, campaignId, note, createdBy },
        { transaction: t }
      );
      return entry;
    };

    return transaction ? run(transaction) : d.sequelize.transaction(run);
  }

  const credit = (agentId, amountCents, opts = {}) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AppError('Credit amount must be a positive integer (cents)', 400);
    return applyLedgerEntry(agentId, amountCents, opts);
  };
  const debit = (agentId, amountCents, opts = {}) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AppError('Debit amount must be a positive integer (cents)', 400);
    return applyLedgerEntry(agentId, -amountCents, opts);
  };

  /**
   * Find-or-create the campaign's hidden wallet package. The UNIQUE partial index
   * (campaignId WHERE kind='wallet') makes the create race-safe: a concurrent first
   * commit loses the insert and re-reads the winner's row.
   */
  async function ensureWalletPackage(campaignId, transaction) {
    const existing = await d.LeadPackage.findOne({ where: { campaignId, kind: 'wallet' }, transaction });
    if (existing) return existing;
    const systemAgentId = await d.getSystemAgentId();
    try {
      return await d.LeadPackage.create(
        {
          name: 'Wallet commitments',
          type: 'custom',
          kind: 'wallet',
          campaignId,
          isPublic: false,
          status: 'active',
          currency: 'SGD',
          price: 0,
          leadCount: 0,
          createdBy: systemAgentId,
        },
        { transaction }
      );
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        const winner = await d.LeadPackage.findOne({ where: { campaignId, kind: 'wallet' }, transaction });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Agent self-serve commit: N leads of campaign X at the admin-set price.
   * One transaction: validate → ensure wallet package → create assignment →
   * debit (guarded; overdraft rolls the assignment back). No cancel path exists.
   */
  async function commit(agentId, campaignId, quantity) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_COMMIT_QUANTITY) {
      throw new AppError(`Quantity must be an integer between 1 and ${MAX_COMMIT_QUANTITY}`, 400);
    }

    const result = await d.sequelize.transaction(async (t) => {
      const campaign = await d.Campaign.findByPk(campaignId, { transaction: t });
      if (!campaign) throw new AppError('Campaign not found', 404);
      const priced = Number.isInteger(campaign.leadPriceCents) && campaign.leadPriceCents > 0;
      if (campaign.status !== 'active' || campaign.is_active !== true || !priced) {
        throw new AppError('This campaign is not open for commitments', 409);
      }

      const totalCents = quantity * campaign.leadPriceCents;
      const pkg = await ensureWalletPackage(campaignId, t);
      const assignment = await d.LeadPackageAssignment.create(
        {
          agentId,
          leadPackageId: pkg.id,
          source: 'wallet',
          unitPriceCents: campaign.leadPriceCents,
          leadsTotal: quantity,
          leadsRemaining: quantity,
          priceSnapshot: (totalCents / 100).toFixed(2),
          status: 'active',
          purchaseDate: new Date(),
        },
        { transaction: t }
      );
      const entry = await debit(agentId, totalCents, {
        type: 'commit',
        assignmentId: assignment.id,
        campaignId,
        transaction: t,
      });

      return {
        assignmentId: assignment.id,
        campaignId,
        campaignName: campaign.name,
        quantity,
        unitPriceCents: campaign.leadPriceCents,
        totalCents,
        balanceCents: entry.balanceAfterCents,
      };
    });

    d.logger.info('[wallet] commit.created', { agentId, campaignId, quantity, totalCents: result.totalCents, assignmentId: result.assignmentId });
    return result;
  }

  /**
   * Campaign-takedown refund: every open wallet commitment returns its undelivered
   * remainder as credits (leadsRemaining × unitPriceCents). MUST run inside the
   * caller's transaction (archiveCampaign owns the campaign lock). Concurrency-safe:
   * rows are re-selected FOR UPDATE and re-checked; the unique partial ledger index
   * (one takedown_refund per assignment) is the backstop against double-credit.
   */
  async function refundCampaignCommitments(campaignId, { reason = 'campaign_archived', transaction } = {}) {
    if (!transaction) throw new AppError('refundCampaignCommitments requires the caller transaction', 500);

    const candidates = await d.LeadPackageAssignment.findAll({
      attributes: ['id'],
      where: { source: 'wallet', status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      include: [{ model: d.LeadPackage, as: 'package', where: { campaignId }, required: true, attributes: [] }],
      transaction,
    });
    if (candidates.length === 0) return { refunded: 0, totalCents: 0 };

    const locked = await d.LeadPackageAssignment.findAll({
      where: { id: candidates.map((r) => r.id) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    let refunded = 0;
    let totalCents = 0;
    for (const row of locked) {
      // Re-check under the lock — a concurrent archive may have completed it.
      if (row.source !== 'wallet' || row.status !== 'active' || !(row.leadsRemaining > 0)) continue;
      if (!Number.isInteger(row.unitPriceCents) || row.unitPriceCents <= 0) {
        d.logger.error('[wallet] refund.skipped — wallet assignment missing unitPriceCents', { assignmentId: row.id, campaignId });
        continue;
      }
      const refundCents = row.leadsRemaining * row.unitPriceCents;
      try {
        await credit(row.agentId, refundCents, {
          type: 'takedown_refund',
          assignmentId: row.id,
          campaignId,
          note: reason,
          transaction,
        });
      } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError') {
          d.logger.warn('[wallet] refund.replay — assignment already refunded', { assignmentId: row.id, campaignId });
          continue;
        }
        throw err;
      }
      await row.update({ leadsRemaining: 0, status: 'completed' }, { transaction });
      refunded += 1;
      totalCents += refundCents;
    }

    if (refunded > 0) d.logger.info('[wallet] takedown_refund.applied', { campaignId, refunded, totalCents, reason });
    return { refunded, totalCents };
  }

  /** Commit-able campaigns for the external catalog — whitelisted fields only. */
  async function getCatalog() {
    const rows = await d.Campaign.findAll({
      where: { status: 'active', is_active: true, leadPriceCents: { [Op.ne]: null } },
      attributes: ['id', 'name', 'description', 'leadPriceCents', 'start_date', 'end_date'],
      order: [['createdAt', 'DESC']],
    });
    return rows
      .filter((c) => Number.isInteger(c.leadPriceCents) && c.leadPriceCents > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: typeof c.description === 'string' && c.description.trim() ? c.description.trim() : null,
        leadPriceCents: c.leadPriceCents,
        startDate: c.start_date ?? null,
        endDate: c.end_date ?? null,
      }));
  }

  /** Open wallet commitments for one agent (active, remainder > 0), campaign-labelled. */
  async function openCommitmentsFor(agentIds) {
    const rows = await d.LeadPackageAssignment.findAll({
      where: { agentId: agentIds, source: 'wallet', status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      include: [{ model: d.LeadPackage, as: 'package', attributes: ['campaignId'], include: [{ model: d.Campaign, as: 'campaign', attributes: ['id', 'name'] }] }],
      order: [['purchaseDate', 'ASC']],
    });
    return rows.map((r) => ({
      agentId: r.agentId,
      assignmentId: r.id,
      campaignId: r.package?.campaignId ?? null,
      campaign: r.package?.campaign?.name ?? null,
      remaining: r.leadsRemaining,
      unitPriceCents: r.unitPriceCents,
      committedValueCents: Number.isInteger(r.unitPriceCents) ? r.leadsRemaining * r.unitPriceCents : null,
    }));
  }

  /** Balance + open commitments for the agent app. */
  async function getSummary(agentId) {
    const user = await d.User.findByPk(agentId, { attributes: ['id', 'walletBalanceCents'] });
    if (!user) throw new AppError('Agent not found', 404);
    const openCommitments = await openCommitmentsFor([agentId]);
    return {
      balanceCents: user.walletBalanceCents,
      openCommitments: openCommitments.map(({ agentId: _drop, ...rest }) => rest),
    };
  }

  /** Paginated ledger, newest first. */
  async function getLedger(agentId, { page = 1, limit = 25 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const { rows, count } = await d.WalletLedger.findAndCountAll({
      where: { agentId },
      order: [['createdAt', 'DESC']],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
    });
    return {
      entries: rows.map((e) => ({
        id: e.id,
        type: e.type,
        amountCents: e.amountCents,
        balanceAfterCents: e.balanceAfterCents,
        campaignId: e.campaignId,
        assignmentId: e.assignmentId,
        paymentId: e.paymentId,
        note: e.note,
        createdAt: (e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)).toISOString(),
      })),
      total: count,
      page: safePage,
      limit: safeLimit,
    };
  }

  /**
   * Admin roster: EXTERNAL agents only (mktrLeadsId non-null — the v1 wallet
   * cohort), balances + open commitments + last ledger activity.
   */
  async function listWallets() {
    const agents = await d.User.findAll({
      where: { mktrLeadsId: { [Op.ne]: null }, role: 'agent' },
      attributes: ['id', 'firstName', 'lastName', 'fullName', 'email', 'isActive', 'walletBalanceCents'],
      order: [['createdAt', 'ASC']],
    });
    if (agents.length === 0) return [];

    const ids = agents.map((a) => a.id);
    const commitments = await openCommitmentsFor(ids);
    const byAgent = new Map();
    for (const c of commitments) {
      if (!byAgent.has(c.agentId)) byAgent.set(c.agentId, []);
      byAgent.get(c.agentId).push(c);
    }

    const [lastRows] = await d.sequelize.query(
      'SELECT "agentId", MAX("createdAt") AS "lastActivityAt" FROM wallet_ledger WHERE "agentId" IN (:ids) GROUP BY "agentId"',
      { replacements: { ids } }
    );
    const lastByAgent = new Map((lastRows || []).map((r) => [String(r.agentId), r.lastActivityAt]));

    return agents.map((a) => {
      const mine = (byAgent.get(a.id) || []).map(({ agentId: _drop, ...rest }) => rest);
      return {
        id: a.id,
        name: a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
        email: a.email,
        isActive: a.isActive,
        walletBalanceCents: a.walletBalanceCents,
        openCommitments: mine,
        committedLeads: mine.reduce((s, o) => s + (o.remaining || 0), 0),
        committedValueCents: mine.reduce((s, o) => s + (o.committedValueCents || 0), 0),
        lastActivityAt: lastByAgent.get(String(a.id)) ?? null,
      };
    });
  }

  /**
   * Admin manual adjustment — the ONLY admin-side ledger mutation. Signed cents,
   * mandatory note, actor recorded. Negative adjustments obey the >= 0 guard.
   */
  async function adminAdjust(agentId, amountCents, note, actorId) {
    if (!Number.isInteger(amountCents) || amountCents === 0) {
      throw new AppError('Adjustment amount must be a non-zero integer (cents)', 400);
    }
    if (typeof note !== 'string' || !note.trim()) {
      throw new AppError('A note is required for manual adjustments', 400);
    }
    const target = await d.User.findOne({ where: { id: agentId, mktrLeadsId: { [Op.ne]: null } }, attributes: ['id'] });
    if (!target) throw new AppError('Agent not found or not an external (wallet) agent', 404);

    const entry = await applyLedgerEntry(agentId, amountCents, {
      type: 'adjustment',
      note: note.trim(),
      createdBy: actorId ?? null,
    });
    d.logger.info('[wallet] adjustment.applied', { agentId, amountCents, actorId: actorId ?? null });
    return { balanceCents: entry.balanceAfterCents, entryId: entry.id };
  }

  return { applyLedgerEntry, credit, debit, commit, refundCampaignCommitments, getCatalog, getSummary, getLedger, listWallets, adminAdjust, ensureWalletPackage };
}

// --- Backward-compatible named exports (house pattern) ---
const _default = makeWalletService();
export const credit = _default.credit;
export const debit = _default.debit;
export const commit = _default.commit;
export const refundCampaignCommitments = _default.refundCampaignCommitments;
export const getCatalog = _default.getCatalog;
export const getSummary = _default.getSummary;
export const getLedger = _default.getLedger;
export const listWallets = _default.listWallets;
export const adminAdjust = _default.adminAdjust;
