/**
 * Phase 2 wire-up tests: prospectService.createProspect → metaCapiService.sendLeadEvent.
 *
 * Uses the makeProspectService dependency-injection seam so we can run without
 * a live Postgres. Models, sequelize, and external services are stubbed to the
 * minimum needed to exercise the createProspect happy path.
 *
 * Integration-level coverage (real DB + supertest) lives in prospects.test.js.
 */
import { jest } from '@jest/globals';
import { makeProspectService } from '../src/services/prospectService.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function buildDeps(overrides = {}) {
  const createdProspects = [];
  const Prospect = {
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockImplementation((id) => Promise.resolve({
      id,
      // mirror just enough of the eager-load shape used after create
      campaign: null,
      assignedAgent: null,
    })),
    create: jest.fn().mockImplementation((fields) => {
      const instance = { id: `pros-${createdProspects.length + 1}`, ...fields, update: jest.fn() };
      createdProspects.push(instance);
      return Promise.resolve(instance);
    }),
  };
  const ProspectActivity = { create: jest.fn().mockResolvedValue({}) };
  const Attribution = { findOne: jest.fn().mockResolvedValue(null) };
  const Campaign = { findByPk: jest.fn().mockResolvedValue(null) };
  const QrTag = { findByPk: jest.fn().mockResolvedValue(null) };
  const User = { findByPk: jest.fn().mockResolvedValue(null) };
  const AgentGroup = { findByPk: jest.fn().mockResolvedValue(null) };
  const AgentGroupMember = { findAll: jest.fn().mockResolvedValue([]) };
  const Commission = {};

  const sequelize = {
    transaction: jest.fn().mockImplementation(async (cb) => cb({}) /* fake tx */),
    literal: jest.fn().mockImplementation((s) => ({ literal: s })),
  };

  return {
    models: { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, AgentGroup, AgentGroupMember },
    sequelize,
    resolveAssignedAgentId: jest.fn().mockResolvedValue(null),
    getSystemAgentId: jest.fn().mockResolvedValue(null),
    deductLeadCredit: jest.fn().mockResolvedValue(),
    buildProspectWhere: jest.fn(),
    dispatchEvent: jest.fn().mockResolvedValue(),
    sendLeadEvent: jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' }),
    sendCompleteRegistrationEvent: jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' }),
    AppError: class AppError extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
    logger: silentLogger,
    createdProspects,
    ...overrides,
  };
}

