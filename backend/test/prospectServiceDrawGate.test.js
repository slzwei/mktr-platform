/**
 * Lucky-draw entry gate + verification-stamp binding
 * (docs/plans/lucky-draw-10x.md §4.4), via the makeProspectService DI seam —
 * no live Postgres. Pins:
 *  - draw campaigns REQUIRE phone (422), accepted terms (422), a live OTP
 *    marker on the NORMALIZED phone (403), and an open entry window (410);
 *  - the stamp is written post-normalization with phoneVerifiedFor binding;
 *  - draw-terms acceptance is pinned into consentMetadata.drawTerms;
 *  - non-draw campaigns keep the capture-everything posture byte-identical.
 */
import { createHash } from 'crypto';
import { jest } from '@jest/globals';
import { makeProspectService } from '../src/services/prospectService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const FULL_PHONE = '+6591234567';
const TERMS_VERSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const TERMS_HASH = 'b'.repeat(64);

function drawCampaign(overrides = {}) {
  return {
    id: 'camp-draw-1',
    name: 'Cabin Luggage Draw',
    status: 'active',
    design_config: {
      luckyDraw: {
        enabled: true,
        closesAt: '2099-12-31',
        prize: 'Cabin luggage',
        multiplier: 10,
        termsVersionId: TERMS_VERSION_ID,
        termsHash: TERMS_HASH,
        ...overrides,
      },
    },
  };
}

function buildDeps({ campaign = null, phoneVerified = () => false, overrides = {} } = {}) {
  const Prospect = {
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockImplementation((id) =>
      Promise.resolve({ id, campaign: null, assignedAgent: null })
    ),
    create: jest.fn().mockImplementation((fields) =>
      Promise.resolve({ id: 'pros-1', ...fields, update: jest.fn() })
    ),
  };
  const models = {
    Prospect,
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    Attribution: { findOne: jest.fn().mockResolvedValue(null) },
    Campaign: { findByPk: jest.fn().mockResolvedValue(campaign) },
    QrTag: { findByPk: jest.fn().mockResolvedValue(null) },
    User: { findByPk: jest.fn().mockResolvedValue(null) },
    AgentGroup: { findByPk: jest.fn().mockResolvedValue(null) },
    AgentGroupMember: { findAll: jest.fn().mockResolvedValue([]) },
    Commission: {},
  };
  return {
    models,
    sequelize: {
      transaction: jest.fn().mockImplementation(async (cb) => cb({})),
      literal: jest.fn().mockImplementation((s) => ({ literal: s })),
    },
    resolveAssignedAgentId: jest.fn().mockResolvedValue(null),
    getSystemAgentId: jest.fn().mockResolvedValue(null),
    deductLeadCredit: jest.fn().mockResolvedValue(),
    buildProspectWhere: jest.fn(),
    // The happy path runs to completion, so every dep that would touch a live
    // Postgres is stubbed (unlike prospectServiceCapi.test.js, which predates
    // this and needs the throwaway-pg setup to go green).
    resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: null, via: 'none' }),
    resolveLeadAssignment: jest.fn().mockResolvedValue({ agentId: null, via: 'none' }),
    chargeLeadCredit: jest.fn().mockResolvedValue({ charged: false }),
    deductExternalLeadBalance: jest.fn().mockResolvedValue({ charged: false }),
    hasDeliverableSubscriber: jest.fn().mockResolvedValue(false),
    persistEventDeliveries: jest.fn().mockResolvedValue([]),
    flushDeliveries: jest.fn().mockResolvedValue(),
    getOrCreateProspectShareLink: jest.fn().mockResolvedValue({ url: '/share/test' }),
    dispatchEvent: jest.fn().mockResolvedValue(),
    sendLeadEvent: jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' }),
    sendCompleteRegistrationEvent: jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' }),
    sendTikTokLeadEvent: jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' }),
    sendTikTokCompleteRegistrationEvent: jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' }),
    isPhoneRecentlyVerified: jest.fn().mockImplementation(phoneVerified),
    AppError: class AppError extends Error {
      constructor(m, s) { super(m); this.statusCode = s; }
    },
    logger: silentLogger,
    ...overrides,
  };
}

