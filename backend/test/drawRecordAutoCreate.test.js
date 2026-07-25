/**
 * ensureDrawRecord + sweepDrawRecords (luckyDrawService, DI seam — no DB):
 * the seamless replacement for the manual `run-lucky-draw.js create` step.
 * Ensure is idempotent, adopts unique-race winners, uses the system agent
 * when no operator is in scope, NEVER throws (best-effort by contract), and
 * creation still flows through createDraw so every fail-closed validation
 * (multi-prize, missing closesAt, rail conflicts) holds. The reconciler
 * only touches ACTIVE draw campaigns whose entry window is still open.
 */
import { jest } from '@jest/globals';
import { makeLuckyDrawService } from '../src/services/luckyDrawService.js';
import { sgtDayEndExclusiveMs } from '../src/utils/sgtTime.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const NOW = new Date('2026-07-25T04:00:00Z');
const CAMPAIGN_ID = 'camp-1';

const drawConfig = (over = {}) => ({
  luckyDraw: {
    enabled: true,
    closesAt: '2026-09-30',
    boostClosesAt: '2026-10-10',
    multiplier: 10,
    activationId: 'act-1',
    termsVersionId: 'tv-1',
    prize: 'iPhone 17 Pro',
    winners: 1,
    ...over,
  },
});

function buildDeps({
  existingDraw = null,
  campaign = { id: CAMPAIGN_ID, design_config: drawConfig() },
  activation = { id: 'act-1', campaignId: CAMPAIGN_ID, unlockPolicy: 'agent_unlock', status: 'active' },
  activeCampaigns = [],
  createImpl = null,
} = {}) {
  const deps = {
    Draw: {
      findOne: jest.fn().mockResolvedValue(existingDraw),
      create: createImpl || jest.fn().mockImplementation(async (fields) => ({ id: 'draw-new', ...fields })),
      findByPk: jest.fn(),
      update: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
    },
    Campaign: {
      findByPk: jest.fn().mockResolvedValue(campaign),
      findAll: jest.fn().mockResolvedValue(activeCampaigns),
    },
    Activation: {
      findByPk: jest.fn().mockResolvedValue(activation),
      findOne: jest.fn().mockResolvedValue(activation),
    },
    DrawEntry: { findAll: jest.fn().mockResolvedValue([]) },
    DrawAttempt: { findAll: jest.fn().mockResolvedValue([]) },
    DrawBoostReview: { findAll: jest.fn().mockResolvedValue([]) },
    DrawTermsVersion: { findAll: jest.fn().mockResolvedValue([{ id: 'tv-1' }]) },
    RewardEntitlement: { findAll: jest.fn().mockResolvedValue([]) },
    RedemptionEvent: { findAll: jest.fn().mockResolvedValue([]) },
    Prospect: { findAll: jest.fn().mockResolvedValue([]) },
    sequelize: { transaction: jest.fn().mockImplementation(async (cb) => cb({})) },
    logger: silentLogger,
    getSystemAgentId: jest.fn().mockResolvedValue('sys-agent-1'),
    now: () => NOW,
    mintSeed: () => 'a'.repeat(64),
  };
  return { deps, svc: makeLuckyDrawService(deps) };
}

