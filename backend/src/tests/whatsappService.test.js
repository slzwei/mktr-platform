import { makeWhatsappService, canWhatsAppProspect, waRecipient } from '../services/redeemOps/whatsappService.js';

// Trial-reward PR E — template payload shape + gates, all DB-free (RewardOffer,
// QRCode and fetch are DI fakes). The fan-out contract (email ≠ WhatsApp
// independence) lives in entitlementDeliveryFanout.test.js; this covers the
// sender: gate order, the QR-header media upload → template send sequence, and
// the WHATSAPP_QR_HEADER=false body-only shape.

const ENV_KEYS = [
  'REDEEM_OPS_WHATSAPP_ENABLED', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TEMPLATE_PASS', 'WHATSAPP_TEMPLATE_VOUCHER', 'WHATSAPP_TEMPLATE_LANG',
  'WHATSAPP_QR_HEADER', 'WHATSAPP_CLAIM_ORIGIN',
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

const uploadOk = { ok: true, json: async () => ({ id: 'MEDIA-1' }) };
const sendOk = { ok: true, json: async () => ({}) };

/** Sequenced fetch fake: responses served in order; FormData bodies kept raw. */
function fetchRecorder(responses = [uploadOk, sendOk]) {
  const calls = [];
  const fn = async (url, opts) => {
    const body = typeof opts?.body === 'string' ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, opts, body });
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  };
  fn.calls = calls;
  return fn;
}

function qrRecorder() {
  const contents = [];
  return {
    contents,
    toBuffer: async (content) => { contents.push(content); return Buffer.from('fake-png'); },
  };
}

/** DI fake for the Editorial card compositor — records payloads, returns a fake PNG. */
function cardRecorder() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); return Buffer.from('fake-card-png'); };
  fn.calls = calls;
  return fn;
}

function enableWithCreds() {
  process.env.REDEEM_OPS_WHATSAPP_ENABLED = 'true';
  process.env.WHATSAPP_TOKEN = 'tok-123';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '555000111';
}

function makeSvc({ fetch, qr = qrRecorder(), card = cardRecorder(), RewardOffer = offerFake } = {}) {
  return makeWhatsappService({ RewardOffer, fetch, QRCode: qr, renderQrCard: card, logger: silentLogger });
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

describe('gates fire before any network call', () => {
  it('flag off → skipped, no fetch', async () => {
    const fetch = fetchRecorder();
    const svc = makeSvc({ fetch });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok' });
    expect(r).toEqual({ sent: false, skipped: 'disabled' });
    expect(fetch.calls.length).toBe(0);
  });

  it('flag on but no consent → skipped no_whatsapp, no fetch', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeSvc({ fetch });
    const r = await svc.sendReservationWhatsApp({
      entitlement, prospect: { ...consented, sourceMetadata: {} }, presentationToken: 'ptok',
    });
    expect(r).toEqual({ sent: false, skipped: 'no_whatsapp' });
    expect(fetch.calls.length).toBe(0);
  });

  it('flag on but creds missing → error result (receipt-worthy), no fetch', async () => {
    process.env.REDEEM_OPS_WHATSAPP_ENABLED = 'true';
    const fetch = fetchRecorder();
    const svc = makeSvc({ fetch });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok' });
    expect(r.sent).toBe(false);
    expect(r.skipped).toBeUndefined();
    expect(r.error).toMatch(/not configured/);
    expect(fetch.calls.length).toBe(0);
  });
});

