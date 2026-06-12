import { makeProspectService } from '../services/prospectService.js';
import { quizDef, goldenCases } from '../../../test-fixtures/protectionPersonalityQuiz.mjs';

// Proves the wiring in createProspect: a quizResult in the body + a campaign with
// design_config.quiz => the created prospect's sourceMetadata.quiz is RE-SCORED
// server-side (scoredBy: 'server'), not trusted from the client. Uses dependency
// injection (makeProspectService overrides) so no real DB is needed.
function buildService(campaign) {
  const fakeTx = {};
  const overrides = {
    models: {
      Attribution: { findOne: async () => null },
      QrTag: { findByPk: async () => null, update: async () => [0, []] },
      Campaign: { findByPk: async () => campaign },
      Prospect: {
        findOne: async () => null,
        create: async (data) => ({ id: 'prospect-1', ...data }),
        findByPk: async () => null,
      },
      ProspectActivity: { create: async () => ({}) },
      User: { findByPk: async () => null, findOne: async () => null },
      AgentGroup: { findByPk: async () => null },
      AgentGroupMember: { findAll: async () => [] },
    },
    sequelize: { transaction: async (fn) => fn(fakeTx), literal: (s) => s },
    resolveAssignedAgentId: async () => null,
    // Quota-era routing pass (single resolver) — keep it DB-free: no agent, fallback
    // route, soft campaign ⇒ decideAssignment (pure) returns plain "assign".
    resolveLeadRouting: async () => ({ agentId: null, via: 'fallback' }),
    getSystemAgentId: async () => null,
    deductLeadCredit: async () => true,
    buildProspectWhere: async () => ({}),
    dispatchEvent: () => Promise.resolve(),
    sendLeadEvent: () => Promise.resolve(),
    AppError: class AppError extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  };
  return makeProspectService(overrides);
}

const hot = goldenCases.find((c) => c.name === 'hot_rock_exposed');

describe('createProspect — quiz funnel wiring', () => {
  it('re-scores quiz answers server-side and stashes the result on the lead', async () => {
    const svc = buildService({ id: 'camp-1', design_config: { quiz: quizDef } });
    const { prospect } = await svc.createProspect(
      { firstName: 'A', email: 'a@b.com', leadSource: 'website', campaignId: 'camp-1', quizResult: { answers: hot.answers, result: { profileId: 'TAMPERED' } } },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    const quiz = prospect.sourceMetadata.quiz;
    expect(quiz.scoredBy).toBe('server');
    expect(quiz.result.profileId).toBe(hot.expect.profileId); // not the tampered client value
    expect(quiz.result.readiness).toBe(hot.expect.readiness);
    expect(quiz.leadScore.band).toBe(hot.expect.band);
    expect(quiz.answers).toHaveLength(6);
  });

  it('marks client-unverified when the campaign has no quiz definition', async () => {
    const svc = buildService({ id: 'camp-2', design_config: {} });
    const { prospect } = await svc.createProspect(
      { firstName: 'B', email: 'b@b.com', leadSource: 'website', campaignId: 'camp-2', quizResult: { quizId: 'x', answers: hot.answers, result: { profileId: 'the-rock' } } },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.quiz.scoredBy).toBe('client-unverified');
    expect(prospect.sourceMetadata.quiz.result).toEqual({ profileId: 'the-rock' });
  });

  it('stashes utm into sourceMetadata.utm', async () => {
    const svc = buildService({ id: 'camp-3', design_config: {} });
    const { prospect } = await svc.createProspect(
      { firstName: 'C', email: 'c@b.com', leadSource: 'website', campaignId: 'camp-3', utm_source: 'tiktok', utm_campaign: 'q2' },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata.utm).toEqual({ utm_source: 'tiktok', utm_campaign: 'q2' });
  });

  it('does not add a quiz key for a normal (non-quiz) lead', async () => {
    const svc = buildService({ id: 'camp-4', design_config: { quiz: quizDef } });
    const { prospect } = await svc.createProspect(
      { firstName: 'D', email: 'd@b.com', leadSource: 'website', campaignId: 'camp-4' },
      null,
      { cookies: {}, headers: {}, meta: {} }
    );
    expect(prospect.sourceMetadata?.quiz).toBeUndefined();
  });
});
