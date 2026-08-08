import { jest } from '@jest/globals';
import crypto from 'crypto';
import '../setup.js';
import { verifyWebhook, handleWebhook, oauthCallback } from '../../src/controllers/metaController.js';
import { armMetaLeadAds, disarmMetaLeadAdsForTests } from '../../src/services/metaLeadService.js';
import { disarmMetaOauthForTests } from '../../src/services/metaConnectService.js';

const SECRET = 'meta-app-secret-under-test';

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (payload) { this.body = payload; return this; }),
    send: jest.fn(function (payload) { this.body = payload; return this; }),
    sendStatus: jest.fn(function (code) { this.statusCode = code; return this; }),
  };
  return res;
}

function signedReq(payload, { secret = SECRET, tamper = false } = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return {
    rawBody: tamper ? Buffer.concat([raw, Buffer.from(' ')]) : raw,
    body: payload,
    ip: '127.0.0.1',
    get: (h) => (h.toLowerCase() === 'x-hub-signature-256' ? sig : undefined),
  };
}

describe('metaController (unit)', () => {
  const envBackup = {};
  beforeEach(() => {
    for (const k of ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'NODE_ENV']) envBackup[k] = process.env[k];
    process.env.META_APP_SECRET = SECRET;
    process.env.META_VERIFY_TOKEN = 'verify-phrase';
    armMetaLeadAds();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  describe('GET /webhook (hub.challenge handshake)', () => {
    it('echoes the challenge on a correct subscribe + token', () => {
      const res = mockRes();
      verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-phrase', 'hub.challenge': '12345' } }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('12345');
    });

    it('403s on wrong token, wrong mode, or unconfigured verify token', () => {
      for (const query of [
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' },
        { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-phrase', 'hub.challenge': 'x' },
      ]) {
        const res = mockRes();
        verifyWebhook({ query }, res);
        expect(res.sendStatus).toHaveBeenCalledWith(403);
      }
      delete process.env.META_VERIFY_TOKEN;
      const res = mockRes();
      verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'x' } }, res);
      expect(res.sendStatus).toHaveBeenCalledWith(403);
    });
  });

  describe('POST /webhook (signature gate)', () => {
    it('production with no META_APP_SECRET refuses with 503 (Meta redelivers) — never an acknowledged drop', async () => {
      delete process.env.META_APP_SECRET;
      process.env.NODE_ENV = 'production';
      const res = mockRes();
      await handleWebhook(signedReq({ object: 'page' }), res);
      expect(res.sendStatus).toHaveBeenCalledWith(503);
    });

    it('401s a tampered body (signature mismatch) before any processing', async () => {
      const res = mockRes();
      await handleWebhook(signedReq({ object: 'page', entry: [] }, { tamper: true }), res);
      expect(res.sendStatus).toHaveBeenCalledWith(401);
    });

    it('401s a body signed with the wrong secret', async () => {
      const res = mockRes();
      await handleWebhook(signedReq({ object: 'page', entry: [] }, { secret: 'not-the-secret' }), res);
      expect(res.sendStatus).toHaveBeenCalledWith(401);
    });

    it('ignores non-page objects with a 200 (no inbox work)', async () => {
      const res = mockRes();
      await handleWebhook(signedReq({ object: 'user', entry: [] }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, status: 'ignored' });
    });

    it('refuses intake with 503 when bootstrap never armed the subsystem — even for validly signed payloads', async () => {
      disarmMetaLeadAdsForTests();
      const res = mockRes();
      await handleWebhook(signedReq({ object: 'page', entry: [] }), res);
      expect(res.sendStatus).toHaveBeenCalledWith(503);
    });
  });

  describe('GET /oauth/callback (armed latch, round-2 #7)', () => {
    it('an unarmed OAuth subsystem answers 503, never an acknowledged redirect', async () => {
      process.env.META_OAUTH_ENABLED = 'true';
      disarmMetaOauthForTests();
      const res = mockRes();
      await oauthCallback({ query: { code: 'c', state: 's' } }, res);
      expect(res.sendStatus).toHaveBeenCalledWith(503);
      delete process.env.META_OAUTH_ENABLED;
    });
  });
});
