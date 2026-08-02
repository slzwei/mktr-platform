import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { makeWaWebhookService } from '../../src/services/redeemOps/waWebhookService.js';

/**
 * wa-delivery-truth §B — the Meta status webhook, DB-free (sequelize/Consumer/
 * applyUnsubscribe are DI fakes). Covers: signature verification, WABA/phone
 * binding, the rank-guarded inbox upsert call shape, error propagation
 * (Meta-retry contract), STOP normalization + the global-unsubscribe mapping,
 * and the route's auth posture (prod fail-closed without a secret).
 * Real rank arithmetic lives in SQL and is exercised against prod-shaped
 * Postgres by the migration; here we assert the statement carries the guard.
 */

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };
const SECRET = 'test-app-secret';

function sign(raw, secret = SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
}

function statusPayload(overrides = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1912683432731970',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '1202575549609564' },
          statuses: [{
            id: 'wamid.TEST1', status: 'failed', timestamp: '1785006378',
            recipient_id: '6580129432',
            errors: [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.' }],
          }],
          ...overrides.value,
        },
      }],
      ...overrides.entry,
    }],
    ...overrides.root,
  };
}

/**
 * The upsert is rank-guarded and now RETURNING wamid, so its result MEANS
 * something (P2-4): a row back = the status actually advanced; no row = a Meta
 * redelivery the guard turned into a no-op. The default fake advances.
 */
const advanced = (wamid = 'wamid.TEST1') => [[{ wamid }], {}];
const noOp = () => [[], {}];

function makeSvc(overrides = {}) {
  const query = jest.fn(async () => advanced());
  const svc = makeWaWebhookService({
    sequelize: { query },
    Consumer: { findOne: jest.fn(async () => null) },
    applyUnsubscribe: jest.fn(async () => ({ alreadySuppressed: false })),
    logger: silentLogger,
    ...overrides,
  });
  return { svc, query };
}


const ENV_KEYS = ['WHATSAPP_WABA_ID', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'NODE_ENV'];
let savedEnv;
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('verifySignature', () => {
  const { svc } = makeSvc();
  const raw = Buffer.from('{"a":1}');

  it('accepts the matching HMAC and rejects everything else', () => {
    expect(svc.verifySignature(raw, sign(raw), SECRET)).toBe(true);
    expect(svc.verifySignature(raw, sign(raw, 'other'), SECRET)).toBe(false);
    expect(svc.verifySignature(raw, 'sha256=zz', SECRET)).toBe(false);
    expect(svc.verifySignature(raw, undefined, SECRET)).toBe(false);
    expect(svc.verifySignature(undefined, sign(raw), SECRET)).toBe(false);
    expect(svc.verifySignature(raw, sign(raw), '')).toBe(false);
  });
});

