import { jest } from '@jest/globals';
import '../setup.js';
import { makeProspectService } from '../../src/services/prospectService.js';

// reassignProspectExternal + returnProspectToHeld — the mktr-leads admin app's lead-ops.
// destinationForAgent / externalIdForDestination / buildLead*Payload are the REAL pure helpers;
// persistEventDeliveries / flushDeliveries / deductLeadCredit / dispatchEvent are overridden.
function baseDeps(overrides = {}) {
  const mockTx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  const deps = {
    models: {
      // returnProspectToHeld loads via scope-aware findOne; tests arrange through
      // findByPk, so findOne delegates to it (same resolved prospect).
      Prospect: (() => {
        const findByPk = jest.fn();
        return { findByPk, findOne: jest.fn((args) => findByPk(args?.where?.id)) };
      })(),
      User: { findOne: jest.fn(), findByPk: jest.fn() },
      ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
      IdempotencyKey: {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue([1]),
      },
    },
    sequelize: {
      transaction: jest.fn().mockResolvedValue(mockTx),
      query: jest.fn().mockResolvedValue([[{ id: 'p-1' }]]), // conditional re-hold won
    },
    persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: { id: 'd' }, subscriber: { id: 's' } }]),
    flushDeliveries: jest.fn(),
    deductLeadCredit: jest.fn().mockResolvedValue(true),
    dispatchEvent: jest.fn().mockResolvedValue(undefined),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    ...overrides,
  };
  return { deps, mockTx };
}
const svc = (deps) => makeProspectService(deps);

// mktr-leads agents: lyfeId null + mktrLeadsId set → destination 'mktr_leads'.
const prevAgent = { id: 'prev-1', lyfeId: null, mktrLeadsId: 'app-prev', role: 'agent', isActive: true, firstName: 'Prev', lastName: 'Agent', phone: '6580000000', email: 'p@a' };
const targetAgent = { id: 'mktr-user-2', lyfeId: null, mktrLeadsId: 'app-target', role: 'agent', isActive: true, firstName: 'Tar', lastName: 'Get', phone: '6581111111', email: 't@g' };
// A Lyfe-side agent (lyfeId set) → destination 'lyfe' → out of scope for these mktr-leads ops.
const lyfeAgent = { id: 'lyfe-1', lyfeId: 'L1', mktrLeadsId: null, role: 'agent', isActive: true, firstName: 'Ly', lastName: 'Fe' };

describe('returnProspectToHeld', () => {
  const assigned = { id: 'p-1', assignedAgentId: 'prev-1', quarantinedAt: null, campaignId: 'camp-1', firstName: 'L', lastName: 'C', phone: 'x', email: 'e', leadSource: 'website', sourceMetadata: {} };

  it('re-holds + fires lead.unassigned with returnedToHeld, logs history, NO refund', async () => {
    const { deps, mockTx } = baseDeps();
    deps.models.Prospect.findByPk.mockResolvedValue(assigned);
    deps.models.User.findByPk.mockResolvedValue(prevAgent);

    const res = await svc(deps).returnProspectToHeld('p-1', { idempotencyKey: 'k1' });

    expect(res).toMatchObject({ status: 'returned', leadId: 'p-1' });
    expect(deps.sequelize.query).toHaveBeenCalled(); // conditional re-hold in the tx
    expect(deps.persistEventDeliveries).toHaveBeenCalledWith('lead.unassigned', expect.any(Function), { destination: 'mktr_leads' }, mockTx);
    const payload = deps.persistEventDeliveries.mock.calls[0][1]();
    expect(payload.data.returnedToHeld).toBe(true); // → receiver soft-deletes (vanish), not dispute
    expect(deps.models.ProspectActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Returned to held queue by admin' }),
      expect.anything(),
    );
    expect(deps.deductLeadCredit).not.toHaveBeenCalled(); // no refund / credit change
    expect(mockTx.commit).toHaveBeenCalled();
    expect(deps.flushDeliveries).toHaveBeenCalled();
  });

  it('already_handled when the lead is already held / unassigned', async () => {
    const { deps } = baseDeps();
    deps.models.Prospect.findByPk.mockResolvedValue({ id: 'p-1', assignedAgentId: null, quarantinedAt: new Date() });
    expect(await svc(deps).returnProspectToHeld('p-1', {})).toEqual({ status: 'already_handled' });
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
  });

  it('not_found when the prospect is missing', async () => {
    const { deps } = baseDeps();
    deps.models.Prospect.findByPk.mockResolvedValue(null);
    expect(await svc(deps).returnProspectToHeld('nope', {})).toEqual({ status: 'not_found' });
  });

  it('not_assignable when the current owner is a Lyfe agent (out of scope)', async () => {
    const { deps } = baseDeps();
    deps.models.Prospect.findByPk.mockResolvedValue({ id: 'p-1', assignedAgentId: 'lyfe-1', quarantinedAt: null });
    deps.models.User.findByPk.mockResolvedValue(lyfeAgent);
    expect(await svc(deps).returnProspectToHeld('p-1', {})).toEqual({ status: 'not_assignable' });
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
  });

  it('fail-closed (undeliverable + rollback) when no subscriber can receive the vanish', async () => {
    const { deps, mockTx } = baseDeps({ persistEventDeliveries: jest.fn().mockResolvedValue([]) });
    deps.models.Prospect.findByPk.mockResolvedValue(assigned);
    deps.models.User.findByPk.mockResolvedValue(prevAgent);
    expect(await svc(deps).returnProspectToHeld('p-1', {})).toEqual({ status: 'undeliverable' });
    expect(mockTx.rollback).toHaveBeenCalled();
    expect(mockTx.commit).not.toHaveBeenCalled();
  });

  it('replays the recorded result for a duplicate idempotency key', async () => {
    const { deps } = baseDeps();
    deps.models.IdempotencyKey.findOne.mockResolvedValue({ expiresAt: new Date(Date.now() + 1e6), responseBody: { status: 'returned', leadId: 'p-1' } });
    expect(await svc(deps).returnProspectToHeld('p-1', { idempotencyKey: 'k1' })).toEqual({ status: 'returned', leadId: 'p-1' });
    expect(deps.models.Prospect.findByPk).not.toHaveBeenCalled();
  });
});

