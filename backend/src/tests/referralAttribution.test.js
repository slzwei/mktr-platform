import { makeProspectService } from '../services/prospectService.js';

// Proves the referral-identity wiring in createProspect: a referralRef in the
// body (the sharer's prospect UUID from the share URL's ?ref=) is resolved into
// sourceMetadata.referral — gated on leadSource === 'referral', name only for
// same-campaign referrers, never blocking lead creation, and never reaching
// Sequelize as a bogus Prospect column. Uses dependency injection
// (makeProspectService overrides) so no real DB is needed — same harness as
// quizProspectWiring.test.js.

const REFERRER_ID = '5f1e9c1a-2222-4444-8888-aaaaaaaaaaaa';

function buildService({ referrer, findByPkImpl } = {}) {
  const fakeTx = {};
  const findByPkCalls = [];
  const overrides = {
    models: {
      Attribution: { findOne: async () => null },
      QrTag: { findByPk: async () => null, update: async () => [0, []] },
      Campaign: { findByPk: async () => ({ id: 'camp-1', design_config: {} }) },
      Prospect: {
        findOne: async () => null,
        create: async (data) => ({ id: 'prospect-new', ...data }),
        findByPk: async (id, opts) => {
          findByPkCalls.push({ id, opts });
          if (findByPkImpl) return findByPkImpl(id, opts);
          return referrer ?? null;
        },
      },
      ProspectActivity: { create: async () => ({}) },
      User: { findByPk: async () => null, findOne: async () => null },
      AgentGroup: { findByPk: async () => null },
      AgentGroupMember: { findAll: async () => [] },
    },
    sequelize: { transaction: async (fn) => fn(fakeTx), literal: (s) => s },
    resolveAssignedAgentId: async () => null,
    getSystemAgentId: async () => null,
    deductLeadCredit: async () => true,
    buildProspectWhere: async () => ({}),
    dispatchEvent: () => Promise.resolve(),
    sendLeadEvent: () => Promise.resolve(),
    AppError: class AppError extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  };
  return { svc: makeProspectService(overrides), findByPkCalls };
}

const baseBody = {
  firstName: 'Friend',
  email: 'friend@example.com',
  leadSource: 'referral',
  campaignId: 'camp-1',
};

describe('createProspect — referral identity wiring', () => {
  it('resolves a same-campaign referrer to id + sameCampaign + name', async () => {
    const { svc } = buildService({
      referrer: { id: REFERRER_ID, firstName: 'Jane', lastName: 'Doe', campaignId: 'camp-1' },
    });
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: REFERRER_ID },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.referral).toEqual({
      ref: REFERRER_ID,
      referrerProspectId: REFERRER_ID,
      sameCampaign: true,
      referrerName: 'Jane Doe',
    });
  });

  it('cross-campaign referrer keeps ids only — no name harvest', async () => {
    const { svc } = buildService({
      referrer: { id: REFERRER_ID, firstName: 'Jane', lastName: 'Doe', campaignId: 'camp-OTHER' },
    });
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: REFERRER_ID },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.referral).toEqual({
      ref: REFERRER_ID,
      referrerProspectId: REFERRER_ID,
      sameCampaign: false,
    });
    expect(prospect.sourceMetadata.referral.referrerName).toBeUndefined();
  });

  it('unknown referrer UUID stores the raw ref only', async () => {
    const { svc } = buildService({ referrer: null });
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: REFERRER_ID },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.referral).toEqual({ ref: REFERRER_ID });
  });

  it('non-UUID ref (legacy slug) is stored raw without a DB lookup', async () => {
    const { svc, findByPkCalls } = buildService({});
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: 'legacy-slug-42' },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.referral).toEqual({ ref: 'legacy-slug-42' });
    expect(findByPkCalls).toHaveLength(0);
  });

  it('ignores referralRef when leadSource is not referral', async () => {
    const { svc, findByPkCalls } = buildService({
      referrer: { id: REFERRER_ID, firstName: 'Jane', lastName: 'Doe', campaignId: 'camp-1' },
    });
    const { prospect } = await svc.createProspect(
      { ...baseBody, leadSource: 'website', referralRef: REFERRER_ID },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata?.referral).toBeUndefined();
    expect(findByPkCalls).toHaveLength(0);
  });

  it("ignores the anonymous legacy ref value '1'", async () => {
    const { svc, findByPkCalls } = buildService({});
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: '1' },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata?.referral).toBeUndefined();
    expect(findByPkCalls).toHaveLength(0);
  });

  it('never passes referralRef through as a Prospect column', async () => {
    const { svc } = buildService({
      referrer: { id: REFERRER_ID, firstName: 'Jane', lastName: 'Doe', campaignId: 'camp-1' },
    });
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: REFERRER_ID },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    // prospect is the create() input echoed back by the fake — a referralRef
    // key here would mean it reached Sequelize as a bogus attribute.
    expect(prospect.referralRef).toBeUndefined();
  });

  it('a throwing referrer lookup never blocks lead creation', async () => {
    const { svc } = buildService({
      findByPkImpl: () => { throw new Error('db down'); },
    });
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: REFERRER_ID },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.id).toBe('prospect-new');
    expect(prospect.sourceMetadata.referral).toEqual({ ref: REFERRER_ID });
  });

  it('coexists with utm stash on the same submit', async () => {
    const { svc } = buildService({
      referrer: { id: REFERRER_ID, firstName: 'Jane', lastName: 'Doe', campaignId: 'camp-1' },
    });
    const { prospect } = await svc.createProspect(
      { ...baseBody, referralRef: REFERRER_ID, utm_source: 'facebook', utm_campaign: 'jun-leads' },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.utm).toEqual({ utm_source: 'facebook', utm_campaign: 'jun-leads' });
    expect(prospect.sourceMetadata.referral.referrerName).toBe('Jane Doe');
  });
});