describe('processPayload — statuses', () => {
  it('upserts a failed status with rank guard, error detail and recipient hash', async () => {
    const { svc, query } = makeSvc();
    const counts = await svc.processPayload(statusPayload());
    expect(counts.statuses).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, opts] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO wa_message_statuses');
    expect(sql).toContain('ON CONFLICT (wamid) DO UPDATE');
    // The monotonic guard: EXCLUDED rank must beat the stored rank.
    expect(sql).toMatch(/WHERE CASE EXCLUDED\.status[\s\S]*> CASE wa_message_statuses\.status/);
    expect(opts.replacements).toMatchObject({
      wamid: 'wamid.TEST1', status: 'failed', errorCode: '131049',
    });
    expect(opts.replacements.errorTitle).toMatch(/healthy ecosystem/);
    // sha256('+6580129432') — the consumers.phoneHash recipe.
    expect(opts.replacements.recipientHash)
      .toBe(crypto.createHash('sha256').update('+6580129432').digest('hex'));
    expect(opts.replacements.occurredAt).toEqual(new Date(1785006378 * 1000));
  });

  it('ignores unknown statuses and missing wamids without querying', async () => {
    const { svc, query } = makeSvc();
    const counts = await svc.processPayload(statusPayload({
      value: { statuses: [{ id: null, status: 'failed' }, { id: 'wamid.X', status: 'weird' }] },
    }));
    expect(counts.statuses).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('binds to our WABA and phone number id when the env pins them', async () => {
    process.env.WHATSAPP_WABA_ID = 'someone-elses-waba';
    const { svc, query } = makeSvc();
    const counts = await svc.processPayload(statusPayload());
    expect(counts.statuses).toBe(0);
    expect(counts.unmatchedForeign).toBe(1);
    expect(query).not.toHaveBeenCalled();

    process.env.WHATSAPP_WABA_ID = '1912683432731970';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'different-sender';
    const second = makeSvc();
    const counts2 = await second.svc.processPayload(statusPayload());
    expect(counts2.statuses).toBe(0);
    expect(counts2.unmatchedForeign).toBe(1);
    expect(second.query).not.toHaveBeenCalled();
  });

  it('propagates persistence failures (Meta retry is the durability)', async () => {
    const { svc } = makeSvc({ sequelize: { query: jest.fn(async () => { throw new Error('db down'); }) } });
    await expect(svc.processPayload(statusPayload())).rejects.toThrow('db down');
  });

  it('ignores non-whatsapp objects and malformed bodies', async () => {
    const { svc, query } = makeSvc();
    expect(await svc.processPayload(null)).toMatchObject({ statuses: 0 });
    expect(await svc.processPayload({ object: 'page', entry: [] })).toMatchObject({ statuses: 0 });
    expect(await svc.processPayload({ object: 'whatsapp_business_account', entry: 'nope' }))
      .toMatchObject({ statuses: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('processPayload — inbound STOP', () => {
  const stopMessage = (m) => statusPayload({
    value: { statuses: [], messages: [m] },
  });

  it.each([
    ['quick-reply button', { from: '6580129432', type: 'button', button: { text: 'Stop promotions', payload: 'Stop promotions' } }],
    ['typed STOP', { from: '6580129432', type: 'text', text: { body: ' STOP ' } }],
    ['typed unsubscribe', { from: '6580129432', type: 'text', text: { body: 'Unsubscribe' } }],
  ])('applies the global unsubscribe for %s', async (_label, message) => {
    const consumer = { id: 'c1' };
    const findOne = jest.fn(async () => consumer);
    const applyUnsubscribe = jest.fn(async () => ({ alreadySuppressed: false }));
    const { svc } = makeSvc({ Consumer: { findOne }, applyUnsubscribe });

    const counts = await svc.processPayload(stopMessage(message));
    expect(counts.stops).toBe(1);
    // Lookup by the normalized E.164 the spine stores.
    expect(findOne).toHaveBeenCalledWith({ where: { phone: '+6580129432' } });
    expect(applyUnsubscribe).toHaveBeenCalledWith(consumer, { source: 'wa_stop' });
  });

  it('ignores non-STOP chatter and unknown phones', async () => {
    const applyUnsubscribe = jest.fn();
    const { svc } = makeSvc({ applyUnsubscribe });
    const chat = await svc.processPayload(stopMessage({ from: '6580129432', type: 'text', text: { body: 'hello, when is the draw?' } }));
    expect(chat.stops).toBe(0);

    const unknown = await svc.processPayload(stopMessage({ from: '6599999999', type: 'text', text: { body: 'stop' } }));
    expect(unknown.stops).toBe(0);
    expect(applyUnsubscribe).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp/webhook route posture', () => {
  let app;
  beforeEach(async () => {
    const { default: router } = await import('../../src/routes/whatsappWebhook.js');
    app = express();
    // Mirror server_internal's raw-body capture for signature verification.
    app.use(express.json({
      verify: (req, _res, buf) => { req.rawBody = buf; },
    }));
    app.use('/api/whatsapp', router);
  });

  it('answers the Meta GET handshake only with the right verify token', async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'vt-1';
    const ok = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-1', 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');

    const bad = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });
    expect(bad.status).toBe(403);

    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const unset = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' });
    expect(unset.status).toBe(403);
  });

  it('fails closed in production without an app secret (200, nothing processed)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WHATSAPP_APP_SECRET;
    const res = await request(app).post('/api/whatsapp/webhook').send(statusPayload());
    expect(res.status).toBe(200); // Meta must not retry-storm an unconfigured endpoint
  });

  it('rejects a bad signature when the secret is set', async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const res = await request(app).post('/api/whatsapp/webhook')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(statusPayload());
    expect(res.status).toBe(401);
  });
});

/**
 * P2-4 — Meta redelivers. The rank-guarded upsert makes a repeat a no-op in
 * SQL, but upsertStatus used to return `true` unconditionally, so every retry
 * still counted as new: counts.statuses over-counted, and each redelivered
 * 'read' re-dirtied the lead and fired ANOTHER rescore. Under Meta's retry
 * schedule that is a rescore storm driven by an external party.
 */
describe('processPayload — redelivery idempotency (P2-4)', () => {
  const readPayload = () => statusPayload({
    value: {
      statuses: [{ id: 'wamid.READ1', status: 'read', timestamp: '1785006378', recipient_id: '6580129432' }],
    },
  });

  it('counts a read once and rescores once when the row advances', async () => {
    const onMessageRead = jest.fn(async () => 1);
    const { svc } = makeSvc({ onMessageRead });

    const counts = await svc.processPayload(readPayload());

    expect(counts.statuses).toBe(1);
    expect(counts.leadsDirtied).toBe(1);
    expect(onMessageRead).toHaveBeenCalledTimes(1);
  });

  it('does NOT rescore or count when the guard made it a no-op', async () => {
    const onMessageRead = jest.fn(async () => 1);
    const { svc } = makeSvc({ sequelize: { query: jest.fn(async () => noOp()) }, onMessageRead });

    const counts = await svc.processPayload(readPayload());

    expect(counts.statuses).toBe(0);
    expect(counts.leadsDirtied).toBe(0);
    expect(onMessageRead).not.toHaveBeenCalled();
  });

  it('rescores once across a first delivery and four redeliveries', async () => {
    const onMessageRead = jest.fn(async () => 1);
    // Meta's retry schedule: the same 'read' arrives five times; only the
    // first advances the row.
    const query = jest.fn()
      .mockResolvedValueOnce(advanced('wamid.READ1'))
      .mockResolvedValue(noOp());
    const { svc } = makeSvc({ sequelize: { query }, onMessageRead });

    let statuses = 0;
    let dirtied = 0;
    for (let i = 0; i < 5; i += 1) {
      const counts = await svc.processPayload(readPayload());
      statuses += counts.statuses;
      dirtied += counts.leadsDirtied;
    }

    expect(query).toHaveBeenCalledTimes(5); // the upsert still runs every time
    expect(statuses).toBe(1);
    expect(dirtied).toBe(1);
    expect(onMessageRead).toHaveBeenCalledTimes(1);
  });

  it('still persists — and still reports — a genuine status ADVANCE', async () => {
    // sent → delivered → read: three real transitions, three counted.
    const query = jest.fn(async () => advanced('wamid.SEQ1'));
    const { svc } = makeSvc({ sequelize: { query } });

    let statuses = 0;
    for (const status of ['sent', 'delivered', 'read']) {
      const counts = await svc.processPayload(statusPayload({
        value: { statuses: [{ id: 'wamid.SEQ1', status, timestamp: '1785006378', recipient_id: '6580129432' }] },
      }));
      statuses += counts.statuses;
    }

    expect(statuses).toBe(3);
  });
});
