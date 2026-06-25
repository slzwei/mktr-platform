import { jest } from '@jest/globals';
import '../setup.js';
import { makeProspectService } from '../../src/services/prospectService.js';

// releaseHeldProspect — held-only release for the external mktr-leads dispatch
// endpoint. destinationForAgent / externalIdForDestination / buildLeadCreatedPayload
// are the REAL pure helpers (not overridable via deps), so destination routing is
// genuinely exercised. persistEventDeliveries/flushDeliveries/deductLeadCredit ARE
// overridden (they would otherwise hit the DB / real webhook layer).
function buildMocks() {
  const mockTx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  // An mktr-leads agent: mktrLeadsId set, lyfeId null → destination 'mktr_leads'.
  const agent = {
    id: 'mktr-user-1', lyfeId: null, mktrLeadsId: 'app-agent-1',
    role: 'agent', isActive: true, firstName: 'Hui', lastName: 'Xin', phone: '6585337192', email: 'h@x',
  };
  const heldProspect = { id: 'p-1', campaignId: 'camp-1', quarantineReason: 'no_funded_agent', quarantinedAt: new Date() };

  const models = {
    Prospect: {
      findByPk: jest.fn()
        .mockResolvedValueOnce(heldProspect) // pre-txn read (reason / campaignId)
        .mockResolvedValue({ ...heldProspect, campaign: { id: 'camp-1', name: 'C' } }), // withCampaign (in txn)
    },
    User: { findOne: jest.fn().mockResolvedValue(agent) },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    IdempotencyKey: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  };

  const deps = {
    models,
    sequelize: {
      transaction: jest.fn().mockResolvedValue(mockTx),
      query: jest.fn().mockResolvedValue([[{ id: 'p-1' }]]), // conditional release won
    },
    persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: { id: 'd' }, subscriber: { id: 's' } }]),
    flushDeliveries: jest.fn(),
    deductLeadCredit: jest.fn().mockResolvedValue(true),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  };
  return { deps, mockTx, agent, heldProspect };
}

const svc = (deps) => makeProspectService(deps);

