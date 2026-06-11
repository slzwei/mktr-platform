import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';
import { makeLeadCreditsService } from '../../src/services/leadCredits.js';

/**
 * Tests the REAL deductLeadCredit via the DI factory. (The previous version of
 * this file re-implemented the function inside the test and asserted against
 * the copy — it protected nothing and silently drifted; Codex review finding.)
 *
 * Core invariant under test: deduction is CAMPAIGN-SCOPED — campaign A's leads
 * can only consume campaign A's package credits (then the campaign-agnostic
 * manual owed_leads_count bucket). Cross-campaign bleed was the production bug.
 */

function buildMocks({ packages = [], assignments = [], agent = null } = {}) {
  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    LOCK: { UPDATE: 'UPDATE' },
  };
  return {
    mockTransaction,
    LeadPackage: { findAll: jest.fn().mockResolvedValue(packages) },
    LeadPackageAssignment: { findAll: jest.fn().mockResolvedValue(assignments) },
    User: { findByPk: jest.fn().mockResolvedValue(agent) },
    sequelize: { transaction: jest.fn().mockResolvedValue(mockTransaction) },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  };
}

const makeAssignment = (over = {}) => ({
  id: 'assign-1',
  agentId: 'agent-1',
  leadsRemaining: 5,
  status: 'active',
  purchaseDate: new Date('2025-01-01'),
  save: jest.fn().mockResolvedValue(true),
  ...over,
});

const makeAgent = (owed = 10) => ({
  id: 'agent-1',
  owed_leads_count: owed,
  save: jest.fn().mockResolvedValue(true),
});

describe('leadCredits – deductLeadCredit (real implementation, DI)', () => {
  it('rejects positional (legacy-style) calls with a structured log, never throws', async () => {
    const m = buildMocks();
    const svc = makeLeadCreditsService(m);

    // The old signature was (agentId, amount, tx) — must not be silently misread.
    const result = await svc.deductLeadCredit('agent-1');

    expect(result).toBe(false);
    expect(m.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('options object required'),
      expect.any(Object)
    );
    expect(m.sequelize.transaction).not.toHaveBeenCalled();
  });

  it('returns false for missing agentId or non-positive amount', async () => {
    const m = buildMocks();
    const svc = makeLeadCreditsService(m);
    expect(await svc.deductLeadCredit({ campaignId: 'camp-1' })).toBe(false);
    expect(await svc.deductLeadCredit({ agentId: 'agent-1', amount: 0 })).toBe(false);
  });

  it("scopes package deduction to the campaign: only that campaign's package ids are queried", async () => {
    const a1 = makeAssignment({ leadsRemaining: 3 });
    const m = buildMocks({ packages: [{ id: 'pkg-A' }], assignments: [a1], agent: makeAgent(0) });
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: 'camp-A', amount: 2 });

    expect(result).toBe(true);
    // Step 1: the campaign's packages were looked up…
    expect(m.LeadPackage.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'camp-A' } })
    );
    // …step 2: assignments are filtered to those package ids (single-table lock, no join).
    const q = m.LeadPackageAssignment.findAll.mock.calls[0][0];
    expect(q.where.leadPackageId).toEqual({ [Op.in]: ['pkg-A'] });
    expect(q.lock).toBe('UPDATE');
    expect(a1.leadsRemaining).toBe(1);
  });

  it('drains FIFO across multiple assignments within the campaign and completes emptied ones', async () => {
    const older = makeAssignment({ id: 'a-old', leadsRemaining: 2, purchaseDate: new Date('2025-01-01') });
    const newer = makeAssignment({ id: 'a-new', leadsRemaining: 5, purchaseDate: new Date('2025-02-01') });
    const m = buildMocks({ packages: [{ id: 'pkg-A' }], assignments: [older, newer], agent: makeAgent(0) });
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: 'camp-A', amount: 3 });

    expect(result).toBe(true);
    expect(older.leadsRemaining).toBe(0);
    expect(older.status).toBe('completed');
    expect(newer.leadsRemaining).toBe(4);
  });

  it('campaign with NO matching packages: package phase skipped, manual bucket pays', async () => {
    const agent = makeAgent(5);
    const m = buildMocks({ packages: [], assignments: [], agent });
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: 'camp-B', amount: 2 });

    expect(result).toBe(true);
    // No package ids → assignment query never runs (nothing to lock).
    expect(m.LeadPackageAssignment.findAll).not.toHaveBeenCalled();
    expect(agent.owed_leads_count).toBe(3);
  });

  it('campaignless lead (campaignId null): NEVER touches packages, only the manual bucket', async () => {
    const agent = makeAgent(4);
    const m = buildMocks({ packages: [{ id: 'pkg-A' }], assignments: [makeAssignment()], agent });
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: null });

    expect(result).toBe(true);
    expect(m.LeadPackage.findAll).not.toHaveBeenCalled();
    expect(m.LeadPackageAssignment.findAll).not.toHaveBeenCalled();
    expect(agent.owed_leads_count).toBe(3);
  });

  it('falls back to the manual bucket only for the REMAINDER the campaign packages could not cover', async () => {
    const a1 = makeAssignment({ leadsRemaining: 1 });
    const agent = makeAgent(10);
    const m = buildMocks({ packages: [{ id: 'pkg-A' }], assignments: [a1], agent });
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: 'camp-A', amount: 3 });

    expect(result).toBe(true);
    expect(a1.leadsRemaining).toBe(0);
    expect(agent.owed_leads_count).toBe(8); // paid the remaining 2
  });

  it('returns false when no source can pay anything', async () => {
    const m = buildMocks({ packages: [], assignments: [], agent: makeAgent(0) });
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: 'camp-A' });

    expect(result).toBe(false);
  });

  it("owns + commits its transaction when none is passed; uses the caller's when passed (no commit)", async () => {
    const agent = makeAgent(2);
    const m = buildMocks({ packages: [], assignments: [], agent });
    const svc = makeLeadCreditsService(m);

    await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: null });
    expect(m.mockTransaction.commit).toHaveBeenCalledTimes(1);

    m.mockTransaction.commit.mockClear();
    await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: null, transaction: m.mockTransaction });
    expect(m.mockTransaction.commit).not.toHaveBeenCalled();
  });

  it('rolls back its own transaction and returns false on a DB error (best-effort: never throws)', async () => {
    const m = buildMocks({ agent: makeAgent(1) });
    m.LeadPackage.findAll.mockRejectedValue(new Error('db down'));
    const svc = makeLeadCreditsService(m);

    const result = await svc.deductLeadCredit({ agentId: 'agent-1', campaignId: 'camp-A' });

    expect(result).toBe(false);
    expect(m.mockTransaction.rollback).toHaveBeenCalled();
    expect(m.logger.error).toHaveBeenCalledWith('Error deducting lead credits', expect.any(Object));
  });
});
