import { jest } from '@jest/globals';

jest.unstable_mockModule('@sentry/node', () => ({ captureException: jest.fn() }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../../src/models/index.js', () => ({ sequelize: {}, Prospect: { findAll: jest.fn() } }));
jest.unstable_mockModule('../../src/services/dncGate.js', () => ({ gateHeldDncLead: jest.fn() }));
jest.unstable_mockModule('../../src/services/dncService.js', () => ({ dncReady: jest.fn() }));

let svc;
beforeAll(async () => {
  svc = await import('../../src/services/dncBackfillService.js');
});

const mkDeps = (over = {}) => ({
  dncReady: jest.fn(() => true),
  sequelize: {
    QueryTypes: { SELECT: 'SELECT' },
    transaction: jest.fn(async (cb) => cb({})),
    query: jest.fn().mockResolvedValue([{ locked: true }]),
  },
  Prospect: { findAll: jest.fn().mockResolvedValue([]) },
  gateHeldDncLead: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  ...over,
});

describe('runDncBackfill', () => {
  it('skips when DNC is not configured', async () => {
    const deps = mkDeps({ dncReady: jest.fn(() => false) });
    const r = await svc.runDncBackfill(deps);
    expect(r).toEqual({ ran: false, reason: 'not_ready' });
    expect(deps.Prospect.findAll).not.toHaveBeenCalled();
  });

  it('skips when the job lock is held elsewhere', async () => {
    const deps = mkDeps();
    deps.sequelize.query.mockResolvedValue([{ locked: false }]);
    const r = await svc.runDncBackfill(deps);
    expect(r).toMatchObject({ ran: false, reason: 'lock_held' });
    expect(deps.Prospect.findAll).not.toHaveBeenCalled();
  });

  it('processes held pending leads and tallies outcomes', async () => {
    const deps = mkDeps();
    deps.Prospect.findAll.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    deps.gateHeldDncLead
      .mockResolvedValueOnce({ outcome: 'released', status: 'clear' })
      .mockResolvedValueOnce({ outcome: 'held', status: 'registered' })
      .mockResolvedValueOnce({ outcome: 'held', status: 'pending' });
    const r = await svc.runDncBackfill(deps);
    expect(r).toMatchObject({ ran: true, released: 1, held: 1, errors: 1, total: 3 });
    expect(deps.gateHeldDncLead).toHaveBeenCalledTimes(3);
  });

  it('selects only dnc_pending, contactable (non-terminal) leads', async () => {
    const deps = mkDeps();
    await svc.runDncBackfill(deps);
    const where = deps.Prospect.findAll.mock.calls[0][0].where;
    expect(where.quarantineReason).toBe('dnc_pending');
    expect(where.leadStatus).toBeDefined(); // Op.notIn ['won','lost']
  });
});
