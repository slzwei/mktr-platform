import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Helpers ──

function buildMocks() {
  const mockAssignment1 = {
    id: 'assign-1',
    agentId: 'agent-1',
    leadsRemaining: 5,
    status: 'active',
    purchaseDate: new Date('2025-01-01'),
    save: jest.fn().mockResolvedValue(true),
  };

  const mockAssignment2 = {
    id: 'assign-2',
    agentId: 'agent-1',
    leadsRemaining: 3,
    status: 'active',
    purchaseDate: new Date('2025-02-01'),
    save: jest.fn().mockResolvedValue(true),
  };

  const mockAgent = {
    id: 'agent-1',
    owed_leads_count: 10,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    LOCK: { UPDATE: 'UPDATE' },
  };

  const User = {
    findByPk: jest.fn().mockResolvedValue(mockAgent),
  };

  const LeadPackageAssignment = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const sequelize = {
    transaction: jest.fn().mockResolvedValue(mockTransaction),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return {
    mockAssignment1,
    mockAssignment2,
    mockAgent,
    mockTransaction,
    models: { User, LeadPackageAssignment },
    sequelize,
    logger,
  };
}

/**
 * Build a deductLeadCredit function that uses the provided mocks instead
 * of the real model imports.  This mirrors the makeProspectService DI pattern.
 */
function makeService(mocks) {
  const { User, LeadPackageAssignment } = mocks.models;
  const { sequelize, logger } = mocks;

  async function deductLeadCredit(agentId, amount = 1, externalTransaction = null) {
    if (!agentId || amount <= 0) return false;

    const ownTransaction = !externalTransaction;
    const t = externalTransaction || await sequelize.transaction();
    try {
      let remainingToDeduct = amount;

      // 1. FIFO from lead package assignments
      const assignments = await LeadPackageAssignment.findAll({
        where: {
          agentId,
          status: 'active',
          leadsRemaining: { [Op.gt]: 0 },
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

      // 2. Fallback to User.owed_leads_count
      if (remainingToDeduct > 0) {
        const agent = await User.findByPk(agentId, {
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

      if (remainingToDeduct > 0 && remainingToDeduct < amount) {
        // partial
      } else if (remainingToDeduct === amount) {
        return false;
      }

      return true;
    } catch (error) {
      if (ownTransaction) await t.rollback();
      logger.error('Error deducting lead credits', { error: error?.message || String(error) });
      return false;
    }
  }

  return { deductLeadCredit };
}

// ── Tests ──

describe('leadCredits – deductLeadCredit (unit)', () => {
  let mocks, service;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // FIFO deduction from LeadPackageAssignment
  // ────────────────────────────────────────────────

  it('deducts from the earliest package first (FIFO)', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([
      mocks.mockAssignment1, // 5 remaining, earlier date
      mocks.mockAssignment2, // 3 remaining, later date
    ]);

    const result = await service.deductLeadCredit('agent-1', 3);

    expect(result).toBe(true);
    expect(mocks.mockAssignment1.leadsRemaining).toBe(2);
    expect(mocks.mockAssignment1.save).toHaveBeenCalled();
    expect(mocks.mockAssignment2.save).not.toHaveBeenCalled();
  });

  it('deducts across multiple packages when first is insufficient', async () => {
    const assign1 = { ...mocks.mockAssignment1, leadsRemaining: 2, save: jest.fn().mockResolvedValue(true) };
    const assign2 = { ...mocks.mockAssignment2, leadsRemaining: 5, save: jest.fn().mockResolvedValue(true) };
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([assign1, assign2]);

    const result = await service.deductLeadCredit('agent-1', 4);

    expect(result).toBe(true);
    expect(assign1.leadsRemaining).toBe(0);
    expect(assign1.status).toBe('completed');
    expect(assign2.leadsRemaining).toBe(3);
    expect(assign1.save).toHaveBeenCalled();
    expect(assign2.save).toHaveBeenCalled();
  });

  it('marks assignment as completed when remaining hits 0', async () => {
    const assign = { ...mocks.mockAssignment1, leadsRemaining: 3, save: jest.fn().mockResolvedValue(true) };
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([assign]);

    await service.deductLeadCredit('agent-1', 3);

    expect(assign.leadsRemaining).toBe(0);
    expect(assign.status).toBe('completed');
  });

  it('does not mark assignment as completed when remaining > 0', async () => {
    const assign = { ...mocks.mockAssignment1, leadsRemaining: 5, status: 'active', save: jest.fn().mockResolvedValue(true) };
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([assign]);

    await service.deductLeadCredit('agent-1', 2);

    expect(assign.leadsRemaining).toBe(3);
    expect(assign.status).toBe('active');
  });

  // ────────────────────────────────────────────────
  // Fallback to User.owed_leads_count
  // ────────────────────────────────────────────────

  it('deducts from owed_leads_count when no packages exist', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    const agent = { ...mocks.mockAgent, owed_leads_count: 10, save: jest.fn().mockResolvedValue(true) };
    mocks.models.User.findByPk.mockResolvedValue(agent);

    const result = await service.deductLeadCredit('agent-1', 3);

    expect(result).toBe(true);
    expect(agent.owed_leads_count).toBe(7);
    expect(agent.save).toHaveBeenCalled();
  });

  it('deducts remaining from owed_leads_count when packages are exhausted', async () => {
    const assign = { ...mocks.mockAssignment1, leadsRemaining: 2, save: jest.fn().mockResolvedValue(true) };
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([assign]);
    const agent = { ...mocks.mockAgent, owed_leads_count: 10, save: jest.fn().mockResolvedValue(true) };
    mocks.models.User.findByPk.mockResolvedValue(agent);

    const result = await service.deductLeadCredit('agent-1', 5);

    expect(result).toBe(true);
    expect(assign.leadsRemaining).toBe(0);
    expect(assign.status).toBe('completed');
    expect(agent.owed_leads_count).toBe(7); // 10 - 3 remaining
  });

  // ────────────────────────────────────────────────
  // Edge cases: zero remaining, no credits
  // ────────────────────────────────────────────────

  it('returns false when both packages and owed_leads_count are zero', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    const agent = { ...mocks.mockAgent, owed_leads_count: 0, save: jest.fn().mockResolvedValue(true) };
    mocks.models.User.findByPk.mockResolvedValue(agent);

    const result = await service.deductLeadCredit('agent-1', 1);

    expect(result).toBe(false);
  });

  it('returns false when agent not found and no packages', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    mocks.models.User.findByPk.mockResolvedValue(null);

    const result = await service.deductLeadCredit('agent-1', 1);

    expect(result).toBe(false);
  });

  it('returns true for partial deduction (some credits available, less than requested)', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    const agent = { ...mocks.mockAgent, owed_leads_count: 2, save: jest.fn().mockResolvedValue(true) };
    mocks.models.User.findByPk.mockResolvedValue(agent);

    const result = await service.deductLeadCredit('agent-1', 5);

    expect(result).toBe(true); // partial deduction still returns true
    expect(agent.owed_leads_count).toBe(0);
  });

  // ────────────────────────────────────────────────
  // Validation
  // ────────────────────────────────────────────────

  it('returns false when agentId is null', async () => {
    const result = await service.deductLeadCredit(null, 1);

    expect(result).toBe(false);
    expect(mocks.models.LeadPackageAssignment.findAll).not.toHaveBeenCalled();
  });

  it('returns false when amount is 0', async () => {
    const result = await service.deductLeadCredit('agent-1', 0);
    expect(result).toBe(false);
  });

  it('returns false when amount is negative', async () => {
    const result = await service.deductLeadCredit('agent-1', -5);
    expect(result).toBe(false);
  });

  // ────────────────────────────────────────────────
  // Transaction handling
  // ────────────────────────────────────────────────

  it('uses external transaction when provided (no commit/rollback)', async () => {
    const extTx = {
      LOCK: { UPDATE: 'UPDATE' },
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    const agent = { ...mocks.mockAgent, owed_leads_count: 5, save: jest.fn().mockResolvedValue(true) };
    mocks.models.User.findByPk.mockResolvedValue(agent);

    await service.deductLeadCredit('agent-1', 1, extTx);

    expect(mocks.sequelize.transaction).not.toHaveBeenCalled();
    expect(extTx.commit).not.toHaveBeenCalled();
    expect(extTx.rollback).not.toHaveBeenCalled();
  });

  it('commits own transaction on success', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    const agent = { ...mocks.mockAgent, owed_leads_count: 5, save: jest.fn().mockResolvedValue(true) };
    mocks.models.User.findByPk.mockResolvedValue(agent);

    await service.deductLeadCredit('agent-1', 1);

    expect(mocks.mockTransaction.commit).toHaveBeenCalled();
  });

  it('rolls back own transaction on error', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockRejectedValue(new Error('DB error'));

    const result = await service.deductLeadCredit('agent-1', 1);

    expect(result).toBe(false);
    expect(mocks.mockTransaction.rollback).toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it('passes FOR UPDATE lock to findAll', async () => {
    mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([]);
    mocks.models.User.findByPk.mockResolvedValue(null);

    await service.deductLeadCredit('agent-1', 1);

    const findAllArg = mocks.models.LeadPackageAssignment.findAll.mock.calls[0][0];
    expect(findAllArg.lock).toBe('UPDATE');
  });
});
