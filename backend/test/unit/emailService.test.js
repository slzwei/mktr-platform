import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock dependencies ──

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
const mockCreateTransport = jest.fn().mockReturnValue({ sendMail: mockSendMail });

jest.unstable_mockModule('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { sendEmail, sendLeadAssignmentEmail, sendPackageAssignmentEmail } = await import('../../src/services/mailer.js');
const { logger } = await import('../../src/utils/logger.js');

// ── Tests ──

describe('emailService (unit)', () => {
  const savedEnv = {};

  beforeEach(() => {
    jest.clearAllMocks();
    // Save and set email env vars
    savedEnv.EMAIL_HOST = process.env.EMAIL_HOST;
    savedEnv.EMAIL_PORT = process.env.EMAIL_PORT;
    savedEnv.EMAIL_USER = process.env.EMAIL_USER;
    savedEnv.EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
    savedEnv.EMAIL_FROM = process.env.EMAIL_FROM;
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  // ────────────────────────────────────────────────
  // sendEmail
  // ────────────────────────────────────────────────

  describe('sendEmail', () => {
    it('returns fallback result when mailer is not configured', async () => {
      delete process.env.EMAIL_HOST;
      delete process.env.EMAIL_PORT;
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASSWORD;

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
    });

    it('logs email details in dev fallback mode', async () => {
      delete process.env.EMAIL_HOST;

      await sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Content</p>',
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Email not sent'),
        expect.objectContaining({ to: 'test@example.com', subject: 'Test Subject' })
      );
    });
  });

  // ────────────────────────────────────────────────
  // sendLeadAssignmentEmail
  // ────────────────────────────────────────────────

  describe('sendLeadAssignmentEmail', () => {
    it('throws when agent is null', async () => {
      await expect(sendLeadAssignmentEmail(null, { firstName: 'Test', lastName: 'Lead' }))
        .rejects.toThrow('Agent object is required');
    });

    it('throws when agent has no email', async () => {
      await expect(sendLeadAssignmentEmail({ id: 'agent-1' }, { firstName: 'Test', lastName: 'Lead' }))
        .rejects.toThrow('has no email address');
    });

    it('uses bulk subject when isBulk is true', async () => {
      delete process.env.EMAIL_HOST; // force dev fallback

      await sendLeadAssignmentEmail(
        { id: 'agent-1', email: 'agent@test.com', firstName: 'Agent' },
        {},
        true,
        5
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          subject: expect.stringContaining('5 new leads'),
        })
      );
    });

    it('uses single lead subject when not bulk', async () => {
      delete process.env.EMAIL_HOST;

      await sendLeadAssignmentEmail(
        { id: 'agent-1', email: 'agent@test.com', firstName: 'Agent' },
        { firstName: 'Jane', lastName: 'Doe', createdAt: new Date() },
        false
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          subject: expect.stringContaining('Jane Doe'),
        })
      );
    });

    it('redirects system agent email to admin', async () => {
      delete process.env.EMAIL_HOST;

      await sendLeadAssignmentEmail(
        { id: 'sys-1', email: 'system@mktr.local', firstName: 'System', lastName: 'Agent' },
        { firstName: 'Test', lastName: 'Lead', createdAt: new Date() }
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('redirecting'),
        expect.anything()
      );
    });
  });

  // ────────────────────────────────────────────────
  // sendLeadAssignmentEmail edge cases
  // ────────────────────────────────────────────────

  describe('sendLeadAssignmentEmail (edge cases)', () => {
    it('handles prospect with campaign object', async () => {
      delete process.env.EMAIL_HOST;

      await sendLeadAssignmentEmail(
        { id: 'agent-1', email: 'agent@test.com', firstName: 'Alice' },
        {
          firstName: 'Bob',
          lastName: 'Smith',
          createdAt: new Date(),
          campaign: { name: 'Gold Campaign', id: 'camp-1' },
        }
      );

      // Should not throw
      expect(logger.info).toHaveBeenCalled();
    });

    it('handles prospect without campaign', async () => {
      delete process.env.EMAIL_HOST;

      await sendLeadAssignmentEmail(
        { id: 'agent-1', email: 'agent@test.com', firstName: 'Alice' },
        { firstName: 'Bob', lastName: 'Smith', createdAt: new Date() }
      );

      expect(logger.info).toHaveBeenCalled();
    });

    it('handles prospect with missing email/phone', async () => {
      delete process.env.EMAIL_HOST;

      await sendLeadAssignmentEmail(
        { id: 'agent-1', email: 'agent@test.com', firstName: 'Alice' },
        { firstName: 'Bob', lastName: 'Smith', createdAt: new Date(), email: null, phone: null }
      );

      expect(logger.info).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // sendPackageAssignmentEmail
  // ────────────────────────────────────────────────

  describe('sendPackageAssignmentEmail', () => {
    it('returns failure when agent has no email', async () => {
      const result = await sendPackageAssignmentEmail(null, { name: 'Gold' });

      expect(result.success).toBe(false);
    });

    it('sends email with package details', async () => {
      delete process.env.EMAIL_HOST;

      const result = await sendPackageAssignmentEmail(
        { id: 'agent-1', email: 'agent@test.com', firstName: 'Alice' },
        { name: 'Gold Package', campaignName: 'Test Campaign', leadCount: 50 }
      );

      expect(result).toBeDefined();
    });
  });
});
