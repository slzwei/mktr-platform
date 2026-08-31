import { jest } from '@jest/globals';

jest.unstable_mockModule('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
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
  Sentry: { captureMessage: jest.fn(), captureException: jest.fn() },
  ...over,
});

// A held lead the gate keeps failing on, with a live `update` so the counter can persist.
const mkLead = (id, attempts = 0) => {
  const lead = {
    id,
    dncMetadata: attempts ? { intendedAgentId: 'agent-1', backfillAttempts: attempts } : { intendedAgentId: 'agent-1' },
    update: jest.fn(async (fields) => Object.assign(lead, fields)),
  };
  return lead;
};

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

describe('runDncBackfill — per-lead attempt bound', () => {
  it('excludes attempt-exhausted leads in SQL so they cannot starve the run slice', async () => {
    const deps = mkDeps({ maxAttempts: () => 20 });
    await svc.runDncBackfill(deps);
    const where = deps.Prospect.findAll.mock.calls[0][0].where;
    const clauses = Object.getOwnPropertySymbols(where)
      .flatMap((s) => where[s])
      .map((c) => String(c?.val ?? ''));
    expect(clauses.some((c) => /backfillAttempts/.test(c) && /< 20/.test(c))).toBe(true);
  });

  it('counts an unresolved pass against the lead and persists it', async () => {
    const lead = mkLead('a', 3);
    const deps = mkDeps({ maxAttempts: () => 20 });
    deps.Prospect.findAll.mockResolvedValue([lead]);
    deps.gateHeldDncLead.mockResolvedValue({ outcome: 'held', status: 'pending' });

    const r = await svc.runDncBackfill(deps);
    expect(lead.update).toHaveBeenCalledWith({
      dncMetadata: { intendedAgentId: 'agent-1', backfillAttempts: 4 },
    });
    expect(r).toMatchObject({ errors: 1, exhausted: 0 });
    expect(deps.Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('does not count a released lead against the bound', async () => {
    const lead = mkLead('a');
    const deps = mkDeps({ maxAttempts: () => 20 });
    deps.Prospect.findAll.mockResolvedValue([lead]);
    deps.gateHeldDncLead.mockResolvedValue({ outcome: 'released', status: 'clear' });

    const r = await svc.runDncBackfill(deps);
    expect(lead.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ released: 1, exhausted: 0 });
  });

  it('alerts exactly once on the pass that crosses the bound, and leaves the lead held', async () => {
    const lead = mkLead('a', 19);
    const deps = mkDeps({ maxAttempts: () => 20 });
    deps.Prospect.findAll.mockResolvedValue([lead]);
    deps.gateHeldDncLead.mockResolvedValue({ outcome: 'held', status: 'error' });

    const r = await svc.runDncBackfill(deps);
    expect(r).toMatchObject({ released: 0, exhausted: 1 });
    expect(deps.Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(deps.Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('20 attempts'),
      expect.objectContaining({ level: 'error', tags: expect.objectContaining({ reason: 'backfill_exhausted' }) })
    );
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ prospect_id: 'a', attempts: 20 }),
      'dnc.backfill.exhausted'
    );
  });

  // A `registered` verdict whose relabel to dnc_registered failed stays dnc_pending, so it
  // must still count — otherwise it is re-driven every tick forever.
  it('counts a still-dnc_pending registered lead against the bound', async () => {
    const lead = mkLead('a');
    const deps = mkDeps({ maxAttempts: () => 20 });
    deps.Prospect.findAll.mockResolvedValue([lead]);
    deps.gateHeldDncLead.mockResolvedValue({ outcome: 'held', status: 'registered' });

    await svc.runDncBackfill(deps);
    expect(lead.update).toHaveBeenCalledWith({
      dncMetadata: { intendedAgentId: 'agent-1', backfillAttempts: 1 },
    });
  });

  it('survives a counter write that fails, without dropping the pass', async () => {
    const lead = mkLead('a');
    lead.update = jest.fn(async () => { throw new Error('db down'); });
    const deps = mkDeps({ maxAttempts: () => 20 });
    deps.Prospect.findAll.mockResolvedValue([lead]);
    deps.gateHeldDncLead.mockResolvedValue({ outcome: 'held', status: 'pending' });

    const r = await svc.runDncBackfill(deps);
    expect(r).toMatchObject({ ran: true, errors: 1 });
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});
