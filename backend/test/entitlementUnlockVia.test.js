/**
 * Server-derived unlockedVia on both consultant unlock routes
 * (docs/plans/lucky-draw-10x.md §4.4): only a presentation token counts as
 * scan evidence; a bare prospectId is ALWAYS the button path, regardless of
 * any client-sent `via`. Before this fix, {prospectId, via:'scan'} forged
 * scan evidence.
 *
 * entitlementService + models are mocked (unstable_mockModule, repo pattern);
 * the routers are exercised through supertest. The Lyfe route's inline HMAC is
 * satisfied with a genuinely signed request; the external route's shared
 * requireExternalHmac middleware is stubbed to pass (its own behaviour is
 * covered by the externalHeldLeadsController tests).
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const LYFE_SECRET = 'test-lyfe-outcome-secret';

const unlockMock = jest.fn();

// The routes consume the WIRED factory (entitlementWiring.js) since PR A —
// mocking the wiring here keeps the models mock minimal (the real wiring
// statically imports fulfilmentNotify, whose model imports the User-only
// mock below could not satisfy at ESM link time).
jest.unstable_mockModule('../src/services/redeemOps/entitlementWiring.js', () => ({
  makeWiredEntitlementService: () => ({ unlockEntitlement: unlockMock }),
}));
jest.unstable_mockModule('../src/models/index.js', () => ({
  User: { findOne: jest.fn().mockResolvedValue({ id: 'agent-1', role: 'agent' }) },
}));
jest.unstable_mockModule('../src/controllers/externalBillingController.js', () => ({
  requireExternalHmac: (_req, _res, next) => next(),
}));

let externalRouter, lyfeRouter;

beforeAll(async () => {
  ({ default: externalRouter } = await import('../src/routes/externalEntitlements.js'));
  ({ default: lyfeRouter } = await import('../src/routes/lyfeEntitlementUnlock.js'));
});

beforeEach(() => {
  process.env.LYFE_LEAD_OUTCOME_SECRET = LYFE_SECRET;
  unlockMock.mockReset().mockResolvedValue({
    already: false,
    entitlement: { id: 'ent-1', status: 'issued', tokenHint: 'ABCD' },
  });
});

function externalApp() {
  return express().use(express.json()).use(externalRouter);
}

function lyfeApp() {
  // Mirror server_internal.js: the prefix captures rawBody for the HMAC check.
  return express()
    .use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }))
    .use(lyfeRouter);
}

function lyfeSign(bodyString, timestamp) {
  const hex = crypto.createHmac('sha256', LYFE_SECRET).update(`${timestamp}.${bodyString}`).digest('hex');
  return `sha256=${hex}`;
}

describe('external (mktr-leads) unlock — server-derived via', () => {
  it('prospectId with a forged via:"scan" is recorded as agent_button', async () => {
    const res = await request(externalApp())
      .post('/unlock')
      .send({ agentMktrUserId: 'm-1', prospectId: 'pros-1', via: 'scan' });
    expect(res.status).toBe(200);
    expect(unlockMock).toHaveBeenCalledWith({ prospectId: 'pros-1' }, expect.anything(), 'agent_button');
  });

  it('presentationToken is recorded as agent_scan (client via ignored)', async () => {
    const res = await request(externalApp())
      .post('/unlock')
      .send({ agentMktrUserId: 'm-1', presentationToken: 'tok-1', via: 'button' });
    expect(res.status).toBe(200);
    expect(unlockMock).toHaveBeenCalledWith({ presentationToken: 'tok-1' }, expect.anything(), 'agent_scan');
  });

  it('still 400s without an identifier', async () => {
    const res = await request(externalApp()).post('/unlock').send({ agentMktrUserId: 'm-1' });
    expect(res.status).toBe(400);
    expect(unlockMock).not.toHaveBeenCalled();
  });
});

describe('lyfe unlock — server-derived via (through real HMAC)', () => {
  async function signedPost(body) {
    const bodyString = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    return request(lyfeApp())
      .post('/entitlement-unlock')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', timestamp)
      .set('x-webhook-signature', lyfeSign(bodyString, timestamp))
      .send(bodyString);
  }

  it('prospectId with a forged via:"scan" is recorded as agent_button', async () => {
    const res = await signedPost({ agentLyfeId: 'l-1', prospectId: 'pros-9', via: 'scan' });
    expect(res.status).toBe(200);
    expect(unlockMock).toHaveBeenCalledWith({ prospectId: 'pros-9' }, expect.anything(), 'agent_button');
  });

  it('presentationToken is recorded as agent_scan', async () => {
    const res = await signedPost({ agentLyfeId: 'l-1', presentationToken: 'tok-9' });
    expect(res.status).toBe(200);
    expect(unlockMock).toHaveBeenCalledWith({ presentationToken: 'tok-9' }, expect.anything(), 'agent_scan');
  });

  it('rejects a bad signature with 401', async () => {
    const bodyString = JSON.stringify({ agentLyfeId: 'l-1', prospectId: 'pros-9' });
    const res = await request(lyfeApp())
      .post('/entitlement-unlock')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', new Date().toISOString())
      .set('x-webhook-signature', 'sha256=deadbeef')
      .send(bodyString);
    expect(res.status).toBe(401);
    expect(unlockMock).not.toHaveBeenCalled();
  });

  it('a MISSING secret fails loud with 500 — never a 401 that reads as a bad signature (PR D)', async () => {
    delete process.env.LYFE_LEAD_OUTCOME_SECRET;
    const bodyString = JSON.stringify({ agentLyfeId: 'l-1', prospectId: 'pros-9' });
    const res = await request(lyfeApp())
      .post('/entitlement-unlock')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', new Date().toISOString())
      .set('x-webhook-signature', 'sha256=deadbeef')
      .send(bodyString);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Server misconfigured');
    expect(unlockMock).not.toHaveBeenCalled();
  });
});