describe('reassignProspectExternal', () => {
  it('invalid_agent when the target mktrLeadsId resolves to no active agent', async () => {
    const { deps } = baseDeps();
    deps.models.User.findOne.mockResolvedValue(null);
    expect(await svc(deps).reassignProspectExternal('p-1', 'bad', {})).toEqual({ status: 'invalid_agent' });
  });

  it('not_found when the prospect is missing', async () => {
    const { deps } = baseDeps();
    deps.models.User.findOne.mockResolvedValue(targetAgent);
    deps.models.Prospect.findByPk.mockResolvedValue(null);
    expect(await svc(deps).reassignProspectExternal('p-1', 'app-target', {})).toEqual({ status: 'not_found' });
  });

  it('not_assignable for a held / unassigned lead (those use the held queue)', async () => {
    const { deps } = baseDeps();
    deps.models.User.findOne.mockResolvedValue(targetAgent);
    deps.models.Prospect.findByPk.mockResolvedValue({ id: 'p-1', assignedAgentId: null, quarantinedAt: new Date() });
    expect(await svc(deps).reassignProspectExternal('p-1', 'app-target', {})).toEqual({ status: 'not_assignable' });
  });

  it('no-op (never a second charge) when the lead is already with the target', async () => {
    const { deps } = baseDeps();
    deps.models.User.findOne.mockResolvedValue(targetAgent);
    deps.models.User.findByPk.mockResolvedValue(targetAgent); // current owner = target (mktr-leads)
    deps.models.Prospect.findByPk.mockResolvedValue({ id: 'p-1', assignedAgentId: 'mktr-user-2', quarantinedAt: null, update: jest.fn() });
    const res = await svc(deps).reassignProspectExternal('p-1', 'app-target', { idempotencyKey: 'k' });
    expect(res).toMatchObject({ status: 'reassigned', leadId: 'p-1' });
    expect(deps.dispatchEvent).not.toHaveBeenCalled(); // assignProspect not invoked
  });

  it('not_assignable when the current owner is a Lyfe agent (out of scope)', async () => {
    const { deps } = baseDeps();
    deps.models.User.findOne.mockResolvedValue(targetAgent);
    deps.models.User.findByPk.mockResolvedValue(lyfeAgent); // current owner is Lyfe-side
    deps.models.Prospect.findByPk.mockResolvedValue({ id: 'p-1', assignedAgentId: 'lyfe-1', quarantinedAt: null });
    expect(await svc(deps).reassignProspectExternal('p-1', 'app-target', {})).toEqual({ status: 'not_assignable' });
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
  });

  it('reassigns via assignProspect (re-points + fires lead.assigned) for a different current agent', async () => {
    const { deps } = baseDeps();
    deps.models.User.findOne.mockResolvedValue(targetAgent);
    deps.models.User.findByPk.mockResolvedValue(prevAgent); // same-app prev → no cross-app unassigned
    const prospect = { id: 'p-1', assignedAgentId: 'prev-1', quarantinedAt: null, campaignId: 'camp-1', update: jest.fn().mockResolvedValue(true) };
    deps.models.Prospect.findByPk.mockResolvedValue(prospect);

    const res = await svc(deps).reassignProspectExternal('p-1', 'app-target', { idempotencyKey: 'k' });

    expect(res).toMatchObject({ status: 'reassigned' });
    expect(prospect.update).toHaveBeenCalledWith(expect.objectContaining({ assignedAgentId: 'mktr-user-2' }));
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.assigned', expect.any(Function), expect.anything());
    // same-app reassign must NOT dispute the previous agent (they lose access via re-point).
    expect(deps.dispatchEvent).not.toHaveBeenCalledWith('lead.unassigned', expect.any(Function), expect.anything());
  });
});
