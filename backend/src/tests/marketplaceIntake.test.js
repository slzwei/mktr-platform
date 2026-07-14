import { makeProspectService } from '../services/prospectService.js';

// Marketplace flow intake (docs/plans/redeem-marketplace-v2.md Phase 4), DB-free
// via makeProspectService DI (same harness as campaignStatusGateAndShare.test.js):
//   1. body.marketplace values are VALIDATED against the campaign's config —
//      chip-select fields must match designer-authored options; mismatches drop.
//   2. Client-supplied sourceMetadata is discarded outright (server-composed only).

function buildService({ campaign } = {}) {
  const created = [];
  const fakeTx = {};
  const overrides = {
    models: {
      Attribution: { findOne: async () => null },
      QrTag: { findByPk: async () => null, update: async () => [0, []] },
      Campaign: {
        findByPk: async () =>
          campaign ?? {
            id: 'camp-1',
            status: 'active',
            design_config: {
              school_levels: ['P3', 'P4'],
              availability: { days: ['Sat', 'Sun'], slots: ['10:00', '14:00'] },
            },
          },
      },
      Prospect: {
        findOne: async () => null,
        create: async (data) => {
          created.push(data);
          return { id: 'prospect-new', ...data };
        },
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
    getOrCreateProspectShareLink: async () => ({ slug: 'stub1234', url: '/share/stub1234' }),
    AppError: class AppError extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  };
  return { svc: makeProspectService(overrides), created };
}

const baseBody = {
  firstName: 'Parent',
  email: 'parent@example.com',
  leadSource: 'website',
  campaignId: 'camp-1',
};

const ctx = { cookies: {}, headers: {}, meta: {} };

describe('marketplace metadata intake', () => {
  test('validated values land at sourceMetadata.marketplace', async () => {
    const { svc, created } = buildService();
    await svc.createProspect(
      {
        ...baseBody,
        marketplace: {
          child_name: '  Kai Lim ',
          child_school_level: 'P4',
          preferred_branch: 'Artelier @ Bugis',
          preferred_timing: 'Sat 10:00',
        },
      },
      null,
      ctx
    );
    expect(created[0].sourceMetadata.marketplace).toEqual({
      child_name: 'Kai Lim',
      child_school_level: 'P4',
      preferred_branch: 'Artelier @ Bugis',
      preferred_timing: 'Sat 10:00',
    });
  });

  test('values outside the campaign config are dropped, not 4xxed', async () => {
    const { svc, created } = buildService();
    const { prospect } = await svc.createProspect(
      {
        ...baseBody,
        marketplace: {
          child_school_level: 'P6', // not in school_levels
          preferred_timing: 'Mon 09:00', // day+slot not in availability
          child_name: '<img onerror=x>Kai',
        },
      },
      null,
      ctx
    );
    expect(prospect).toBeTruthy(); // lead still captured
    const mk = created[0].sourceMetadata?.marketplace || {};
    expect(mk.child_school_level).toBeUndefined();
    expect(mk.preferred_timing).toBeUndefined();
    expect(mk.child_name).toBe('img onerror=xKai'); // angle brackets stripped
  });

  test('a forged sourceMetadata.marketplace subkey is scrubbed (server-built only)', async () => {
    const { svc, created } = buildService();
    await svc.createProspect(
      {
        ...baseBody,
        // Internal callers may pass sourceMetadata (preserved — see
        // prospectServiceCapi.test.js), but marketplace is server-built only.
        sourceMetadata: { keepMe: true, marketplace: { child_name: 'Forged' } },
      },
      null,
      ctx
    );
    expect(created[0].sourceMetadata.keepMe).toBe(true);
    expect(created[0].sourceMetadata.marketplace).toBeUndefined();
  });

  test('no marketplace key → no marketplace metadata', async () => {
    const { svc, created } = buildService();
    await svc.createProspect({ ...baseBody }, null, ctx);
    expect(created[0].sourceMetadata?.marketplace).toBeUndefined();
  });
});