describe('ensureDrawRecord', () => {
  it('creates the record through createDraw, attributed to the system agent', async () => {
    const { deps, svc } = buildDeps();
    const r = await svc.ensureDrawRecord({ campaignId: CAMPAIGN_ID });
    expect(r.created).toBe(true);
    expect(deps.getSystemAgentId).toHaveBeenCalled();
    const created = deps.Draw.create.mock.calls[0][0];
    expect(created.createdBy).toBe('sys-agent-1');
    expect(created.campaignId).toBe(CAMPAIGN_ID);
    expect(created.multiplier).toBe(10);
    expect(created.activationId).toBe('act-1');
    // Dates become the engine's fixed SGT end-of-day-exclusive instants.
    expect(created.closesAt.getTime()).toBe(sgtDayEndExclusiveMs('2026-09-30'));
  });

  it('uses the acting operator when one is in scope', async () => {
    const { deps, svc } = buildDeps();
    const r = await svc.ensureDrawRecord({ campaignId: CAMPAIGN_ID, user: { id: 'admin-1' } });
    expect(r.created).toBe(true);
    expect(deps.getSystemAgentId).not.toHaveBeenCalled();
    expect(deps.Draw.create.mock.calls[0][0].createdBy).toBe('admin-1');
  });

  it('is a no-op when a live record already exists', async () => {
    const { deps, svc } = buildDeps({ existingDraw: { id: 'draw-live', status: 'open' } });
    const r = await svc.ensureDrawRecord({ campaignId: CAMPAIGN_ID });
    expect(r).toMatchObject({ created: false, reason: 'exists', drawId: 'draw-live' });
    expect(deps.Draw.create).not.toHaveBeenCalled();
  });

  it('adopts the winner when it loses the one-live-draw race', async () => {
    const { deps, svc } = buildDeps({
      createImpl: jest.fn().mockRejectedValue(
        Object.assign(new Error('This campaign already has a live draw'), { statusCode: 409 })
      ),
    });
    deps.Draw.findOne
      .mockResolvedValueOnce(null) // pre-check: nothing yet
      .mockResolvedValueOnce({ id: 'draw-winner', status: 'open' }); // post-race adopt
    const r = await svc.ensureDrawRecord({ campaignId: CAMPAIGN_ID });
    expect(r).toMatchObject({ created: false, reason: 'exists', drawId: 'draw-winner' });
  });

  it("never throws: createDraw's fail-closed validation surfaces as reason 'failed'", async () => {
    // Missing closesAt → createDraw 422; the ensure absorbs it (launches must
    // never be blocked by record trouble — the reconciler retries).
    const { deps, svc } = buildDeps({
      campaign: { id: CAMPAIGN_ID, design_config: drawConfig({ closesAt: null }) },
    });
    const r = await svc.ensureDrawRecord({ campaignId: CAMPAIGN_ID });
    expect(r.created).toBe(false);
    expect(r.reason).toBe('failed');
    expect(deps.Draw.create).not.toHaveBeenCalled();
  });

  it('honours the kill switch', async () => {
    process.env.DRAW_RECORD_AUTOCREATE_ENABLED = 'false';
    try {
      const { deps, svc } = buildDeps();
      const r = await svc.ensureDrawRecord({ campaignId: CAMPAIGN_ID });
      expect(r).toMatchObject({ created: false, reason: 'disabled' });
      expect(deps.Draw.findOne).not.toHaveBeenCalled();
    } finally {
      delete process.env.DRAW_RECORD_AUTOCREATE_ENABLED;
    }
  });
});

describe('sweepDrawRecords', () => {
  it('ensures only ACTIVE draw campaigns with a still-open entry window', async () => {
    const { deps, svc } = buildDeps({
      activeCampaigns: [
        { id: 'camp-1', design_config: drawConfig() }, // eligible → ensured
        { id: 'camp-2', design_config: {} }, // not a draw → skipped
        { id: 'camp-3', design_config: drawConfig({ closesAt: '2026-05-01' }) }, // window passed → CLI territory
        { id: 'camp-4', design_config: drawConfig({ closesAt: 'not-a-date' }) }, // unparseable → skipped
      ],
    });
    // The eligible campaign resolves through the normal ensure path.
    deps.Campaign.findByPk.mockResolvedValue({ id: 'camp-1', design_config: drawConfig() });
    const results = await svc.sweepDrawRecords();
    expect(results).toMatchObject({ checked: 1, created: 1, failed: 0 });
    expect(deps.Draw.create).toHaveBeenCalledTimes(1);
    expect(deps.Draw.create.mock.calls[0][0].campaignId).toBe('camp-1');
  });

  it('counts a failing ensure without aborting the pass', async () => {
    // No activationId stamp → createDraw resolves each campaign's own active
    // rail; the first create blows up, the second succeeds.
    const { deps, svc } = buildDeps({
      activeCampaigns: [
        { id: 'camp-bad', design_config: drawConfig({ activationId: null }) },
        { id: 'camp-good', design_config: drawConfig({ activationId: null }) },
      ],
      createImpl: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
        .mockImplementation(async (fields) => ({ id: 'draw-new', ...fields })),
    });
    deps.Campaign.findByPk.mockImplementation(async (id) => ({ id, design_config: drawConfig({ activationId: null }) }));
    deps.Activation.findOne.mockImplementation(async ({ where }) => ({
      id: `act-${where.campaignId}`, campaignId: where.campaignId, unlockPolicy: 'agent_unlock', status: 'active',
    }));
    const results = await svc.sweepDrawRecords();
    expect(results).toMatchObject({ checked: 2, created: 1, failed: 1 });
  });
});
