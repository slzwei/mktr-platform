import '../setup.js';
import crypto from 'crypto';
import { verifyWebhook } from '../../src/services/hitpayClient.js';

/**
 * verifyWebhook is the inbound auth gate for HitPay settlements. LEGACY scheme: the
 * urlencoded webhook carries an `hmac` field = HMAC-SHA256 over the OTHER fields sorted
 * by key (concatenated key1value1key2value2…), keyed by HITPAY_WEBHOOK_SALT. Body is the
 * PARSED form (req.body). These vectors lock the implemented scheme.
 */
const SALT = 'test-webhook-salt';
function sign(fields, salt = SALT) {
  const concatenated = Object.keys(fields)
    .sort()
    .map((k) => `${k}${fields[k] ?? ''}`)
    .join('');
  return crypto.createHmac('sha256', salt).update(concatenated).digest('hex');
}
const req = (body) => ({ body });
const FIELDS = {
  reference_number: 'pay-1',
  payment_request_id: 'hp-req-1',
  payment_id: 'hp-pay-1',
  status: 'completed',
  amount: '200.00',
  currency: 'sgd',
};

describe('hitpayClient.verifyWebhook (legacy salt scheme)', () => {
  beforeEach(() => {
    process.env.HITPAY_WEBHOOK_SALT = SALT;
  });
  afterEach(() => {
    delete process.env.HITPAY_WEBHOOK_SALT;
  });

  test('valid hmac → returns the fields, without hmac', () => {
    const out = verifyWebhook(req({ ...FIELDS, hmac: sign(FIELDS) }));
    expect(out).toEqual(FIELDS);
    expect(out).not.toHaveProperty('hmac');
  });

  test('tampered field (same hmac) → null', () => {
    const hmac = sign(FIELDS);
    expect(verifyWebhook(req({ ...FIELDS, amount: '1.00', hmac }))).toBeNull();
  });

  test('hmac from a different salt → null', () => {
    expect(verifyWebhook(req({ ...FIELDS, hmac: sign(FIELDS, 'attacker-salt') }))).toBeNull();
  });

  test('missing salt config → null', () => {
    const hmac = sign(FIELDS);
    delete process.env.HITPAY_WEBHOOK_SALT;
    expect(verifyWebhook(req({ ...FIELDS, hmac }))).toBeNull();
  });

  test('no hmac field (unsigned) → null', () => {
    expect(verifyWebhook(req({ ...FIELDS }))).toBeNull();
  });

  test('missing / non-object body → null', () => {
    expect(verifyWebhook({ body: null })).toBeNull();
    expect(verifyWebhook({})).toBeNull();
    expect(verifyWebhook({ body: 'nope' })).toBeNull();
  });
});
