import { jest } from '@jest/globals';

jest.unstable_mockModule('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn(), init: jest.fn() }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../src/models/index.js', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn() },
  Prospect: { findByPk: jest.fn() },
  ProspectActivity: { create: jest.fn() },
  User: { findByPk: jest.fn() },
}));
jest.unstable_mockModule('../../src/services/leadCredits.js', () => ({ chargeLeadCredit: jest.fn() }));
jest.unstable_mockModule('../../src/services/webhookService.js', () => ({
  persistEventDeliveries: jest.fn(),
  flushDeliveries: jest.fn(),
}));
jest.unstable_mockModule('../../src/services/prospectHelpers.js', () => ({
  buildLeadCreatedPayload: jest.fn(() => ({ event: 'lead.created' })),
  destinationForAgent: jest.fn(() => 'lyfe'),
  externalIdForDestination: jest.fn(() => 'L1'),
}));
jest.unstable_mockModule('../../src/services/dncService.js', () => ({ checkAndRecord: jest.fn() }));

let gate;
beforeAll(async () => {
  gate = await import('../../src/services/dncGate.js');
});

const baseLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('gateHeldDncLead', () => {
  it('CLEAR → releases to the intended agent captured from dncMetadata', async () => {
    const release = jest.fn().mockResolvedValue({ released: true });
    const checkAndRecord = jest.fn().mockResolvedValue({ status: 'clear', noVoiceCall: false });
    const prospect = { id: 'p1', dncMetadata: { intendedAgentId: 'a1', alreadyCharged: false } };
    const out = await gate.gateHeldDncLead(prospect, { checkAndRecord, releaseDncClearedLead: release, logger: baseLogger });
    expect(out.outcome).toBe('released');
    expect(release).toHaveBeenCalledWith({ prospect, agentId: 'a1', alreadyCharged: false }, expect.anything());
  });

  it('REGISTERED on voice → kept held, reason relabeled dnc_registered, no release', async () => {
    const release = jest.fn();
    const checkAndRecord = jest.fn().mockResolvedValue({ status: 'registered', noVoiceCall: true });
    const update = jest.fn().mockResolvedValue();
    const prospect = { id: 'p2', dncMetadata: { intendedAgentId: 'a1' }, update };
    const out = await gate.gateHeldDncLead(prospect, { checkAndRecord, releaseDncClearedLead: release, logger: baseLogger });
    expect(out).toMatchObject({ outcome: 'held', status: 'registered' });
    expect(update).toHaveBeenCalledWith({ quarantineReason: 'dnc_registered' });
    expect(release).not.toHaveBeenCalled();
  });

  it('REGISTERED on text only (voice clear) → still released', async () => {
    const release = jest.fn().mockResolvedValue({ released: true });
    const checkAndRecord = jest.fn().mockResolvedValue({ status: 'registered', noVoiceCall: false, noTextMessage: true });
    const prospect = { id: 'p3', dncMetadata: { intendedAgentId: 'a1' } };
    const out = await gate.gateHeldDncLead(prospect, { checkAndRecord, releaseDncClearedLead: release, logger: baseLogger });
    expect(out.outcome).toBe('released');
    expect(release).toHaveBeenCalled();
  });

  it('PENDING → stays held, no release, no relabel', async () => {
    const release = jest.fn();
    const update = jest.fn();
    const checkAndRecord = jest.fn().mockResolvedValue({ status: 'pending' });
    const out = await gate.gateHeldDncLead({ id: 'p4', dncMetadata: {}, update }, { checkAndRecord, releaseDncClearedLead: release, logger: baseLogger });
    expect(out).toMatchObject({ outcome: 'held', status: 'pending' });
    expect(release).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('check throws → left held with status error', async () => {
    const checkAndRecord = jest.fn().mockRejectedValue(new Error('boom'));
    const out = await gate.gateHeldDncLead({ id: 'p5', dncMetadata: {} }, { checkAndRecord, releaseDncClearedLead: jest.fn(), logger: baseLogger });
    expect(out).toMatchObject({ outcome: 'held', status: 'error' });
  });
});

describe('releaseDncClearedLead', () => {
  const mkDeps = (over = {}) => {
    const tx = { commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue() };
    return {
      tx,
      deps: {
        sequelize: { transaction: jest.fn().mockResolvedValue(tx), query: jest.fn().mockResolvedValue([[{ id: 'p1' }]]) },
        Prospect: { findByPk: jest.fn().mockResolvedValue({ id: 'p1', campaign: { id: 'c1', name: 'C' } }) },
        ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
        User: { findByPk: jest.fn().mockResolvedValue({ id: 'a1', lyfeId: 'L1', phone: 'p', email: 'e', firstName: 'F', lastName: 'G' }) },
        chargeLeadCredit: jest.fn().mockResolvedValue(true),
        persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: {}, subscriber: {} }]),
        flushDeliveries: jest.fn(),
        buildLeadCreatedPayload: jest.fn(() => ({ event: 'lead.created' })),
        destinationForAgent: jest.fn(() => 'lyfe'),
        externalIdForDestination: jest.fn(() => 'L1'),
        logger: baseLogger,
        ...over,
      },
    };
  };
  const prospect = () => ({ id: 'p1', campaignId: 'c1', reload: jest.fn().mockResolvedValue() });

  it('happy path → claims, charges, persists outbox, commits, flushes', async () => {
    const { tx, deps } = mkDeps();
    const res = await gate.releaseDncClearedLead({ prospect: prospect(), agentId: 'a1', alreadyCharged: false }, deps);
    expect(res).toEqual({ released: true });
    expect(deps.chargeLeadCredit).toHaveBeenCalledWith('a1', 'c1', tx);
    expect(deps.persistEventDeliveries).toHaveBeenCalled();
    expect(tx.commit).toHaveBeenCalled();
    expect(deps.flushDeliveries).toHaveBeenCalled();
  });

  it('no intended agent → not released, no transaction opened', async () => {
    const { deps } = mkDeps();
    const res = await gate.releaseDncClearedLead({ prospect: prospect(), agentId: null }, deps);
    expect(res).toMatchObject({ released: false, reason: 'no_intended_agent' });
    expect(deps.sequelize.transaction).not.toHaveBeenCalled();
  });

  it('lost claim (already released) → rolls back', async () => {
    const { tx, deps } = mkDeps();
    deps.sequelize.query.mockResolvedValue([[]]);
    const res = await gate.releaseDncClearedLead({ prospect: prospect(), agentId: 'a1' }, deps);
    expect(res).toMatchObject({ released: false, reason: 'lost_claim' });
    expect(tx.rollback).toHaveBeenCalled();
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
  });

  it('no credit → rolls back (re-held)', async () => {
    const { tx, deps } = mkDeps({ chargeLeadCredit: jest.fn().mockResolvedValue(false) });
    const res = await gate.releaseDncClearedLead({ prospect: prospect(), agentId: 'a1' }, deps);
    expect(res).toMatchObject({ released: false, reason: 'no_credit' });
    expect(tx.rollback).toHaveBeenCalled();
  });

  it('alreadyCharged → skips the charge', async () => {
    const { deps } = mkDeps();
    const res = await gate.releaseDncClearedLead({ prospect: prospect(), agentId: 'a1', alreadyCharged: true }, deps);
    expect(res).toEqual({ released: true });
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
  });

  it('no delivery subscriber → rolls back (fail closed)', async () => {
    const { tx, deps } = mkDeps({ persistEventDeliveries: jest.fn().mockResolvedValue([]) });
    const res = await gate.releaseDncClearedLead({ prospect: prospect(), agentId: 'a1' }, deps);
    expect(res).toMatchObject({ released: false, reason: 'no_subscriber' });
    expect(tx.rollback).toHaveBeenCalled();
  });
});
