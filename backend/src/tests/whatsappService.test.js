import { makeWhatsappService, canWhatsAppProspect, waRecipient } from '../services/redeemOps/whatsappService.js';

// Trial-reward PR E — template payload shape + gates, all DB-free (RewardOffer
// and fetch are DI fakes). The fan-out contract (email ≠ WhatsApp independence)
// lives in entitlementDeliveryFanout.test.js; this file covers the sender.

const ENV_KEYS = [
  'REDEEM_OPS_WHATSAPP_ENABLED', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TEMPLATE_PASS', 'WHATSAPP_TEMPLATE_VOUCHER', 'WHATSAPP_TEMPLATE_LANG',
];
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

const consented = { firstName: 'Sarah', phone: '+6591234567', sourceMetadata: { consent_contact: true } };
const entitlement = { id: 'e1', rewardOfferId: 'offer-1', expiresAt: new Date('2026-08-17T12:00:00+08:00') };
const offerFake = { findByPk: async () => ({ publicTitle: 'S$10 FairPrice voucher', title: 'FP10' }) };
const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };

function fetchRecorder(response = { ok: true, json: async () => ({}) }) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return response; };
  fn.calls = calls;
  return fn;
}

function enableWithCreds() {
  process.env.REDEEM_OPS_WHATSAPP_ENABLED = 'true';
  process.env.WHATSAPP_TOKEN = 'tok-123';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '555000111';
}

describe('waRecipient — Graph API recipient normalization', () => {
  it('prefixes 65 onto bare 8-digit SG mobiles', () => {
    expect(waRecipient('91234567')).toBe('6591234567');
    expect(waRecipient('81234567')).toBe('6581234567');
  });
  it('strips formatting from stored +65 numbers', () => {
    expect(waRecipient('+6591234567')).toBe('6591234567');
    expect(waRecipient('+65 9123 4567')).toBe('6591234567');
  });
  it('rejects garbage and too-short values', () => {
    expect(waRecipient('')).toBeNull();
    expect(waRecipient(null)).toBeNull();
    expect(waRecipient('12345')).toBeNull();
  });
});

describe('canWhatsAppProspect — capability + D2 safe-default consent gate', () => {
  it('true only with a WA-able phone AND consent_contact === true (D2 pending)', () => {
    expect(canWhatsAppProspect(consented)).toBe(true);
    expect(canWhatsAppProspect({ ...consented, sourceMetadata: {} })).toBe(false);
    expect(canWhatsAppProspect({ ...consented, sourceMetadata: { consent_contact: false } })).toBe(false);
    expect(canWhatsAppProspect({ firstName: 'S', sourceMetadata: { consent_contact: true } })).toBe(false);
    expect(canWhatsAppProspect(null)).toBe(false);
  });
});

describe('sendReservationWhatsApp / sendVoucherWhatsApp', () => {
  it('flag off → skipped, no network call', async () => {
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok' });
    expect(r).toEqual({ sent: false, skipped: 'disabled' });
    expect(fetch.calls.length).toBe(0);
  });

  it('flag on but no consent → skipped no_whatsapp, no network call', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendReservationWhatsApp({
      entitlement, prospect: { ...consented, sourceMetadata: {} }, presentationToken: 'ptok',
    });
    expect(r).toEqual({ sent: false, skipped: 'no_whatsapp' });
    expect(fetch.calls.length).toBe(0);
  });

  it('flag on but creds missing → error result (receipt-worthy), no network call', async () => {
    process.env.REDEEM_OPS_WHATSAPP_ENABLED = 'true';
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok' });
    expect(r.sent).toBe(false);
    expect(r.skipped).toBeUndefined();
    expect(r.error).toMatch(/not configured/);
    expect(fetch.calls.length).toBe(0);
  });

  it('reservation payload: template, lang, recipient, 3 body params, auth header', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok-raw' });
    expect(r.sent).toBe(true);
    expect(r.to).toBe('••••4567');
    expect(fetch.calls.length).toBe(1);
    const { url, opts, body } = fetch.calls[0];
    expect(url).toContain('/555000111/messages');
    expect(opts.headers.Authorization).toBe('Bearer tok-123');
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('6591234567');
    expect(body.template.name).toBe('reward_pass');
    expect(body.template.language.code).toBe('en');
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Sarah' },
          { type: 'text', text: 'S$10 FairPrice voucher' },
          { type: 'text', text: 'ptok-raw' },
        ],
      },
    ]);
  });

  it('voucher payload: 4 params with en-SG short-month expiry; env template name wins', async () => {
    enableWithCreds();
    process.env.WHATSAPP_TEMPLATE_VOUCHER = 'reward_voucher_v2';
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'vtok-raw' });
    expect(r.sent).toBe(true);
    const { body } = fetch.calls[0];
    expect(body.template.name).toBe('reward_voucher_v2');
    const params = body.template.components[0].parameters.map((p) => p.text);
    expect(params.length).toBe(4);
    expect(params[2]).toBe('vtok-raw');
    expect(params[3]).toBe('17 Aug 2026');
  });

  it('URL-ish first names never ride the template (falls back to "there")', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    await svc.sendReservationWhatsApp({
      entitlement,
      prospect: { ...consented, firstName: 'http://spam.example' },
      presentationToken: 'p',
    });
    expect(fetch.calls[0].body.template.components[0].parameters[0].text).toBe('there');
  });

  it('Graph API error → sent:false with the Meta error code, never a throw', async () => {
    enableWithCreds();
    const fetch = fetchRecorder({
      ok: false, status: 400,
      json: async () => ({ error: { code: 131026, message: 'undeliverable' } }),
    });
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'v' });
    expect(r.sent).toBe(false);
    expect(r.error).toContain('131026');
  });

  it('network failure → sent:false result, never a throw', async () => {
    enableWithCreds();
    const fetch = async () => { throw new Error('ECONNRESET'); };
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, logger: silentLogger });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'v' });
    expect(r).toMatchObject({ sent: false, error: 'ECONNRESET' });
  });

  it('reward name lookup failure degrades to "your reward", still sends', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeWhatsappService({
      RewardOffer: { findByPk: async () => { throw new Error('db down'); } },
      fetch, logger: silentLogger,
    });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'p' });
    expect(r.sent).toBe(true);
    expect(fetch.calls[0].body.template.components[0].parameters[1].text).toBe('your reward');
  });
});