describe('QR-header send sequence (default: header ON)', () => {
  it('reservation: renders the pass card, uploads it, then sends header+body; QR encodes the claim link', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const qr = qrRecorder();
    const card = cardRecorder();
    const svc = makeSvc({ fetch, qr, card });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok-raw' });
    expect(r).toEqual({ sent: true, to: '••••4567' });
    expect(card.calls.length).toBe(1);
    expect(card.calls[0]).toMatchObject({
      state: 'pass',
      qrContent: 'https://redeem.sg/r/ptok-raw',
      rewardName: 'S$10 FairPrice voucher',
      customerFirstName: 'Sarah',
      wordmark: 'Redeem.',
    });
    expect(qr.contents).toEqual([]); // card render succeeded → no bare-QR fallback
    expect(fetch.calls.length).toBe(2);

    const upload = fetch.calls[0];
    expect(upload.url).toContain('/555000111/media');
    expect(upload.opts.headers.Authorization).toBe('Bearer tok-123');
    expect(upload.body).toBeInstanceOf(FormData);

    const send = fetch.calls[1];
    expect(send.url).toContain('/555000111/messages');
    expect(send.body.to).toBe('6591234567');
    expect(send.body.template.name).toBe('reward_pass');
    expect(send.body.template.language.code).toBe('en');
    expect(send.body.template.components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: 'MEDIA-1' } }],
    });
    expect(send.body.template.components[1]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Sarah' },
        { type: 'text', text: 'S$10 FairPrice voucher' },
        { type: 'text', text: 'ptok-raw' },
      ],
    });
  });

  it('voucher: QR encodes the RAW token; 4 body params with en-SG expiry; env template name wins', async () => {
    enableWithCreds();
    process.env.WHATSAPP_TEMPLATE_VOUCHER = 'reward_voucher_v2';
    const fetch = fetchRecorder();
    const card = cardRecorder();
    const svc = makeSvc({ fetch, card });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'vtok-raw' });
    expect(r.sent).toBe(true);
    expect(card.calls[0]).toMatchObject({
      state: 'voucher',
      qrContent: 'vtok-raw',
      shortCode: '-RAW', // no tokenHint on the fake entitlement → last-4 fallback
    });
    const send = fetch.calls[1];
    expect(send.body.template.name).toBe('reward_voucher_v2');
    const params = send.body.template.components[1].parameters.map((p) => p.text);
    expect(params.length).toBe(4);
    expect(params[2]).toBe('vtok-raw');
    expect(params[3]).toBe('17 Aug 2026');
  });

  it('WHATSAPP_CLAIM_ORIGIN overrides the pass-QR host (and the card wordmark follows)', async () => {
    enableWithCreds();
    process.env.WHATSAPP_CLAIM_ORIGIN = 'https://mktr.sg';
    const card = cardRecorder();
    const svc = makeSvc({ fetch: fetchRecorder(), card });
    await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'p' });
    expect(card.calls[0]).toMatchObject({ qrContent: 'https://mktr.sg/r/p', wordmark: 'MKTR.' });
  });

  it('card renderer failure falls back to the bare QR PNG and still sends', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const qr = qrRecorder();
    const card = async () => { throw new Error('resvg exploded'); };
    const svc = makeSvc({ fetch, qr, card });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'ptok-raw' });
    expect(r).toEqual({ sent: true, to: '••••4567' });
    expect(qr.contents).toEqual(['https://redeem.sg/r/ptok-raw']); // bare QR took over
    expect(fetch.calls.length).toBe(2); // upload + send still happened
  });

  it('media upload failure → sent:false, message send never attempted (no body-only fallback)', async () => {
    enableWithCreds();
    const fetch = fetchRecorder([{ ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'bad media' } }) }]);
    const svc = makeSvc({ fetch });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'v' });
    expect(r.sent).toBe(false);
    expect(r.error).toMatch(/media upload failed/);
    expect(fetch.calls.length).toBe(1);
  });
});

describe('WHATSAPP_QR_HEADER=false — body-only template shape', () => {
  it('sends a single call with no header component', async () => {
    enableWithCreds();
    process.env.WHATSAPP_QR_HEADER = 'false';
    const fetch = fetchRecorder([sendOk]);
    const qr = qrRecorder();
    const card = cardRecorder();
    const svc = makeSvc({ fetch, qr, card });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'p' });
    expect(r.sent).toBe(true);
    expect(qr.contents.length).toBe(0);
    expect(card.calls.length).toBe(0);
    expect(fetch.calls.length).toBe(1);
    expect(fetch.calls[0].url).toContain('/messages');
    expect(fetch.calls[0].body.template.components.length).toBe(1);
    expect(fetch.calls[0].body.template.components[0].type).toBe('body');
  });
});

describe('failure normalization — never throws', () => {
  it('Graph send error → sent:false with the Meta error code', async () => {
    enableWithCreds();
    const fetch = fetchRecorder([uploadOk, { ok: false, status: 400, json: async () => ({ error: { code: 131026, message: 'undeliverable' } }) }]);
    const svc = makeSvc({ fetch });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'v' });
    expect(r.sent).toBe(false);
    expect(r.error).toContain('131026');
  });

  it('network failure → sent:false result', async () => {
    enableWithCreds();
    const fetch = async () => { throw new Error('ECONNRESET'); };
    const svc = makeWhatsappService({ RewardOffer: offerFake, fetch, QRCode: qrRecorder(), logger: silentLogger });
    const r = await svc.sendVoucherWhatsApp({ entitlement, prospect: consented, voucherToken: 'v' });
    expect(r).toMatchObject({ sent: false, error: 'ECONNRESET' });
  });

  it('URL-ish first names never ride the template (falls back to "there")', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeSvc({ fetch });
    await svc.sendReservationWhatsApp({
      entitlement,
      prospect: { ...consented, firstName: 'http://spam.example' },
      presentationToken: 'p',
    });
    expect(fetch.calls[1].body.template.components[1].parameters[0].text).toBe('there');
  });

  it('reward name lookup failure degrades to "your reward", still sends', async () => {
    enableWithCreds();
    const fetch = fetchRecorder();
    const svc = makeSvc({ fetch, RewardOffer: { findByPk: async () => { throw new Error('db down'); } } });
    const r = await svc.sendReservationWhatsApp({ entitlement, prospect: consented, presentationToken: 'p' });
    expect(r.sent).toBe(true);
    expect(fetch.calls[1].body.template.components[1].parameters[1].text).toBe('your reward');
  });
});
