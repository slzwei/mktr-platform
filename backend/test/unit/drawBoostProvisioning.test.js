/**
 * drawBoostProvisioningService unit tests (PR-2, draw-launch-integrity §5.1;
 * redesign per Codex R1 CX9–CX12). Pure DI — fake sequelize records the
 * advisory lock, model mocks emulate the one-live-activation unique index,
 * inventory/audit are spies. Covers: kill switch, entitlements-off 422,
 * adopt/promote/conflict on existing rails, the fresh-provision chain
 * (partner → offer+committed → allocate → active activation → audit), orphan
 * offer adoption, the unique-race adopt, claim-window sizing, and the
 * top-up sweep's under-lock recheck.
 */
import { jest } from '@jest/globals';
import {
  makeDrawBoostProvisioningService,
  computeClaimExpiryDays,
  provisioningConfig,
} from '../../src/services/redeemOps/drawBoostProvisioningService.js';
import { sgtDayEndExclusiveMs } from '../../src/utils/sgtTime.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const CAMPAIGN = { id: 'c1', name: 'iPhone 17 Pro Lucky Draw', design_config: { luckyDraw: { enabled: true, closesAt: '2026-09-30', boostClosesAt: '2026-09-30' } } };
const USER = { id: 'u1', role: 'admin' };
const PARTNER = { id: 'hp1', legalName: 'MKTR PTE. LTD.' };

function fakeSequelize() {
  const tx = { commit: jest.fn(), rollback: jest.fn(), LOCK: { UPDATE: 'U' } };
  const calls = [];
  return {
    tx,
    calls,
    transaction: jest.fn(async (cb) => cb(tx)),
    query: jest.fn(async (sql, opts) => { calls.push({ sql, opts }); return [[]]; }),
  };
}

function deps(over = {}) {
  const seq = fakeSequelize();
  return {
    seq,
    d: {
      sequelize: seq,
      Activation: {
        findOne: jest.fn().mockResolvedValue(null),
        findByPk: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async (fields) => ({ id: 'act-new', ...fields, update: jest.fn() })),
      },
      RewardOffer: {
        findOne: jest.fn().mockResolvedValue(null),
        findByPk: jest.fn().mockResolvedValue({ id: 'off1', status: 'active' }),
        create: jest.fn().mockImplementation(async (fields) => ({ id: 'off-new', ...fields, update: jest.fn() })),
      },
      PartnerOrganisation: {
        findByPk: jest.fn().mockResolvedValue(null),
        findOne: jest.fn().mockResolvedValue(PARTNER),
      },
      inventory: {
        increaseCommitted: jest.fn().mockResolvedValue({}),
        allocate: jest.fn().mockResolvedValue({}),
      },
      audit: { recordAuditEvent: jest.fn().mockResolvedValue({}) },
      logger: silentLogger,
      now: () => Date.parse('2026-07-24T12:00:00Z'),
    },
  };
}

const ENV_KEYS = [
  'DRAW_BOOST_AUTOPROVISION_ENABLED', 'DRAW_BOOST_DEFAULT_ALLOCATION',
  'REDEEM_HOUSE_PARTNER_ORG_ID', 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
];
const envBackup = {};
beforeEach(() => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
  process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';
});
afterEach(() => {
  ENV_KEYS.forEach((k) => { if (envBackup[k] === undefined) delete process.env[k]; else process.env[k] = envBackup[k]; });
});

describe('provisioningConfig / computeClaimExpiryDays', () => {
  it('defaults: enabled, 10000 allocation (D1)', () => {
    const cfg = provisioningConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.defaultAllocation).toBe(10000);
  });

  it('claim window covers signup→boostClosesAt + 21d margin, clamped 30..400 (F7)', () => {
    const now = Date.parse('2026-07-24T12:00:00Z');
    const days = computeClaimExpiryDays({ boostClosesAt: '2026-09-30' }, now);
    const expected = Math.ceil((sgtDayEndExclusiveMs('2026-09-30') - now) / 86400000) + 21;
    expect(days).toBe(expected);
    expect(computeClaimExpiryDays({ boostClosesAt: '2026-07-25' }, now)).toBe(30); // floor
    expect(computeClaimExpiryDays({ boostClosesAt: '2028-07-25' }, now)).toBe(400); // ceiling
    expect(computeClaimExpiryDays({}, now)).toBe(90); // anchorless fallback
  });
});

describe('ensureDrawBoostRail — guards', () => {
  it('kill switch off → outcome disabled, nothing touched', async () => {
    process.env.DRAW_BOOST_AUTOPROVISION_ENABLED = 'false';
    const { d } = deps();
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });
    expect(out).toEqual({ activationId: null, outcome: 'disabled' });
    expect(d.sequelize.transaction).not.toHaveBeenCalled();
  });

  it('entitlement engine dark → typed 422 DRAW_BOOST_RAIL_UNAVAILABLE (armed promise would be undeliverable)', async () => {
    process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'false';
    const { d } = deps();
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER })).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_UNAVAILABLE' },
    });
  });
});

