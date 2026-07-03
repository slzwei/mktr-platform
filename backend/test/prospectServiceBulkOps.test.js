/**
 * Web-admin bulk lead ops — unit tests via the makeProspectService DI seam (no Postgres).
 *
 * Covers the D1–D4 behavior of the bulk-lead-ops backend:
 *  - bulkAssignProspects v2: held-release arm, batch context, skip accounting, webhook pre-flight
 *  - returnProspectToHeld: web-admin flavor (returned_by_admin, any destination, promotion)
 *    vs external flavor (no_funded_agent, mktr-leads-only) — and fail-closed vanish
 *  - bulkReturnProspectsToHeld / bulkDeleteProspects fan-out counting
 *  - assignProspect held-release now fires lead.assigned (never lead.created)
 *
 * Integration-level coverage (real DB + supertest) lives in prospects.test.js.
 */
import { jest } from '@jest/globals';
import { makeProspectService } from '../src/services/prospectService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

class TestAppError extends Error {
  constructor(m, s) {
    super(m);
    this.statusCode = s;
  }
}

const ADMIN = { id: 'admin-1', role: 'admin' };

function makeTx() {
  return { commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue() };
}

function buildDeps(overrides = {}) {
  const models = {
    Prospect: {
      findOne: jest.fn().mockResolvedValue(null),
      findByPk: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue([0, []]),
    },
    User: { findOne: jest.fn().mockResolvedValue(null), findByPk: jest.fn().mockResolvedValue(null) },
    Campaign: {},
    QrTag: {},
    Commission: {},
    Attribution: {},
    ProspectActivity: { create: jest.fn().mockResolvedValue({}), bulkCreate: jest.fn().mockResolvedValue([]) },
    AgentGroup: {},
    AgentGroupMember: {},
    IdempotencyKey: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue([1]) },
  };

  const sequelize = {
    // Managed form (callback) for bulk assign / delete; unmanaged form (no callback)
    // for returnProspectToHeld's explicit commit/rollback flow.
    transaction: jest.fn().mockImplementation(async (cb) => {
      if (typeof cb === 'function') return cb({});
      return makeTx();
    }),
    query: jest.fn().mockResolvedValue([[]]),
  };

  return {
    models,
    sequelize,
    buildProspectWhere: jest.fn().mockResolvedValue({}),
    deductLeadCredit: jest.fn().mockResolvedValue(),
    dispatchEvent: jest.fn().mockResolvedValue(),
    persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: {}, subscriber: {} }]),
    flushDeliveries: jest.fn(),
    hasDeliverableSubscriber: jest.fn().mockResolvedValue(true),
    AppError: TestAppError,
    logger: silentLogger,
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════════
   bulkAssignProspects v2
   ══════════════════════════════════════════════════════════════════ */