describe('prospectService.createProspect → CAPI wire-up (Phase 2)', () => {
  const baseBody = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    leadSource: 'web_form',
  };

  it('persists eventId/fbp/fbc/eventSourceUrl + clientIp/clientUserAgent into sourceMetadata on Prospect.create', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      {
        meta: {
          clientIp: '203.0.113.42',
          clientUserAgent: 'Mozilla/5.0',
          eventId: 'evt-abc',
          fbp: 'fb.1.123.456',
          fbc: 'fb.1.789.fbclid',
          eventSourceUrl: 'https://mktr.sg/lead-capture/slug',
        },
      }
    );

    expect(deps.models.Prospect.create).toHaveBeenCalledTimes(1);
    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toEqual({
      eventId: 'evt-abc',
      fbp: 'fb.1.123.456',
      fbc: 'fb.1.789.fbclid',
      eventSourceUrl: 'https://mktr.sg/lead-capture/slug',
      clientIp: '203.0.113.42',
      clientUserAgent: 'Mozilla/5.0',
    });
  });

  it('reads meta-fields from body (controller forwards them in the body) and strips them before Prospect.create', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      {
        ...baseBody,
        eventId: 'evt-body',
        fbp: 'fbp-body',
        fbc: 'fbc-body',
        eventSourceUrl: 'https://mktr.sg/lead-capture/slug',
      },
      { id: 'admin-1', role: 'admin' },
      {} // no meta context
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    // sourceMetadata picks up the body meta fields
    expect(created.sourceMetadata).toMatchObject({
      eventId: 'evt-body',
      fbp: 'fbp-body',
      fbc: 'fbc-body',
      eventSourceUrl: 'https://mktr.sg/lead-capture/slug',
    });
    // and they're NOT present as top-level attributes (avoiding Sequelize attribute collision)
    expect(created.eventId).toBeUndefined();
    expect(created.fbp).toBeUndefined();
    expect(created.fbc).toBeUndefined();
    expect(created.eventSourceUrl).toBeUndefined();
  });

  it('preserves any pre-existing sourceMetadata keys when merging meta-fields', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      {
        ...baseBody,
        sourceMetadata: { keep: 'me' },
      },
      { id: 'admin-1', role: 'admin' },
      { meta: { clientIp: '1.2.3.4' } }
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toEqual({ keep: 'me', clientIp: '1.2.3.4' });
  });

  it('does NOT touch sourceMetadata when no meta-fields are present (no empty object pollution)', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect({ ...baseBody }, { id: 'admin-1', role: 'admin' }, {});

    const created = deps.models.Prospect.create.mock.calls[0][0];
    // incoming.sourceMetadata is left untouched (undefined here, since not set)
    expect(created.sourceMetadata).toBeUndefined();
  });

  it('calls sendLeadEvent post-commit with the created prospect and ctx', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      {
        meta: {
          clientIp: '203.0.113.42',
          clientUserAgent: 'Mozilla/5.0',
          eventId: 'evt-xyz',
          fbp: 'fbp-xyz',
          fbc: 'fbc-xyz',
          eventSourceUrl: 'https://mktr.sg/x',
        },
      }
    );

    expect(deps.sendLeadEvent).toHaveBeenCalledTimes(1);
    const [prospectArg, ctxArg] = deps.sendLeadEvent.mock.calls[0];
    expect(prospectArg.id).toMatch(/^pros-/);
    expect(prospectArg.sourceMetadata).toMatchObject({ eventId: 'evt-xyz' });
    expect(ctxArg).toEqual({
      eventId: 'evt-xyz',
      fbp: 'fbp-xyz',
      fbc: 'fbc-xyz',
      eventSourceUrl: 'https://mktr.sg/x',
      clientIp: '203.0.113.42',
      clientUserAgent: 'Mozilla/5.0',
    });
  });

  it('does not throw when sendLeadEvent rejects (fire-and-forget contract)', async () => {
    const deps = buildDeps({
      sendLeadEvent: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const svc = makeProspectService(deps);

    await expect(
      svc.createProspect(
        { ...baseBody },
        { id: 'admin-1', role: 'admin' },
        { meta: { eventId: 'evt-1' } }
      )
    ).resolves.toBeDefined();

    // Sanity: webhook dispatch was also called (proving we don't short-circuit)
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
  });

  it('still fires sendLeadEvent for prospects with no meta-fields (guard inside sendLeadEvent will reject)', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect({ ...baseBody }, { id: 'admin-1', role: 'admin' }, {});

    // The wire-up always calls; the metaCapiService's shouldFireCapi guard decides
    // whether to actually dispatch. This decouples the wiring from the guard policy.
    expect(deps.sendLeadEvent).toHaveBeenCalledTimes(1);
    const [, ctxArg] = deps.sendLeadEvent.mock.calls[0];
    expect(ctxArg).toEqual({
      eventId: undefined,
      fbp: undefined,
      fbc: undefined,
      eventSourceUrl: undefined,
      clientIp: undefined,
      clientUserAgent: undefined,
    });
  });
});

describe('createProspect → consent persistence (Phase 4 step 1b)', () => {
  const baseBody = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    leadSource: 'website',
  };

  it('persists consent_contact=true into sourceMetadata', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody, consent_contact: true, consent_terms: true },
      { id: 'admin-1', role: 'admin' },
      {}
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toEqual({
      consent_contact: true,
      consent_terms: true,
    });
  });

  it('persists consent_contact=false explicitly (user opted out of marketing)', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody, consent_contact: false, consent_terms: true },
      { id: 'admin-1', role: 'admin' },
      {}
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toEqual({
      consent_contact: false,
      consent_terms: true,
    });
  });

  it('omits consent fields from sourceMetadata when not provided in body', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect({ ...baseBody }, { id: 'admin-1', role: 'admin' }, {});

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toBeUndefined();
  });

  it('strips consent fields from Prospect attributes (no Sequelize attribute leakage)', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody, consent_contact: true, consent_terms: true },
      { id: 'admin-1', role: 'admin' },
      {}
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    // consent fields must NOT be at top-level on Prospect (would be silently dropped or error)
    expect(created.consent_contact).toBeUndefined();
    expect(created.consent_terms).toBeUndefined();
    // They're only in sourceMetadata
    expect(created.sourceMetadata.consent_contact).toBe(true);
    expect(created.sourceMetadata.consent_terms).toBe(true);
  });

  it('merges consent fields with other meta-fields into a single sourceMetadata blob', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody, consent_contact: true, consent_terms: true },
      { id: 'admin-1', role: 'admin' },
      {
        meta: {
          eventId: 'evt-merge',
          fbp: 'fbp-merge',
          clientIp: '1.2.3.4',
        },
      }
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toEqual({
      eventId: 'evt-merge',
      fbp: 'fbp-merge',
      clientIp: '1.2.3.4',
      consent_contact: true,
      consent_terms: true,
    });
  });
});