const admin = { id: 'admin-1', role: 'admin' };
const baseBody = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  leadSource: 'qr_code',
  campaignId: 'camp-draw-1',
  consent_terms: true,
};

describe('lucky-draw entry gate (createProspect)', () => {
  it('rejects a phone-less entry with 422', async () => {
    const deps = buildDeps({ campaign: drawCampaign() });
    const svc = makeProspectService(deps);
    await expect(svc.createProspect({ ...baseBody }, admin, {})).rejects.toMatchObject({ statusCode: 422 });
    expect(deps.models.Prospect.create).not.toHaveBeenCalled();
  });

  it('rejects missing consent_terms with 422', async () => {
    const deps = buildDeps({ campaign: drawCampaign(), phoneVerified: () => true });
    const svc = makeProspectService(deps);
    const { consent_terms: _omit, ...noTerms } = baseBody;
    await expect(
      svc.createProspect({ ...noTerms, phone: FULL_PHONE }, admin, {})
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects an unverified phone with 403', async () => {
    const deps = buildDeps({ campaign: drawCampaign(), phoneVerified: () => false });
    const svc = makeProspectService(deps);
    await expect(
      svc.createProspect({ ...baseBody, phone: FULL_PHONE }, admin, {})
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(deps.models.Prospect.create).not.toHaveBeenCalled();
  });

  it('rejects entries after closesAt (SGT end-of-day, exclusive) with 410', async () => {
    const deps = buildDeps({
      campaign: drawCampaign({ closesAt: '2020-01-01' }),
      phoneVerified: (p) => p === FULL_PHONE,
    });
    const svc = makeProspectService(deps);
    await expect(
      svc.createProspect({ ...baseBody, phone: FULL_PHONE }, admin, {})
    ).rejects.toMatchObject({ statusCode: 410 });
  });

  it('normalizes a raw 8-digit phone BEFORE the marker check, then stamps the binding + draw terms', async () => {
    // Marker keyed by full E.164 (how /verify/check writes it) — a raw-digits
    // body must still match after normalization (Codex-review fix, §4.4).
    const deps = buildDeps({
      campaign: drawCampaign(),
      phoneVerified: (p) => p === FULL_PHONE,
    });
    const svc = makeProspectService(deps);
    await svc.createProspect({ ...baseBody, phone: '91234567' }, admin, {});

    expect(deps.models.Prospect.create).toHaveBeenCalledTimes(1);
    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.phone).toBe(FULL_PHONE);
    expect(created.sourceMetadata.phoneVerifiedAt).toEqual(expect.any(String));
    expect(created.sourceMetadata.phoneVerifiedFor).toBe(
      createHash('sha256').update(FULL_PHONE).digest('hex')
    );
    expect(created.consentMetadata.drawTerms).toMatchObject({
      termsVersionId: TERMS_VERSION_ID,
      termsHash: TERMS_HASH,
      acceptedAt: expect.any(String),
    });
  });

  it('leaves non-draw campaigns byte-identical: phone-less, consent-less POST still captures', async () => {
    const deps = buildDeps({
      campaign: { id: 'camp-plain', name: 'Plain', status: 'active', design_config: {} },
    });
    const svc = makeProspectService(deps);
    const { consent_terms: _omit, ...noTerms } = baseBody;
    await svc.createProspect({ ...noTerms, campaignId: 'camp-plain' }, admin, {});
    expect(deps.models.Prospect.create).toHaveBeenCalledTimes(1);
    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata?.phoneVerifiedAt).toBeUndefined();
    expect(created.consentMetadata?.drawTerms).toBeUndefined();
  });

  it('stamps phoneVerifiedFor on NON-draw campaigns too when the marker is live', async () => {
    const deps = buildDeps({
      campaign: { id: 'camp-plain', name: 'Plain', status: 'active', design_config: {} },
      phoneVerified: (p) => p === FULL_PHONE,
    });
    const svc = makeProspectService(deps);
    await svc.createProspect({ ...baseBody, campaignId: 'camp-plain', phone: FULL_PHONE }, admin, {});
    const created = deps.models.Prospect.create.mock.calls[0][0];
    expect(created.sourceMetadata.phoneVerifiedFor).toBe(
      createHash('sha256').update(FULL_PHONE).digest('hex')
    );
  });
});
