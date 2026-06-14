/**
 * Unit tests for externalLeadOutcomeService.processExternalLeadOutcome — the
 * MKTR Leads buyer-outcome → Prospect status mirror.
 *
 * Uses the makeExternalLeadOutcomeService dependency-injection seam so we run
 * without a live Postgres: sequelize.transaction and the Prospect /
 * ProspectActivity / IdempotencyKey models are stubbed.
 */
import { jest } from '@jest/globals';
import { makeExternalLeadOutcomeService, IDEMPOTENCY_SCOPE } from '../src/services/externalLeadOutcomeService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeProspect(overrides = {}) {
  return {
    id: 'prospect-uuid-1',
    leadStatus: 'contacted',
    conversionDate: null,
    externalAgentId: null,
    // Current delivery path: buyer's mirror users row carries mktrLeadsId.
    assignedAgent: { id: 'user-uuid-1', mktrLeadsId: 'mktr-leads-agent-uuid-1' },
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildDeps(overrides = {}) {
  const prospect = 'prospect' in overrides ? overrides.prospect : makeProspect();
  const Prospect = { findByPk: jest.fn().mockResolvedValue(prospect) };
  const ProspectActivity = { create: jest.fn().mockResolvedValue(undefined) };
  const IdempotencyKey = {
    findOne: jest.fn().mockResolvedValue(overrides.existingKey ?? null),
    create: jest.fn().mockResolvedValue(undefined),
  };
  const sequelize = { transaction: jest.fn((fn) => fn('tx')) };
  const service = makeExternalLeadOutcomeService({
    sequelize,
    models: { Prospect, ProspectActivity, IdempotencyKey, User: {} },
    logger: silentLogger,
  });
  return { service, prospect, Prospect, ProspectActivity, IdempotencyKey, sequelize };
}

function payload(overrides = {}) {
  return {
    event: 'lead.outcome',
    eventId: 'lead-uuid-1:won',
    timestamp: new Date().toISOString(),
    data: {
      externalId: 'prospect-uuid-1',
      sourceName: 'mktr',
      deliveryId: 'delivery-uuid-1',
      mktrLeadsStatus: 'won',
      ...(overrides.data || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'data')),
  };
}

describe('processExternalLeadOutcome', () => {
  it('422s an unknown prospect (sender must not stamp outcome_reported_at)', async () => {
    const { service } = buildDeps({ prospect: null });
    const result = await service.processExternalLeadOutcome(payload());
    expect(result.statusCode).toBe(422);
    expect(result.body.error).toBe('unknown_prospect');
  });

  it('422s a prospect that was never delivered to MKTR Leads', async () => {
    const internal = makeProspect({ externalAgentId: null, assignedAgent: { id: 'u', mktrLeadsId: null } });
    const { service, ProspectActivity } = buildDeps({ prospect: internal });
    const result = await service.processExternalLeadOutcome(payload());
    expect(result.statusCode).toBe(422);
    expect(result.body.error).toBe('not_a_mktr_leads_prospect');
    expect(internal.save).not.toHaveBeenCalled();
    expect(ProspectActivity.create).not.toHaveBeenCalled();
  });

  it('accepts a future external_agents-path prospect (externalAgentId set, no mirror user)', async () => {
    const external = makeProspect({ externalAgentId: 'ext-agent-uuid-1', assignedAgent: null });
    const { service } = buildDeps({ prospect: external });
    const result = await service.processExternalLeadOutcome(payload());
    expect(result.statusCode).toBe(200);
  });

  it('applies won: maps status, stamps conversionDate, writes activity, claims the key in-transaction', async () => {
    const { service, prospect, ProspectActivity, IdempotencyKey, sequelize } = buildDeps();
    const result = await service.processExternalLeadOutcome(payload());

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ success: true, appliedLeadStatus: 'won', qualitySignal: false });
    expect(prospect.leadStatus).toBe('won');
    expect(prospect.conversionDate).toBeInstanceOf(Date);
    expect(prospect.save).toHaveBeenCalledWith({ transaction: 'tx' });
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);

    const activity = ProspectActivity.create.mock.calls[0][0];
    expect(ProspectActivity.create).toHaveBeenCalledWith(expect.anything(), { transaction: 'tx' });
    expect(activity).toMatchObject({
      prospectId: 'prospect-uuid-1',
      type: 'updated',
      actorUserId: null,
      metadata: expect.objectContaining({
        source: 'mktr-leads',
        eventId: 'lead-uuid-1:won',
        mktrLeadsStatus: 'won',
        previousLeadStatus: 'contacted',
      }),
    });
    expect(activity.description.length).toBeLessThanOrEqual(255);

    const keyRow = IdempotencyKey.create.mock.calls[0][0];
    expect(IdempotencyKey.create).toHaveBeenCalledWith(expect.anything(), { transaction: 'tx' });
    expect(keyRow.key).toBe(`${IDEMPOTENCY_SCOPE}:lead-uuid-1:won`);
    expect(keyRow.scope).toBe(IDEMPOTENCY_SCOPE);
    expect(keyRow.responseCode).toBe(200);
    expect(keyRow.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not overwrite an existing conversionDate on a repeat won', async () => {
    const firstWon = new Date('2026-06-01T00:00:00Z');
    const prospect = makeProspect({ leadStatus: 'lost', conversionDate: firstWon });
    const { service } = buildDeps({ prospect });
    await service.processExternalLeadOutcome(payload());
    expect(prospect.conversionDate).toBe(firstWon);
  });

  it('maps proposed → proposal_sent (enum-verified rename)', async () => {
    const { service, prospect } = buildDeps();
    const result = await service.processExternalLeadOutcome(
      payload({ eventId: 'lead-uuid-1:proposed', data: { mktrLeadsStatus: 'proposed' } })
    );
    expect(prospect.leadStatus).toBe('proposal_sent');
    expect(result.body.appliedLeadStatus).toBe('proposal_sent');
  });

  it('preserves leadStatus for disputed and flags the activity as a quality signal', async () => {
    const { service, prospect, ProspectActivity } = buildDeps();
    const result = await service.processExternalLeadOutcome(
      payload({ eventId: 'lead-uuid-1:disputed', data: { mktrLeadsStatus: 'disputed' } })
    );
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ appliedLeadStatus: 'contacted', qualitySignal: true });
    expect(prospect.leadStatus).toBe('contacted');
    expect(prospect.save).not.toHaveBeenCalled();
    expect(ProspectActivity.create.mock.calls[0][0].metadata.qualitySignal).toBe(true);
  });

  it('skips the save but still writes the activity when the status is unchanged', async () => {
    const prospect = makeProspect({ leadStatus: 'won', conversionDate: new Date() });
    const { service, ProspectActivity } = buildDeps({ prospect });
    const result = await service.processExternalLeadOutcome(payload());
    expect(prospect.save).not.toHaveBeenCalled();
    expect(ProspectActivity.create).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it('replays the stored response for a live idempotency key without touching the prospect', async () => {
    const existingKey = {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      responseCode: 200,
      responseBody: { success: true, appliedLeadStatus: 'won' },
      destroy: jest.fn(),
    };
    const { service, Prospect } = buildDeps({ existingKey });
    const result = await service.processExternalLeadOutcome(payload());
    expect(result).toEqual({ statusCode: 200, body: { success: true, appliedLeadStatus: 'won' } });
    expect(Prospect.findByPk).not.toHaveBeenCalled();
    expect(existingKey.destroy).not.toHaveBeenCalled();
  });

  it('takes over an expired idempotency key and processes the event anew', async () => {
    const existingKey = {
      expiresAt: new Date(Date.now() - 60 * 1000),
      responseCode: 200,
      responseBody: { success: true },
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const { service, prospect, IdempotencyKey } = buildDeps({ existingKey });
    const result = await service.processExternalLeadOutcome(payload());
    expect(existingKey.destroy).toHaveBeenCalled();
    expect(prospect.leadStatus).toBe('won');
    expect(IdempotencyKey.create).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it('treats a concurrent key conflict as a replay', async () => {
    const { service, IdempotencyKey } = buildDeps();
    const conflict = new Error('duplicate key');
    conflict.name = 'SequelizeUniqueConstraintError';
    IdempotencyKey.create.mockRejectedValue(conflict);
    const result = await service.processExternalLeadOutcome(payload());
    expect(result.statusCode).toBe(200);
    expect(result.body.replay).toBe(true);
  });

  it('propagates a transaction failure so the controller can 500 (event stays re-processable)', async () => {
    const { service, ProspectActivity } = buildDeps();
    ProspectActivity.create.mockRejectedValue(new Error('db down'));
    await expect(service.processExternalLeadOutcome(payload())).rejects.toThrow('db down');
  });
});
