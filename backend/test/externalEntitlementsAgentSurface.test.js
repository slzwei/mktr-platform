/**
 * /api/external/entitlements agent surface — lookup + summary + unlock
 * enrichment (mktr-leads Gift Pass Scanner). Route logic only: models,
 * wiring, channel helpers, and the HMAC middleware are mocked (repo pattern —
 * see entitlementUnlockVia.test.js); tokens.js is REAL so kind detection runs
 * the same sha256 path as production.
 *
 * The invariants under test:
 *  - a wrong consultant gets a BARE 403 body (success/error/code, nothing
 *    else) from lookup and summary — zero holder identity;
 *  - kind: pass vs voucher is decided by WHICH hash matched (voucher-first
 *    mis-scan handling in the app depends on it);
 *  - presentState uses expiresAt <= now and never leaks tokenHint on expired;
 *  - summary's selection = manual unlock's (latest LIVE first, terminal only
 *    as fallback) and state:'none' when the prospect holds nothing;
 *  - unlock keeps the six legacy fields byte-compatible and only ADDS fields;
 *    waScheduled is capability+flag on fresh unlocks only, never on replay;
 *  - error → code mapping (route-local; AppError has no code facility).
 */
import { jest } from '@jest/globals';
import { Op } from 'sequelize';
import express from 'express';
import request from 'supertest';
import { hashToken } from '../src/services/redeemOps/tokens.js';

const unlockMock = jest.fn();
const userFindOne = jest.fn();
const entFindOne = jest.fn();
const entFindByPk = jest.fn();
const redemptionFindOne = jest.fn();

// Mutable channel-helper behavior (the helpers' own logic is covered where
// they live; here we test the route's gating/composition).
const channelState = { waEnabled: true, waCapable: true, emailCapable: true };

jest.unstable_mockModule('../src/services/redeemOps/entitlementWiring.js', () => ({
  makeWiredEntitlementService: () => ({ unlockEntitlement: unlockMock }),
}));
jest.unstable_mockModule('../src/models/index.js', () => ({
  User: { findOne: userFindOne },
  RewardEntitlement: { findOne: entFindOne, findByPk: entFindByPk },
  RewardOffer: {},
  Prospect: {},
  Activation: {},
  Campaign: {},
  Redemption: { findOne: redemptionFindOne },
}));
jest.unstable_mockModule('../src/services/redeemOps/fulfilmentNotify.js', () => ({
  canEmailProspect: () => channelState.emailCapable,
}));
jest.unstable_mockModule('../src/services/redeemOps/whatsappService.js', () => ({
  waEnabled: () => channelState.waEnabled,
  canWhatsAppProspect: () => channelState.waCapable,
}));
jest.unstable_mockModule('../src/controllers/externalBillingController.js', () => ({
  requireExternalHmac: (_req, _res, next) => next(),
}));

let router;
beforeAll(async () => {
  ({ default: router } = await import('../src/routes/externalEntitlements.js'));
});

const app = () => express().use(express.json()).use(router);

const AGENT = { id: 'agent-1', role: 'agent' };
const PASS_TOKEN = 'PassToken_1234567890abcdefBASE64urlSHAPED_43ch';
const VOUCHER_TOKEN = 'VoucherTok_1234567890abcdefBASE64urlSHAPE43';
const PROSPECT_ID = '11111111-2222-4333-8444-555555555555';
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

/** Entitlement row as the include-laden query would return it. */
function ent(overrides = {}) {
  return {
    id: 'ent-1',
    status: 'eligible',
    presentationTokenHash: hashToken(PASS_TOKEN),
    tokenHash: hashToken(VOUCHER_TOKEN),
    tokenHint: 'K7Q2',
    expiresAt: FUTURE,
    unlockedAt: null,
    unlockedByUserId: null,
    prospectId: PROSPECT_ID,
    rewardOffer: { title: 'FairPrice voucher', publicTitle: 'S$10 NTUC FairPrice e-voucher', fulfilmentMethod: 'evoucher' },
    prospect: {
      id: PROSPECT_ID,
      firstName: 'Jasmine',
      phone: '+6591234821',
      email: 'jasmine@example.com',
      sourceMetadata: { consent_contact: true },
      assignedAgentId: 'agent-1',
    },
    activation: { id: 'act-1', status: 'active', campaignNameSnapshot: 'Q3 Motor Switch (snapshot)', campaign: { name: 'Q3 Motor Switch' } },
    ...overrides,
  };
}