describe('ensureDrawBoostRail — existing rails', () => {
  it('ACTIVE agent_unlock rail with an active offer → adopted (advisory-locked, no writes)', async () => {
    const { d, seq } = deps();
    d.Activation.findOne.mockResolvedValue({ id: 'act1', status: 'active', unlockPolicy: 'agent_unlock', rewardOfferId: 'off1' });
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });
    expect(out).toEqual({ activationId: 'act1', outcome: 'adopted' });
    expect(seq.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(d.Activation.create).not.toHaveBeenCalled();
    expect(d.inventory.allocate).not.toHaveBeenCalled();
  });

  it('ACTIVE on_capture rail → 422 CONFLICT (its issuance never boosts; a second live row is index-forbidden)', async () => {
    const { d } = deps();
    d.Activation.findOne.mockResolvedValue({ id: 'act1', status: 'active', unlockPolicy: 'on_capture', rewardOfferId: 'off1' });
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER })).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_CONFLICT' },
    });
  });

  it('ACTIVE rail whose offer is paused → 422 CONFLICT (issuance would refuse)', async () => {
    const { d } = deps();
    d.Activation.findOne.mockResolvedValue({ id: 'act1', status: 'active', unlockPolicy: 'agent_unlock', rewardOfferId: 'off1' });
    d.RewardOffer.findByPk.mockResolvedValue({ id: 'off1', status: 'paused' });
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER })).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_CONFLICT' },
    });
  });

  it('PAUSED rail → 422 CONFLICT (operator intent is never auto-overridden)', async () => {
    const { d } = deps();
    d.Activation.findOne.mockResolvedValue({ id: 'act1', status: 'paused', unlockPolicy: 'agent_unlock', rewardOfferId: 'off1' });
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER })).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_CONFLICT' },
    });
  });

  it('PREPARING agent_unlock rail → promoted to active + audited', async () => {
    const { d } = deps();
    const update = jest.fn().mockResolvedValue({});
    d.Activation.findOne.mockResolvedValue({ id: 'act1', status: 'preparing', unlockPolicy: 'agent_unlock', rewardOfferId: 'off1', update });
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });
    expect(out).toEqual({ activationId: 'act1', outcome: 'promoted' });
    expect(update).toHaveBeenCalledWith({ status: 'active' }, expect.anything());
    expect(d.audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'draw_boost.rail_promoted' }));
  });
});

describe('ensureDrawBoostRail — fresh provisioning', () => {
  it('full chain: house partner → offer (internalRef marker, active, sized claim window) + committed → allocate → ACTIVE activation → audit', async () => {
    process.env.REDEEM_HOUSE_PARTNER_ORG_ID = 'hp1';
    const { d } = deps();
    d.PartnerOrganisation.findByPk.mockResolvedValue(PARTNER);
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });

    expect(out.outcome).toBe('provisioned');
    const offer = d.RewardOffer.create.mock.calls[0][0];
    expect(offer).toMatchObject({
      partnerOrganisationId: 'hp1',
      internalRef: 'draw-boost:c1',
      rewardType: 'free_service',
      fundingSource: 'mktr',
      status: 'active',
      createdBy: 'u1',
    });
    expect(offer.publicTitle).toBe('iPhone 17 Pro Lucky Draw Entry Pass');
    expect(offer.claimExpiryDays).toBeGreaterThanOrEqual(30);
    expect(d.inventory.increaseCommitted).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10000 }));
    expect(d.inventory.allocate).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10000 }));
    const act = d.Activation.create.mock.calls[0][0];
    expect(act).toMatchObject({
      campaignId: 'c1', unlockPolicy: 'agent_unlock', status: 'active',
      allocatedQuantity: 10000, campaignNameSnapshot: CAMPAIGN.name, createdBy: 'u1',
    });
    expect(d.audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'draw_boost.rail_provisioned' }));
  });

  it('orphan offer (marker exists from a failed attempt) → adopted, reactivated, only headroom topped up — never a duplicate offer', async () => {
    const { d } = deps();
    const update = jest.fn().mockResolvedValue({});
    d.RewardOffer.findOne.mockResolvedValue({
      id: 'off-orphan', status: 'draft', committedQuantity: 10000, allocatedQuantity: 4000, update,
    });
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });
    expect(out.outcome).toBe('provisioned');
    expect(d.RewardOffer.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ status: 'active' }, expect.anything());
    // headroom = 6000 → top up only the missing 4000, then allocate the block
    expect(d.inventory.increaseCommitted).toHaveBeenCalledWith(expect.objectContaining({ quantity: 4000 }));
    expect(d.inventory.allocate).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10000 }));
  });

  it('no house partner anywhere → 422 DRAW_BOOST_HOUSE_PARTNER_MISSING (never auto-creates a partner, CX9)', async () => {
    const { d } = deps();
    d.PartnerOrganisation.findOne.mockResolvedValue(null);
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER })).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_HOUSE_PARTNER_MISSING' },
    });
  });

  it('lost the cross-instance unique race → adopts the winner instead of failing', async () => {
    const { d } = deps();
    const err = Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' });
    d.Activation.create.mockRejectedValue(err);
    d.Activation.findOne
      .mockResolvedValueOnce(null) // initial probe under the lock
      .mockResolvedValueOnce({ id: 'act-winner', status: 'active', unlockPolicy: 'agent_unlock', rewardOfferId: 'off1' });
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });
    expect(out).toEqual({ activationId: 'act-winner', outcome: 'adopted' });
  });

  it('no acting user on a fresh provision → typed 422 (createdBy is NOT NULL)', async () => {
    const { d } = deps();
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: null })).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_UNAVAILABLE' },
    });
  });
});

