import { makeProspectService } from '../services/prospectService.js';

// Covers the two pieces added with the referral-email short link work, both DB-free via
// makeProspectService dependency injection (same harness as referralAttribution.test.js):
//   1. Campaign on/off submit gate — a non-active campaign (paused/draft/…) rejects public
//      signups; an active campaign (or a status-less mock) is accepted unchanged.
//   2. shareUrl mint — createProspect returns the canonical per-prospect share link, built
//      on the campaign's host via the injected getOrCreateProspectShareLink.

function buildService({ campaign, shareLinkImpl, duplicate } = {}) {
  const fakeTx = {};
  const overrides = {
    models: {
      Attribution: { findOne: async () => null },
      QrTag: { findByPk: async () => null, update: async () => [0, []] },
      Campaign: {
        findByPk: async () => campaign ?? { id: 'camp-1', design_config: {} },
      },
      Prospect: {
        // duplicate (when provided) = the existing same-campaign lead found by phone.
        findOne: async () => duplicate ?? null,
        create: async (data) => ({ id: 'prospect-new', ...data }),
        // prospectWithCampaign reload — benign null keeps the harness DB-free; the mint
        // falls back to the default ('redeem') host, which is all we assert on.
        findByPk: async () => null,
      },
      ProspectActivity: { create: async () => ({}) },
      User: { findByPk: async () => null, findOne: async () => null },
      AgentGroup: { findByPk: async () => null },
      AgentGroupMember: { findAll: async () => [] },
    },
    sequelize: { transaction: async (fn) => fn(fakeTx), literal: (s) => s },
    resolveAssignedAgentId: async () => null,
    resolveLeadRouting: async () => ({ agentId: null, via: 'fallback' }),
    getSystemAgentId: async () => null,
    deductLeadCredit: async () => true,
    buildProspectWhere: async () => ({}),
    dispatchEvent: () => Promise.resolve(),
    sendLeadEvent: () => Promise.resolve(),
    // Stub so the mint never touches the real ShortLink model / DB.
    getOrCreateProspectShareLink: shareLinkImpl || (async () => ({ slug: 'stub1234', url: '/share/stub1234' })),
    AppError: class AppError extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  };
  return makeProspectService(overrides);
}

const baseBody = {
  firstName: 'Friend',
  email: 'friend@example.com',
  leadSource: 'website',
  campaignId: 'camp-1',
};

const ctx = { cookies: {}, headers: {}, meta: {} };

describe('createProspect — campaign on/off submit gate', () => {
  it('rejects a paused campaign with 410', async () => {
    const svc = buildService({ campaign: { id: 'camp-1', status: 'paused', design_config: {} } });
    await expect(svc.createProspect({ ...baseBody }, null, ctx)).rejects.toMatchObject({
      statusCode: 410,
      message: 'This campaign is no longer active.',
    });
  });

  it.each(['draft', 'completed', 'archived'])('rejects a %s campaign', async (status) => {
    const svc = buildService({ campaign: { id: 'camp-1', status, design_config: {} } });
    await expect(svc.createProspect({ ...baseBody }, null, ctx)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('accepts an active campaign', async () => {
    const svc = buildService({ campaign: { id: 'camp-1', status: 'active', design_config: {} } });
    const { prospect } = await svc.createProspect({ ...baseBody }, null, ctx);
    expect(prospect.id).toBe('prospect-new');
  });

  it('accepts a status-less campaign (legacy row / mock) — gate never rejects on field drift', async () => {
    const svc = buildService({ campaign: { id: 'camp-1', design_config: {} } });
    const { prospect } = await svc.createProspect({ ...baseBody }, null, ctx);
    expect(prospect.id).toBe('prospect-new');
  });
});

describe('createProspect — canonical shareUrl mint', () => {
  it('returns the prospect share link built from the injected helper', async () => {
    const svc = buildService({ campaign: { id: 'camp-1', status: 'active', design_config: {} } });
    const { shareUrl } = await svc.createProspect({ ...baseBody }, null, ctx);
    expect(shareUrl).toMatch(/\/share\/stub1234$/);
  });

  it('never blocks lead creation when minting throws (shareUrl null)', async () => {
    const svc = buildService({
      campaign: { id: 'camp-1', status: 'active', design_config: {} },
      shareLinkImpl: async () => { throw new Error('shortlink down'); },
    });
    const { prospect, shareUrl } = await svc.createProspect({ ...baseBody }, null, ctx);
    expect(prospect.id).toBe('prospect-new');
    expect(shareUrl).toBeNull();
  });
});

describe('createProspect — duplicate signup returns the existing lead\'s canonical link', () => {
  it('409 carries the existing prospect id + its canonical shareUrl (not a fresh anonymous mint)', async () => {
    const svc = buildService({
      campaign: { id: 'camp-1', status: 'active', design_config: {} },
      duplicate: { id: 'existing-1' },
      shareLinkImpl: async () => ({ slug: 'dupslug', url: '/share/dupslug' }),
    });
    await expect(
      svc.createProspect({ ...baseBody, phone: '91234567' }, null, ctx)
    ).rejects.toMatchObject({
      statusCode: 409,
      data: {
        alreadyRegistered: true,
        prospectId: 'existing-1',
        shareUrl: expect.stringMatching(/\/share\/dupslug$/),
      },
    });
  });

  it('still rejects with 409 when the link mint fails (no shareUrl, prospectId preserved)', async () => {
    const svc = buildService({
      campaign: { id: 'camp-1', status: 'active', design_config: {} },
      duplicate: { id: 'existing-1' },
      shareLinkImpl: async () => { throw new Error('shortlink down'); },
    });
    await expect(
      svc.createProspect({ ...baseBody, phone: '91234567' }, null, ctx)
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { alreadyRegistered: true, prospectId: 'existing-1' },
    });
  });
});