beforeEach(() => {
  channelState.waEnabled = true;
  channelState.waCapable = true;
  channelState.emailCapable = true;
  userFindOne.mockReset().mockResolvedValue(AGENT);
  entFindOne.mockReset().mockResolvedValue(null);
  entFindByPk.mockReset().mockResolvedValue(null);
  redemptionFindOne.mockReset().mockResolvedValue(null);
  unlockMock.mockReset();
});

describe('POST /lookup', () => {
  it('400s a malformed token without touching the models', async () => {
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: 'no' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_token');
    expect(entFindOne).not.toHaveBeenCalled();
  });

  it('404s an unknown agent with agent_not_found', async () => {
    userFindOne.mockResolvedValue(null);
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-x', token: PASS_TOKEN });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('agent_not_found');
  });

  it('404s an unresolvable token with not_found', async () => {
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('gives the WRONG consultant a bare 403 — no identity keys at all', async () => {
    entFindOne.mockResolvedValue(ent({ prospect: { ...ent().prospect, assignedAgentId: 'someone-else' } }));
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Only the assigned consultant can view this pass',
      code: 'not_assigned',
    });
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'success']);
  });

  it('403s when the prospect row is gone (lead deleted) for non-admins', async () => {
    entFindOne.mockResolvedValue(ent({ prospect: null }));
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_assigned');
  });

  it('resolves the PASS hash as kind:pass with the reserved payload', async () => {
    entFindOne.mockResolvedValue(ent());
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      kind: 'pass',
      state: 'reserved',
      rewardName: 'S$10 NTUC FairPrice e-voucher',
      holderFirstName: 'Jasmine',
      holderPhoneMasked: '+65 ···· 4821',
      campaignName: 'Q3 Motor Switch',
      paused: false,
      prospectId: PROSPECT_ID,
      channels: ['whatsapp', 'email'],
    });
    expect(res.body.tokenHint).toBeUndefined(); // reserved never reveals the hint
  });

  it('resolves the VOUCHER hash as kind:voucher (mis-scan card)', async () => {
    entFindOne.mockResolvedValue(ent({ status: 'issued', unlockedAt: PAST }));
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: VOUCHER_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('voucher');
    expect(res.body.state).toBe('unlocked');
    expect(res.body.tokenHint).toBe('K7Q2');
  });

  it('computes expired (expiresAt <= now) for an issued voucher and hides the hint', async () => {
    entFindOne.mockResolvedValue(ent({ status: 'issued', expiresAt: PAST }));
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.body.state).toBe('expired');
    expect(res.body.tokenHint).toBeUndefined();
  });

  it('keeps blocked as its own state and surfaces paused from the activation', async () => {
    entFindOne.mockResolvedValue(
      ent({ status: 'blocked', activation: { ...ent().activation, status: 'paused' } }),
    );
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.body.state).toBe('blocked');
    expect(res.body.paused).toBe(true);
  });

  it('drops whatsapp from channels when the feature flag is off', async () => {
    channelState.waEnabled = false;
    entFindOne.mockResolvedValue(ent());
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.body.channels).toEqual(['email']);
  });

  it('falls back to the campaign name snapshot when the campaign row is gone', async () => {
    entFindOne.mockResolvedValue(ent({ activation: { ...ent().activation, campaign: null } }));
    const res = await request(app()).post('/lookup').send({ agentMktrUserId: 'm-1', token: PASS_TOKEN });
    expect(res.body.campaignName).toBe('Q3 Motor Switch (snapshot)');
  });
});

describe('POST /summary', () => {
  it('400s a non-uuid prospectId', async () => {
    const res = await request(app()).post('/summary').send({ agentMktrUserId: 'm-1', prospectId: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns state:none when the prospect holds no entitlement', async () => {
    const res = await request(app()).post('/summary').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, state: 'none' });
  });

  it('queries the LIVE selection first (matches the manual-unlock target)', async () => {
    entFindOne.mockResolvedValueOnce(ent({ status: 'eligible' }));
    const res = await request(app()).post('/summary').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.body.state).toBe('reserved');
    expect(entFindOne).toHaveBeenCalledTimes(1);
    const firstWhere = entFindOne.mock.calls[0][0].where;
    expect(firstWhere.prospectId).toBe(PROSPECT_ID);
    expect(firstWhere.status[Op.in]).toEqual(['eligible', 'issued']); // live filter present
  });

  it('falls back to the latest terminal row so history still renders', async () => {
    entFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ent({ status: 'cancelled' }));
    const res = await request(app()).post('/summary').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.body.state).toBe('cancelled');
    expect(entFindOne).toHaveBeenCalledTimes(2);
  });

  it('joins redeemedAt from the redemptions row for redeemed state', async () => {
    entFindOne.mockResolvedValueOnce(ent({ status: 'redeemed', unlockedAt: PAST }));
    redemptionFindOne.mockResolvedValue({ redeemedAt: '2026-07-21T08:00:00.000Z' });
    const res = await request(app()).post('/summary').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.body.state).toBe('redeemed');
    expect(res.body.redeemedAt).toBe('2026-07-21T08:00:00.000Z');
    expect(redemptionFindOne).toHaveBeenCalledWith({ where: { entitlementId: 'ent-1' } });
  });

  it('gives a wrong consultant the bare 403 body', async () => {
    entFindOne.mockResolvedValueOnce(ent({ prospect: { ...ent().prospect, assignedAgentId: 'other' } }));
    const res = await request(app()).post('/summary').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'success']);
  });
});