describe('releaseHeldProspect (unit)', () => {
  it('releases a held lead: atomic release, mktr_leads-scoped delivery persisted IN the tx, post-commit deduct + flush', async () => {
    const { deps, mockTx } = buildMocks();

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', {});

    expect(res).toMatchObject({ status: 'assigned', leadId: 'p-1' });
    // Resolved by mktrLeadsId ONLY (active agent).
    expect(deps.models.User.findOne).toHaveBeenCalledWith({
      where: { mktrLeadsId: 'app-agent-1', role: 'agent', isActive: true },
    });
    // Held-only conditional release ran in the tx.
    expect(deps.sequelize.query).toHaveBeenCalled();
    // Delivery row persisted INSIDE the tx (outbox), destination-scoped to mktr_leads.
    expect(deps.persistEventDeliveries).toHaveBeenCalledWith(
      'lead.created', expect.any(Function), { destination: 'mktr_leads' }, mockTx,
    );
    expect(mockTx.commit).toHaveBeenCalled();
    // Post-commit: best-effort campaign-scoped deduct + flush of the persisted delivery.
    expect(deps.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'mktr-user-1', campaignId: 'camp-1' });
    expect(deps.flushDeliveries).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)]));
  });

  it('webhook external id is the agent mktrLeadsId (so the mktr-leads receiver matches it)', async () => {
    const { deps } = buildMocks();
    await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', {});
    const builder = deps.persistEventDeliveries.mock.calls[0][1];
    const payload = builder();
    expect(payload.data.routing.agentExternalId).toBe('app-agent-1');
  });

  it('unknown / inactive agent → invalid_agent, no release', async () => {
    const { deps } = buildMocks();
    deps.models.User.findOne.mockResolvedValue(null);

    const res = await svc(deps).releaseHeldProspect('p-1', 'ghost', {});

    expect(res.status).toBe('invalid_agent');
    expect(deps.sequelize.query).not.toHaveBeenCalled();
  });

  it('missing prospect → not_found', async () => {
    const { deps } = buildMocks();
    deps.models.Prospect.findByPk = jest.fn().mockResolvedValue(null);

    const res = await svc(deps).releaseHeldProspect('gone', 'app-agent-1', {});

    expect(res.status).toBe('not_found');
    expect(deps.sequelize.query).not.toHaveBeenCalled();
  });

  it('external-buyer hold can never be released to an internal agent → not_assignable_external', async () => {
    const { deps } = buildMocks();
    deps.models.Prospect.findByPk = jest.fn().mockResolvedValue({
      id: 'p-1', campaignId: 'camp-1', quarantineReason: 'no_funded_external_buyer',
    });

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', {});

    expect(res.status).toBe('not_assignable_external');
    expect(deps.sequelize.query).not.toHaveBeenCalled();
  });

  it('retry after release (conditional update matches 0 rows) → already_handled, no second charge/delivery', async () => {
    const { deps, mockTx } = buildMocks();
    deps.sequelize.query.mockResolvedValue([[]]); // lost the race / already released

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', {});

    expect(res.status).toBe('already_handled');
    expect(mockTx.commit).toHaveBeenCalled();
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
    expect(deps.deductLeadCredit).not.toHaveBeenCalled();
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });

  it('idempotency replay: a stored key returns the first result verbatim, no reprocessing', async () => {
    const { deps } = buildMocks();
    deps.models.IdempotencyKey.findOne.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      responseBody: { status: 'assigned', leadId: 'p-1' },
    });

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', { idempotencyKey: 'k-1' });

    expect(res).toEqual({ status: 'assigned', leadId: 'p-1' });
    expect(deps.models.User.findOne).not.toHaveBeenCalled();
    expect(deps.sequelize.query).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED: no delivery row persisted (webhooks off / no subscriber) → undeliverable, rolls back', async () => {
    const { deps, mockTx } = buildMocks();
    deps.persistEventDeliveries.mockResolvedValue([]); // nothing to deliver to

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', {});

    expect(res.status).toBe('undeliverable');
    expect(mockTx.rollback).toHaveBeenCalled(); // the release is rolled back — lead stays held
    expect(mockTx.commit).not.toHaveBeenCalled();
    expect(deps.deductLeadCredit).not.toHaveBeenCalled();
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });

  it('already-released prospect (quarantinedAt null) → already_handled BEFORE agent resolution', async () => {
    const { deps } = buildMocks();
    deps.models.Prospect.findByPk = jest.fn().mockResolvedValue({ id: 'p-1', campaignId: 'camp-1', quarantineReason: null, quarantinedAt: null });

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', {});

    expect(res.status).toBe('already_handled');
    expect(deps.models.User.findOne).not.toHaveBeenCalled(); // no invalid_agent on a handled lead
    expect(deps.sequelize.query).not.toHaveBeenCalled();
  });

  it('records the idempotency key INSIDE the release transaction', async () => {
    const { deps, mockTx } = buildMocks();
    await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', { idempotencyKey: 'k-1' });

    expect(deps.models.IdempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k-1', scope: 'external:held-assign', responseBody: expect.objectContaining({ status: 'assigned' }) }),
      { transaction: mockTx },
    );
  });

  it('concurrent same-key: a unique-violation on the key create replays the winner result (no 500)', async () => {
    const { deps, mockTx } = buildMocks();
    deps.models.IdempotencyKey.create.mockRejectedValue(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));
    deps.models.IdempotencyKey.findOne
      .mockResolvedValueOnce(null) // top replay check: key not yet visible
      .mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 60_000), responseBody: { status: 'assigned', leadId: 'p-1' } }); // catch: winner's row

    const res = await svc(deps).releaseHeldProspect('p-1', 'app-agent-1', { idempotencyKey: 'k-1' });

    expect(res).toEqual({ status: 'assigned', leadId: 'p-1' });
    expect(mockTx.rollback).toHaveBeenCalled();
  });
});
