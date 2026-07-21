import { jest } from '@jest/globals';
import '../setup.js';

// ── Mocks ──
// rateCounter is the Postgres boundary; mocking it keeps this suite DB-free and
// lets us drive exact counts per key.

const bump = jest.fn();
const unbump = jest.fn();
// Stands in for the real HMAC and must be OPAQUE — a stub that echoed the number
// back would make the "no PII in the key" assertion below test the stub instead of
// the key construction. blindPhone's own non-reversibility is covered in
// rateCounter.test.js.
const blindPhone = jest.fn(() => 'BLINDED0000000000000000000000000');
const sgtDayKey = jest.fn(() => '2026-07-21');
const nextSgtMidnight = jest.fn(() => new Date('2026-07-21T16:00:00.000Z'));

jest.unstable_mockModule('../../src/services/rateCounter.js', () => ({
  bump, unbump, blindPhone, sgtDayKey, nextSgtMidnight,
}));

const sendEmail = jest.fn().mockResolvedValue(true);
jest.unstable_mockModule('../../src/services/mailer.js', () => ({ sendEmail }));

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger }));

const {
  reservePhoneOtpQuota,
  reserveGlobalSmsQuota,
  perPhoneCap,
  globalCap,
  alertThreshold,
} = await import('../../src/services/smsQuota.js');

/** Drive bump() per key family: global count, alert-claim count. */
const withCounts = ({ global: g = 1, claim = 1, phone = 1 } = {}) => {
  bump.mockImplementation(async (key) => {
    const expiresAt = new Date('2026-07-21T16:00:00.000Z');
    if (key.startsWith('sms:global:')) return { count: g, expiresAt };
    if (key.startsWith('sms:alert:')) return { count: claim, expiresAt };
    return { count: phone, expiresAt };
  });
};

describe('smsQuota (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SMS_DAILY_CAP_PER_PHONE;
    delete process.env.SMS_DAILY_GLOBAL_CAP;
    delete process.env.SMS_DAILY_ALERT_THRESHOLD;
    delete process.env.SMS_ALERT_EMAIL;
    withCounts();
  });

  describe('defaults', () => {
    it('ships the agreed caps', () => {
      expect(perPhoneCap()).toBe(7);
      expect(globalCap()).toBe(500);
      expect(alertThreshold()).toBe(250);
    });

    it('honours env overrides and ignores junk', () => {
      process.env.SMS_DAILY_CAP_PER_PHONE = '3';
      expect(perPhoneCap()).toBe(3);

      process.env.SMS_DAILY_CAP_PER_PHONE = 'not-a-number';
      expect(perPhoneCap()).toBe(7); // falls back rather than becoming NaN/0

      process.env.SMS_DAILY_CAP_PER_PHONE = '0';
      expect(perPhoneCap()).toBe(7); // 0 would block every send — treated as unset
    });
  });

  describe('per-phone daily cap', () => {
    it('allows the 7th send of the day', async () => {
      withCounts({ phone: 7 });
      await expect(reservePhoneOtpQuota('+6591234567')).resolves.toMatchObject({ ok: true, cap: 7 });
    });

    it('refuses the 8th', async () => {
      withCounts({ phone: 8 });
      await expect(reservePhoneOtpQuota('+6591234567')).resolves.toMatchObject({ ok: false, count: 8 });
    });

    it('keys on the blinded number, never the raw one', async () => {
      await reservePhoneOtpQuota('+6591234567');

      expect(blindPhone).toHaveBeenCalledWith('+6591234567');
      const [key] = bump.mock.calls[0];
      expect(key).toContain('BLINDED');      // built from the blinded token…
      expect(key).not.toContain('91234567'); // …never the raw number
      expect(key).toContain('2026-07-21');   // scoped to the SG day
    });
  });

  describe('global daily ceiling', () => {
    it('permits sends below the ceiling', async () => {
      withCounts({ global: 100 });
      await expect(reserveGlobalSmsQuota()).resolves.toMatchObject({ ok: true, cap: 500 });
    });

    it('refuses once the ceiling is passed', async () => {
      withCounts({ global: 501 });
      await expect(reserveGlobalSmsQuota()).resolves.toMatchObject({ ok: false });
    });
  });

  describe('volume alerting', () => {
    it('emails a spike warning the first time the threshold is crossed', async () => {
      process.env.SMS_ALERT_EMAIL = 'ops@example.com';
      withCounts({ global: 250, claim: 1 });

      await reserveGlobalSmsQuota();

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [{ to, subject, text }] = sendEmail.mock.calls[0];
      expect(to).toBe('ops@example.com');
      expect(subject).toMatch(/spike/i);
      expect(text).toContain('250');
    });

    it('stays silent for the rest of the day once claimed', async () => {
      process.env.SMS_ALERT_EMAIL = 'ops@example.com';
      withCounts({ global: 260, claim: 2 }); // claim !== 1 → someone already alerted

      await reserveGlobalSmsQuota();

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('escalates differently when the hard ceiling is hit', async () => {
      process.env.SMS_ALERT_EMAIL = 'ops@example.com';
      withCounts({ global: 501, claim: 1 });

      const result = await reserveGlobalSmsQuota();

      expect(result.ok).toBe(false);
      const [{ subject, text }] = sendEmail.mock.calls[0];
      expect(subject).toMatch(/CEILING/);
      expect(text).toMatch(/REFUSED/);
    });

    it('logs but sends no email when no alert address is configured', async () => {
      withCounts({ global: 300, claim: 1 });

      await reserveGlobalSmsQuota();

      expect(sendEmail).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'spike' }),
        'sms_quota.alert',
      );
    });

    it('never lets an alert failure break the send path', async () => {
      process.env.SMS_ALERT_EMAIL = 'ops@example.com';
      withCounts({ global: 300, claim: 1 });
      sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(reserveGlobalSmsQuota()).resolves.toMatchObject({ ok: true });
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