describe('POST /unlock — enrichment + code mapping', () => {
  it('keeps the six legacy fields and adds the enrichment on a fresh unlock', async () => {
    unlockMock.mockResolvedValue({
      already: false,
      emailQueued: true,
      voucherToken: 'raw',
      entitlement: { id: 'ent-1', status: 'issued', tokenHint: 'K7Q2' },
    });
    entFindByPk.mockResolvedValue(ent({ status: 'issued', unlockedAt: FUTURE, unlockedByUserId: 'agent-1' }));
    const res = await request(app()).post('/unlock').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      already: false,
      emailQueued: true,
      entitlementId: 'ent-1',
      status: 'issued',
      tokenHint: 'K7Q2',
      rewardName: 'S$10 NTUC FairPrice e-voucher',
      holderFirstName: 'Jasmine',
      holderPhoneMasked: '+65 ···· 4821',
      campaignName: 'Q3 Motor Switch',
      channels: ['whatsapp', 'email'],
      prospectId: PROSPECT_ID,
      unlockedByYou: true,
      waScheduled: true,
    });
  });

  it('never claims waScheduled on replay', async () => {
    unlockMock.mockResolvedValue({
      already: true,
      emailQueued: false,
      voucherToken: null,
      entitlement: { id: 'ent-1', status: 'issued', tokenHint: 'K7Q2' },
    });
    entFindByPk.mockResolvedValue(ent({ status: 'issued', unlockedByUserId: 'agent-1' }));
    const res = await request(app()).post('/unlock').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.body.already).toBe(true);
    expect(res.body.waScheduled).toBe(false);
    expect(res.body.emailQueued).toBe(false);
  });

  it('still answers with the legacy shape when the re-read misses (row gone)', async () => {
    unlockMock.mockResolvedValue({
      already: false,
      emailQueued: false,
      voucherToken: 'raw',
      entitlement: { id: 'ent-1', status: 'issued', tokenHint: 'K7Q2' },
    });
    entFindByPk.mockResolvedValue(null);
    const res = await request(app()).post('/unlock').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.status).toBe(200);
    expect(res.body.entitlementId).toBe('ent-1');
    expect(res.body.rewardName).toBeUndefined();
  });

  it('404s an unknown agent with agent_not_found before the service runs', async () => {
    userFindOne.mockResolvedValue(null);
    const res = await request(app()).post('/unlock').send({ agentMktrUserId: 'm-x', prospectId: PROSPECT_ID });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('agent_not_found');
    expect(unlockMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'Only the assigned consultant can unlock this reward', 'not_assigned'],
    [404, 'Entitlement not found', 'not_found'],
    [409, 'Activation is paused — unlocks are temporarily disabled', 'paused'],
    [409, 'Entitlement is expired', 'expired'],
    [409, 'Entitlement is blocked', 'blocked'],
    [409, 'Entitlement is cancelled', 'cancelled'],
    [409, 'Activation is completed — this reward can no longer be unlocked', 'cancelled'],
    [409, 'Reservation expired, already unlocked, or its activation is no longer active', 'conflict'],
  ])('maps a %s "%s" service error to code %s', async (statusCode, message, code) => {
    unlockMock.mockRejectedValue(Object.assign(new Error(message), { statusCode }));
    const res = await request(app()).post('/unlock').send({ agentMktrUserId: 'm-1', prospectId: PROSPECT_ID });
    expect(res.status).toBe(statusCode);
    expect(res.body).toMatchObject({ success: false, error: message, code });
  });
});
