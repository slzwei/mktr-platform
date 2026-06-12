import { jest } from '@jest/globals';
import '../setup.js';

// Mock the models + logger imports so no real DB connection is made and the real
// chargeLeadCredit is exercised against a stubbed sequelize.query.
const queryMock = jest.fn();
const commitMock = jest.fn().mockResolvedValue(undefined);
const rollbackMock = jest.fn().mockResolvedValue(undefined);
const ownTx = { commit: commitMock, rollback: rollbackMock };

jest.unstable_mockModule('../../src/models/index.js', () => ({
  sequelize: {
    query: queryMock,
    transaction: jest.fn().mockResolvedValue(ownTx),
  },
  LeadPackageAssignment: {},
  LeadPackage: {},
  User: {},
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { chargeLeadCredit } = await import('../../src/services/leadCredits.js');

// sequelize.query (raw) resolves to [rows, metadata]; the code only reads rows.
const PKG_HIT = [[{ id: 'lpa-1' }]];
const OWED_HIT = [[{ id: 'agent-1' }]];
const NONE = [[]];

describe('chargeLeadCredit (unit) — authoritative, campaign-scoped, atomic', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false and runs no query when agentId or campaignId is missing', async () => {
    expect(await chargeLeadCredit(null, 'camp-1')).toBe(false);
    expect(await chargeLeadCredit('agent-1', null)).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('charges the campaign package and returns true without touching the owed bucket', async () => {
    queryMock.mockResolvedValueOnce(PKG_HIT);
    const ok = await chargeLeadCredit('agent-1', 'camp-1');
    expect(ok).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1); // package hit ⇒ no fallback query
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toMatch(/FOR UPDATE OF a SKIP LOCKED/);
    expect(sql).toMatch(/lead_package_assignments/);
    expect(queryMock.mock.calls[0][1].replacements).toEqual({ agentId: 'agent-1', campaignId: 'camp-1' });
  });

  it('is campaign-scoped: the package query filters by campaignId (the v1 bug fix)', async () => {
    queryMock.mockResolvedValueOnce(PKG_HIT);
    await chargeLeadCredit('agent-1', 'camp-1');
    expect(queryMock.mock.calls[0][0]).toMatch(/p\."campaignId" = :campaignId/);
  });

  it('falls back to owed_leads_count when no campaign package is available', async () => {
    queryMock.mockResolvedValueOnce(NONE).mockResolvedValueOnce(OWED_HIT);
    const ok = await chargeLeadCredit('agent-1', 'camp-1');
    expect(ok).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toMatch(/owed_leads_count/);
  });

  it('returns false when neither a package nor owed credit is available', async () => {
    queryMock.mockResolvedValueOnce(NONE).mockResolvedValueOnce(NONE);
    const ok = await chargeLeadCredit('agent-1', 'camp-1');
    expect(ok).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('owns and commits its own transaction when none is passed', async () => {
    queryMock.mockResolvedValueOnce(PKG_HIT);
    await chargeLeadCredit('agent-1', 'camp-1');
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(rollbackMock).not.toHaveBeenCalled();
  });

  it('uses the caller transaction and never commits/rolls it back', async () => {
    queryMock.mockResolvedValueOnce(PKG_HIT);
    const callerTx = { commit: jest.fn(), rollback: jest.fn() };
    const ok = await chargeLeadCredit('agent-1', 'camp-1', callerTx);
    expect(ok).toBe(true);
    expect(callerTx.commit).not.toHaveBeenCalled();
    expect(callerTx.rollback).not.toHaveBeenCalled();
    expect(queryMock.mock.calls[0][1].transaction).toBe(callerTx);
  });

  it('rolls back and returns false on a DB error when it owns the transaction', async () => {
    queryMock.mockRejectedValueOnce(new Error('boom'));
    const ok = await chargeLeadCredit('agent-1', 'camp-1');
    expect(ok).toBe(false);
    expect(rollbackMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows on a DB error when the caller owns the transaction (caller rolls back)', async () => {
    queryMock.mockRejectedValueOnce(new Error('boom'));
    const callerTx = { commit: jest.fn(), rollback: jest.fn() };
    await expect(chargeLeadCredit('agent-1', 'camp-1', callerTx)).rejects.toThrow('boom');
    expect(callerTx.rollback).not.toHaveBeenCalled();
  });
});