describe('createProspect → per-campaign Pixel override (Phase 5)', () => {
  const baseBody = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    leadSource: 'website',
    campaignId: 'campaign-uuid-1',
  };

  it('passes sourceCampaign.metaPixelId to sendLeadEvent as ctx.pixelIdOverride', async () => {
    const deps = buildDeps();
    deps.models.Campaign.findByPk = jest.fn().mockResolvedValue({
      id: 'campaign-uuid-1',
      name: 'Test Campaign',
      metaPixelId: 'pixel-override-999',
    });
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'evt-1' } }
    );

    expect(deps.sendLeadEvent).toHaveBeenCalledTimes(1);
    const [, ctxArg] = deps.sendLeadEvent.mock.calls[0];
    expect(ctxArg.pixelIdOverride).toBe('pixel-override-999');
  });

  it('passes pixelIdOverride: undefined when sourceCampaign.metaPixelId is null', async () => {
    const deps = buildDeps();
    deps.models.Campaign.findByPk = jest.fn().mockResolvedValue({
      id: 'campaign-uuid-1',
      name: 'Test Campaign',
      metaPixelId: null,
    });
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'evt-1' } }
    );

    const [, ctxArg] = deps.sendLeadEvent.mock.calls[0];
    expect(ctxArg.pixelIdOverride).toBeUndefined();
  });

  it('passes pixelIdOverride: undefined when no campaign is associated', async () => {
    const deps = buildDeps();
    // Campaign.findByPk returns null (default mock) — no campaign loaded
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody, campaignId: undefined },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'evt-1' } }
    );

    const [, ctxArg] = deps.sendLeadEvent.mock.calls[0];
    expect(ctxArg.pixelIdOverride).toBeUndefined();
  });
});

describe('createProspect → CompleteRegistration CAPI (Phase 5)', () => {
  const baseBody = {
    firstName: 'Quiz',
    lastName: 'Taker',
    email: 'quiz@example.com',
    leadSource: 'website',
  };

  it('fires sendCompleteRegistrationEvent with the registrationEventId as ctx.eventId when present', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'lead-evt', registrationEventId: 'reg-evt-9', fbp: 'fbp-1', clientIp: '1.2.3.4' } }
    );

    expect(deps.sendCompleteRegistrationEvent).toHaveBeenCalledTimes(1);
    const [prospectArg, ctxArg] = deps.sendCompleteRegistrationEvent.mock.calls[0];
    expect(prospectArg.id).toMatch(/^pros-/);
    // The CR event_id is the registration id (NOT the lead eventId) — dedup contract.
    expect(ctxArg.eventId).toBe('reg-evt-9');
    expect(ctxArg.fbp).toBe('fbp-1');
    expect(ctxArg.clientIp).toBe('1.2.3.4');
    // Lead still fires with its own eventId.
    expect(deps.sendLeadEvent).toHaveBeenCalledTimes(1);
    expect(deps.sendLeadEvent.mock.calls[0][1].eventId).toBe('lead-evt');
  });

  it('does NOT fire sendCompleteRegistrationEvent when no registrationEventId (non-quiz lead)', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'lead-evt' } }
    );

    expect(deps.sendCompleteRegistrationEvent).not.toHaveBeenCalled();
    expect(deps.sendLeadEvent).toHaveBeenCalledTimes(1);
  });

  it('does not throw when sendCompleteRegistrationEvent rejects (fire-and-forget)', async () => {
    const deps = buildDeps({
      sendCompleteRegistrationEvent: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const svc = makeProspectService(deps);

    await expect(
      svc.createProspect(
        { ...baseBody },
        { id: 'admin-1', role: 'admin' },
        { meta: { eventId: 'lead-evt', registrationEventId: 'reg-1' } }
      )
    ).resolves.toBeDefined();
  });
});

describe('createProspect → TikTok identifiers + registrationEventId persistence (Phase 5)', () => {
  const baseBody = {
    firstName: 'Quiz',
    lastName: 'Taker',
    email: 'quiz@example.com',
    leadSource: 'website',
  };

  it('persists ttclid, ttp, and registrationEventId into sourceMetadata', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'lead-evt', registrationEventId: 'reg-1', ttclid: 'ttclid-abc', ttp: 'ttp-xyz' } }
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toMatchObject({
      eventId: 'lead-evt',
      registrationEventId: 'reg-1',
      ttclid: 'ttclid-abc',
      ttp: 'ttp-xyz',
    });
  });

  it('reads ttclid/ttp/registrationEventId from the body when meta is absent, and strips them from Prospect attributes', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody, ttclid: 'tt-body', ttp: 'ttp-body', registrationEventId: 'reg-body' },
      { id: 'admin-1', role: 'admin' },
      {}
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toMatchObject({
      ttclid: 'tt-body',
      ttp: 'ttp-body',
      registrationEventId: 'reg-body',
    });
    // Not leaked as top-level Sequelize attributes.
    expect(created.ttclid).toBeUndefined();
    expect(created.ttp).toBeUndefined();
    expect(created.registrationEventId).toBeUndefined();
  });

  it('omits ttclid/ttp/registrationEventId from sourceMetadata when not provided', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);

    await svc.createProspect(
      { ...baseBody },
      { id: 'admin-1', role: 'admin' },
      { meta: { eventId: 'lead-evt' } }
    );

    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata).toEqual({ eventId: 'lead-evt' });
  });
});
