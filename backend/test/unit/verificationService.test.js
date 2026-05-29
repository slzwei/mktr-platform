import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models ──

const Campaign = { findByPk: jest.fn() };
const Verification = { upsert: jest.fn(), findByPk: jest.fn() };

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const snsClientSend = jest.fn();

// Set Meta WhatsApp env vars so sendWhatsAppOtpMeta doesn't throw credentials error
process.env.META_WA_PHONE_NUMBER_ID = 'test-phone-id';
process.env.META_WA_ACCESS_TOKEN = 'test-access-token';

jest.unstable_mockModule('../../src/models/index.js', () => ({ Campaign, Verification }));
jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({ AppError }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger }));
jest.unstable_mockModule('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: snsClientSend })),
  PublishCommand: jest.fn().mockImplementation((p) => p),
}));
jest.unstable_mockModule('node-fetch', () => ({
  default: jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [{ id: 'wa-msg-1' }] }),
  }),
}));

const { sendVerificationCode, checkVerificationCode } = await import('../../src/services/verificationService.js');
const fetchMock = (await import('node-fetch')).default;

// ── Tests ──

describe('verificationService (unit)', () => {
  let mockRecord;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRecord = {
      phone: '+6591234567',
      code: '123456',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      save: jest.fn().mockResolvedValue(true),
      destroy: jest.fn().mockResolvedValue(true),
    };

    Campaign.findByPk.mockResolvedValue({ id: 'camp-1', design_config: { otpChannel: 'sms' } });
    Verification.upsert.mockResolvedValue([mockRecord, true]);
    Verification.findByPk.mockResolvedValue(mockRecord);
    snsClientSend.mockResolvedValue({ MessageId: 'msg-1' });
  });

  // ── sendVerificationCode ──

  describe('sendVerificationCode', () => {
    it('sends SMS for default channel (+65)', async () => {
      const result = await sendVerificationCode({ phone: '91234567', countryCode: '+65' });

      expect(Verification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+6591234567', attempts: 0 })
      );
      expect(result.status).toBe('pending');
    });

    it('throws 400 when phone is missing', async () => {
      await expect(sendVerificationCode({ countryCode: '+65' }))
        .rejects.toThrow('Phone is required');
    });

    it('throws 400 for non-Singapore country code', async () => {
      await expect(sendVerificationCode({ phone: '1234567', countryCode: '+1' }))
        .rejects.toThrow('Only Singapore (+65) phone numbers are supported');
    });

    it('uses WhatsApp channel when campaign config says whatsapp', async () => {
      Campaign.findByPk.mockResolvedValue({ id: 'camp-1', design_config: { otpChannel: 'whatsapp' } });

      const result = await sendVerificationCode({ phone: '91234567', countryCode: '+65', campaignId: 'camp-1' });

      expect(result.status).toBe('pending');
      expect(logger.info).toHaveBeenCalledWith('Sending OTP', { channel: 'WHATSAPP' });
    });

    it('falls back to SMS when the WhatsApp send fails', async () => {
      Campaign.findByPk.mockResolvedValue({ id: 'camp-1', design_config: { otpChannel: 'whatsapp' } });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: { message: 'template auth_otp not found' } }),
      });

      const result = await sendVerificationCode({ phone: '91234567', countryCode: '+65', campaignId: 'camp-1' });

      expect(result.status).toBe('pending');
      expect(result.channel).toBe('sms');       // degraded whatsapp → sms
      expect(snsClientSend).toHaveBeenCalled();  // SMS actually dispatched
    });

    it('uses SMS channel when no campaignId is provided', async () => {
      const result = await sendVerificationCode({ phone: '91234567' });

      expect(result.status).toBe('pending');
      expect(logger.info).toHaveBeenCalledWith('Sending OTP', { channel: 'SMS' });
    });

    it('stores code with 10 minute expiry', async () => {
      await sendVerificationCode({ phone: '91234567' });

      const upsertArg = Verification.upsert.mock.calls[0][0];
      const expiresAt = new Date(upsertArg.expiresAt);
      const tenMinFromNow = Date.now() + 10 * 60 * 1000;
      expect(Math.abs(expiresAt.getTime() - tenMinFromNow)).toBeLessThan(5000);
    });
  });

  // ── checkVerificationCode ──

  describe('checkVerificationCode', () => {
    it('returns valid:true for correct code', async () => {
      const result = await checkVerificationCode({ phone: '91234567', code: '123456' });

      expect(result.valid).toBe(true);
      expect(result.status).toBe('approved');
      expect(mockRecord.destroy).toHaveBeenCalled();
    });

    it('returns not_found when no record exists', async () => {
      Verification.findByPk.mockResolvedValue(null);

      const result = await checkVerificationCode({ phone: '91234567', code: '123456' });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('returns expired when code has expired', async () => {
      mockRecord.expiresAt = new Date(Date.now() - 1000);

      const result = await checkVerificationCode({ phone: '91234567', code: '123456' });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
      expect(mockRecord.destroy).toHaveBeenCalled();
    });

    it('returns max_attempts after 5 failed attempts', async () => {
      mockRecord.attempts = 5;

      const result = await checkVerificationCode({ phone: '91234567', code: '123456' });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('max_attempts');
    });

    it('increments attempts on code mismatch', async () => {
      const result = await checkVerificationCode({ phone: '91234567', code: '000000' });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('mismatch');
      expect(mockRecord.attempts).toBe(1);
      expect(mockRecord.save).toHaveBeenCalled();
    });

    it('throws 400 when phone or code is missing', async () => {
      await expect(checkVerificationCode({ code: '123456' }))
        .rejects.toThrow('Phone and code are required');
      await expect(checkVerificationCode({ phone: '91234567' }))
        .rejects.toThrow('Phone and code are required');
    });
  });
});