describe('bulkAssignProspects — held release, batch context, skip accounting', () => {
  const AGENT = { id: 'agent-1', firstName: 'Ada', lastName: 'Tan', email: 'ada@x.co', phone: '651', mktrLeadsId: 'ml-1' };

  function wireBulk(deps, { requested, locked, updated }) {
    deps.models.User.findOne.mockResolvedValue(AGENT);
    // findAll is called for: (1) the locked eligible set (lock: true), (2) the requested
    // classification snapshot (attributes list, no lock), (3) the full payload rows (include).
    deps.models.Prospect.findAll.mockImplementation((opts = {}) => {
      if (opts.lock) return Promise.resolve(locked);
      if (opts.include) return Promise.resolve(updated.full);
      return Promise.resolve(requested);
    });
    deps.models.Prospect.update.mockResolvedValue([updated.rows.length, updated.rows]);
  }

  it('releases a returned_by_admin hold: clears quarantine in the UPDATE, counts releasedCount, fires batched lead.assigned with qrTag + routing.mode', async () => {
    const deps = buildDeps();
    const heldRow = { id: 'p1', assignedAgentId: null, campaignId: 'c1', quarantinedAt: new Date(), quarantineReason: 'returned_by_admin' };
    const freshRow = { id: 'p2', assignedAgentId: null, campaignId: 'c1', quarantinedAt: null, quarantineReason: null };
    wireBulk(deps, {
      requested: [heldRow, freshRow],
      locked: [heldRow, freshRow],
      updated: {
        rows: [{ id: 'p1', campaignId: 'c1' }, { id: 'p2', campaignId: 'c1' }],
        full: [
          { id: 'p1', campaignId: 'c1', campaign: { id: 'c1', name: 'C' }, qrTag: { id: 'q1', slug: 'sluggy' }, sourceMetadata: {} },
          { id: 'p2', campaignId: 'c1', campaign: { id: 'c1', name: 'C' }, qrTag: null, sourceMetadata: {} },
        ],
      },
    });
    const svc = makeProspectService(deps);

    const res = await svc.bulkAssignProspects(['p1', 'p2'], 'agent-1', ADMIN);

    expect(res.affectedCount).toBe(2);
    expect(res.releasedCount).toBe(1);
    expect(res.skipped).toEqual({ notFound: 0, alreadyAssigned: 0, heldFenced: 0 });

    // The atomic UPDATE clears the hold alongside the assignment.
    const updateArgs = deps.models.Prospect.update.mock.calls[0][0];
    expect(updateArgs).toMatchObject({ assignedAgentId: 'agent-1', quarantinedAt: null, quarantineReason: null });

    // Every delivery is lead.assigned, batch-stamped, with qrTag + routing.mode parity.
    const assignedCalls = deps.dispatchEvent.mock.calls.filter(([evt]) => evt === 'lead.assigned');
    expect(assignedCalls).toHaveLength(2);
    const payloads = assignedCalls.map(([, builder]) => builder());
    for (const p of payloads) {
      expect(p.event).toBe('lead.assigned');
      expect(p.data.batch).toEqual({ id: expect.any(String), size: 2 });
      expect(p.data.routing.mode).toBe('direct');
    }
    expect(payloads.map((p) => p.data.qrTag)).toEqual(
      expect.arrayContaining([
        { externalId: 'q1', slug: 'sluggy' },
        { externalId: null, slug: null },
      ])
    );
    expect(deps.dispatchEvent.mock.calls.some(([evt]) => evt === 'lead.created')).toBe(false);

    // Released row's activity is flagged for the timeline.
    const activityRows = deps.models.ProspectActivity.bulkCreate.mock.calls[0][0];
    expect(activityRows.find((a) => a.prospectId === 'p1').metadata.released).toBe(true);
    expect(activityRows.find((a) => a.prospectId === 'p2').metadata.released).toBeUndefined();
  });

  it('classifies skips: fenced holds (DNC / external pool), same-agent no-ops, unknown ids', async () => {
    const deps = buildDeps();
    const dncRow = { id: 'p-dnc', assignedAgentId: null, quarantinedAt: new Date(), quarantineReason: 'dnc_pending' };
    const extRow = { id: 'p-ext', assignedAgentId: null, quarantinedAt: new Date(), quarantineReason: 'no_funded_external_buyer' };
    const mineRow = { id: 'p-mine', assignedAgentId: 'agent-1', quarantinedAt: null, quarantineReason: null };
    wireBulk(deps, {
      requested: [dncRow, extRow, mineRow],
      locked: [],
      updated: { rows: [], full: [] },
    });
    const svc = makeProspectService(deps);

    const res = await svc.bulkAssignProspects(['p-dnc', 'p-ext', 'p-mine', 'p-gone'], 'agent-1', ADMIN);

    expect(res.affectedCount).toBe(0);
    expect(res.skipped).toEqual({ notFound: 1, alreadyAssigned: 1, heldFenced: 2 });
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
  });

  it('pre-flight 409s when the destination app has no deliverable subscriber', async () => {
    const deps = buildDeps({ hasDeliverableSubscriber: jest.fn().mockResolvedValue(false) });
    deps.models.User.findOne.mockResolvedValue(AGENT);
    const svc = makeProspectService(deps);

    await expect(svc.bulkAssignProspects(['p1'], 'agent-1', ADMIN)).rejects.toMatchObject({ statusCode: 409 });
    expect(deps.hasDeliverableSubscriber).toHaveBeenCalledWith('lead.assigned', 'mktr_leads');
    expect(deps.models.Prospect.update).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════
   returnProspectToHeld — web-admin flavor vs external flavor
   ══════════════════════════════════════════════════════════════════ */
describe('returnProspectToHeld', () => {
  const WEB_OPTS = { actorUserId: 'admin-1', reason: 'returned_by_admin', via: 'web_admin', anyDestination: true, promoteUnassigned: true };

  function wireProspect(deps, prospect) {
    deps.models.Prospect.findOne.mockResolvedValue(prospect);
  }

  it('web flavor returns a Lyfe-owned lead: re-holds as returned_by_admin and persists the vanish to the lyfe destination', async () => {
    const deps = buildDeps();
    wireProspect(deps, { id: 'p1', assignedAgentId: 'u-lyfe', quarantinedAt: null, sourceMetadata: {} });
    deps.models.User.findByPk.mockResolvedValue({ id: 'u-lyfe', lyfeId: 'lyfe-uuid', mktrLeadsId: null });
    deps.sequelize.query.mockResolvedValue([[{ id: 'p1' }]]);
    const svc = makeProspectService(deps);

    const res = await svc.returnProspectToHeld('p1', WEB_OPTS);

    expect(res).toEqual({ status: 'returned', leadId: 'p1' });
    const [sql, { replacements }] = deps.sequelize.query.mock.calls[0];
    expect(sql).toContain('"quarantineReason" = :reason');
    expect(replacements.reason).toBe('returned_by_admin');

    const [evt, builder, opts] = deps.persistEventDeliveries.mock.calls[0];
    expect(evt).toBe('lead.unassigned');
    expect(opts).toEqual({ destination: 'lyfe' });
    const payload = builder();
    expect(payload.data.returnedToHeld).toBe(true);
    expect(payload.data.previousAgentId).toBe('lyfe-uuid');
    expect(deps.flushDeliveries).toHaveBeenCalled();
  });

  it('web flavor re-holds a no-destination (System Agent) lead without any delivery — no fail-closed', async () => {
    const deps = buildDeps({ persistEventDeliveries: jest.fn().mockResolvedValue([]) });
    wireProspect(deps, { id: 'p1', assignedAgentId: 'sys-1', quarantinedAt: null, sourceMetadata: {} });
    deps.models.User.findByPk.mockResolvedValue({ id: 'sys-1', lyfeId: null, mktrLeadsId: null });
    deps.sequelize.query.mockResolvedValue([[{ id: 'p1' }]]);
    const svc = makeProspectService(deps);

    const res = await svc.returnProspectToHeld('p1', WEB_OPTS);

    expect(res).toEqual({ status: 'returned', leadId: 'p1' });
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
  });

  it('web flavor fails closed when the vanish cannot be persisted (webhooks off / no subscriber)', async () => {
    const deps = buildDeps({ persistEventDeliveries: jest.fn().mockResolvedValue([]) });
    wireProspect(deps, { id: 'p1', assignedAgentId: 'u-ml', quarantinedAt: null, sourceMetadata: {} });
    deps.models.User.findByPk.mockResolvedValue({ id: 'u-ml', lyfeId: null, mktrLeadsId: 'ml-9' });
    deps.sequelize.query.mockResolvedValue([[{ id: 'p1' }]]);
    const svc = makeProspectService(deps);

    const res = await svc.returnProspectToHeld('p1', WEB_OPTS);

    expect(res).toEqual({ status: 'undeliverable' });
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });

  it('web flavor promotes an already-unassigned stray into the held pool with no webhook', async () => {
    const deps = buildDeps();
    wireProspect(deps, { id: 'p1', assignedAgentId: null, quarantinedAt: null });
    deps.sequelize.query.mockResolvedValue([[{ id: 'p1' }]]);
    const svc = makeProspectService(deps);

    const res = await svc.returnProspectToHeld('p1', WEB_OPTS);

    expect(res).toEqual({ status: 'promoted', leadId: 'p1' });
    const [sql, { replacements }] = deps.sequelize.query.mock.calls[0];
    expect(sql).toContain('"assignedAgentId" IS NULL');
    expect(replacements.reason).toBe('returned_by_admin');
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
  });

  it('external flavor (defaults) keeps its fences: Lyfe-owned → not_assignable, reason stays no_funded_agent', async () => {
    const deps = buildDeps();
    wireProspect(deps, { id: 'p1', assignedAgentId: 'u-lyfe', quarantinedAt: null, sourceMetadata: {} });
    deps.models.User.findByPk.mockResolvedValue({ id: 'u-lyfe', lyfeId: 'lyfe-uuid', mktrLeadsId: null });
    const svc = makeProspectService(deps);

    const res = await svc.returnProspectToHeld('p1', { actorUserId: 'x' });
    expect(res).toEqual({ status: 'not_assignable' });

    // mktr-leads-owned still works and re-holds under the EXTERNAL reason.
    deps.models.User.findByPk.mockResolvedValue({ id: 'u-ml', lyfeId: null, mktrLeadsId: 'ml-9' });
    wireProspect(deps, { id: 'p2', assignedAgentId: 'u-ml', quarantinedAt: null, sourceMetadata: {} });
    deps.sequelize.query.mockResolvedValue([[{ id: 'p2' }]]);
    const res2 = await svc.returnProspectToHeld('p2', { actorUserId: 'x' });
    expect(res2).toEqual({ status: 'returned', leadId: 'p2' });
    expect(deps.sequelize.query.mock.calls[0][1].replacements.reason).toBe('no_funded_agent');
  });

  it('external flavor never promotes: unassigned lead stays already_handled', async () => {
    const deps = buildDeps();
    wireProspect(deps, { id: 'p1', assignedAgentId: null, quarantinedAt: null });
    const svc = makeProspectService(deps);

    expect(await svc.returnProspectToHeld('p1', {})).toEqual({ status: 'already_handled' });
    expect(deps.sequelize.query).not.toHaveBeenCalled();
  });

  it('held lead is already_handled for both flavors', async () => {
    const deps = buildDeps();
    wireProspect(deps, { id: 'p1', assignedAgentId: null, quarantinedAt: new Date() });
    const svc = makeProspectService(deps);

    expect(await svc.returnProspectToHeld('p1', WEB_OPTS)).toEqual({ status: 'already_handled' });
    expect(await svc.returnProspectToHeld('p1', {})).toEqual({ status: 'already_handled' });
  });
});

/* ══════════════════════════════════════════════════════════════════
   bulk fan-out wrappers
   ══════════════════════════════════════════════════════════════════ */
describe('bulkReturnProspectsToHeld / bulkDeleteProspects', () => {
  it('bulk return dedupes ids and buckets per-row outcomes', async () => {
    const deps = buildDeps();
    // p-ret: assigned to a no-destination owner → returned (no delivery needed).
    // p-pro: unassigned stray → promoted. p-held: quarantined → alreadyHeld. p-gone → notFound.
    deps.models.Prospect.findOne.mockImplementation(({ where }) => {
      const byId = {
        'p-ret': { id: 'p-ret', assignedAgentId: 'sys-1', quarantinedAt: null, sourceMetadata: {} },
        'p-pro': { id: 'p-pro', assignedAgentId: null, quarantinedAt: null },
        'p-held': { id: 'p-held', assignedAgentId: null, quarantinedAt: new Date() },
      };
      return Promise.resolve(byId[where.id] || null);
    });
    deps.models.User.findByPk.mockResolvedValue({ id: 'sys-1', lyfeId: null, mktrLeadsId: null });
    deps.sequelize.query.mockImplementation((sql, { replacements }) => Promise.resolve([[{ id: replacements.prospectId }]]));
    const svc = makeProspectService(deps);

    const counts = await svc.bulkReturnProspectsToHeld(['p-ret', 'p-pro', 'p-held', 'p-gone', 'p-ret'], ADMIN);

    expect(counts).toEqual({ returned: 1, promoted: 1, alreadyHeld: 1, undeliverable: 0, notFound: 1 });
    // Dedupe: p-ret handled once despite appearing twice.
    expect(deps.models.Prospect.findOne).toHaveBeenCalledTimes(4);
  });

  it('bulk delete counts deletions and 404s without aborting the batch', async () => {
    const deps = buildDeps();
    const destroyed = [];
    deps.models.Prospect.findOne.mockImplementation(({ where }) => {
      if (where.id === 'p-gone') return Promise.resolve(null);
      return Promise.resolve({
        id: where.id,
        assignedAgentId: null,
        destroy: jest.fn().mockImplementation(() => { destroyed.push(where.id); return Promise.resolve(); }),
      });
    });
    const svc = makeProspectService(deps);

    const counts = await svc.bulkDeleteProspects(['p-1', 'p-gone', 'p-2'], ADMIN);

    expect(counts).toEqual({ deleted: 2, notFound: 1, failed: 0 });
    expect(destroyed).toEqual(['p-1', 'p-2']);
  });
});

/* ══════════════════════════════════════════════════════════════════
   assignProspect held release — event contract
   ══════════════════════════════════════════════════════════════════ */
describe('assignProspect held release fires lead.assigned (never lead.created)', () => {
  it('release path dispatches lead.assigned with routing.mode + qrTag block', async () => {
    const deps = buildDeps();
    const prospect = {
      id: 'p1',
      assignedAgentId: null,
      quarantinedAt: new Date(),
      quarantineReason: 'returned_by_admin',
      campaignId: 'c1',
      sourceMetadata: {},
      reload: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
    };
    deps.models.Prospect.findByPk.mockImplementation((id, opts) => {
      if (opts?.include) {
        return Promise.resolve({ id: 'p1', sourceMetadata: {}, campaign: { id: 'c1', name: 'C' }, qrTag: { id: 'q1', slug: 's1' } });
      }
      return Promise.resolve(prospect);
    });
    deps.models.User.findOne.mockResolvedValue({ id: 'agent-1', firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '65', lyfeId: 'lyfe-1' });
    deps.sequelize.query.mockResolvedValue([[{ id: 'p1' }]]); // atomic release claim wins
    const svc = makeProspectService(deps);

    await svc.assignProspect('p1', 'agent-1', ADMIN);

    const events = deps.dispatchEvent.mock.calls.map(([evt]) => evt);
    expect(events).toContain('lead.assigned');
    expect(events).not.toContain('lead.created');
    const [, builder, opts] = deps.dispatchEvent.mock.calls.find(([evt]) => evt === 'lead.assigned');
    expect(opts).toEqual({ destination: 'lyfe' });
    const payload = builder();
    expect(payload.data.routing.mode).toBe('direct');
    expect(payload.data.qrTag).toEqual({ externalId: 'q1', slug: 's1' });
  });
});