describe('topUpDrawBoostAllocations', () => {
  it('under-threshold active rail → committed + allocated one default block, counter bumped, audited (system actor)', async () => {
    const { d, seq } = deps();
    seq.query
      .mockResolvedValueOnce([[{ id: 'act1' }]]) // scan
      .mockResolvedValue([[]]); // advisory lock etc.
    const update = jest.fn().mockResolvedValue({});
    d.Activation.findByPk.mockResolvedValue({
      id: 'act1', status: 'active', rewardOfferId: 'off1',
      allocatedQuantity: 10000, issuedCount: 9500, update,
    });
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.topUpDrawBoostAllocations();
    expect(out.toppedUp).toBe(1);
    expect(d.inventory.increaseCommitted).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10000, actorType: 'system' }));
    expect(d.inventory.allocate).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10000, activationId: 'act1' }));
    expect(update).toHaveBeenCalledWith({ allocatedQuantity: 20000 }, expect.anything());
    expect(d.audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'draw_boost.auto_top_up', actorType: 'system' }));
  });

  it('re-check under the lock: a concurrently-topped rail is skipped (cross-instance double-run guard, CX12)', async () => {
    const { d, seq } = deps();
    seq.query.mockResolvedValueOnce([[{ id: 'act1' }]]).mockResolvedValue([[]]);
    d.Activation.findByPk.mockResolvedValue({
      id: 'act1', status: 'active', rewardOfferId: 'off1',
      allocatedQuantity: 20000, issuedCount: 9500, // healthy again post-race
      update: jest.fn(),
    });
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.topUpDrawBoostAllocations();
    expect(out.toppedUp).toBe(0);
    expect(d.inventory.allocate).not.toHaveBeenCalled();
  });

  it('never throws — a scan failure logs and returns 0', async () => {
    const { d, seq } = deps();
    seq.query.mockRejectedValue(new Error('db down'));
    const svc = makeDrawBoostProvisioningService(d);
    await expect(svc.topUpDrawBoostAllocations()).resolves.toEqual({ toppedUp: 0 });
  });
});

describe('ensureDrawBoostRail — caller-transaction join (H1)', () => {
  it('joins the given transaction instead of opening its own; every write carries it', async () => {
    const { d, seq } = deps();
    const callerTx = { LOCK: { UPDATE: 'U' }, id: 'caller-tx' };
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER, transaction: callerTx });

    expect(out.outcome).toBe('provisioned');
    // The rail must commit WITH the caller's save, never in its own tx.
    expect(seq.transaction).not.toHaveBeenCalled();
    // Advisory lock + all writes ride the caller transaction.
    expect(seq.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(seq.calls[0].opts.transaction).toBe(callerTx);
    expect(d.Activation.create.mock.calls[0][1].transaction).toBe(callerTx);
    expect(d.RewardOffer.create.mock.calls[0][1].transaction).toBe(callerTx);
    expect(d.inventory.allocate).toHaveBeenCalledWith(expect.objectContaining({ transaction: callerTx }));
    expect(d.audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ transaction: callerTx }));
  });

  it('without a caller transaction, still opens its own (standalone contract unchanged)', async () => {
    const { d, seq } = deps();
    const svc = makeDrawBoostProvisioningService(d);
    const out = await svc.ensureDrawBoostRail({ campaign: CAMPAIGN, user: USER });
    expect(out.outcome).toBe('provisioned');
    expect(seq.transaction).toHaveBeenCalledTimes(1);
  });
});
