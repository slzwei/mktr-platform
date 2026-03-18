import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models ──

const User = { findOne: jest.fn(), create: jest.fn() };
const sendEmail = jest.fn();

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule('../../src/models/index.js', () => ({ User }));
jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({ AppError }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger }));
jest.unstable_mockModule('../../src/services/mailer.js', () => ({ sendEmail }));
jest.unstable_mockModule('uuid', () => ({ v4: jest.fn().mockReturnValue('mock-uuid') }));

const { sendRoleInvitation } = await import('../../src/services/invitationService.js');

// ── Tests ──

describe('invitationService (unit)', () => {
  let mockUser, getEmailContent;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUser = {
      id: 'user-1',
      email: 'invitee@test.com',
      firstName: 'New',
      lastName: 'Agent',
      role: 'agent',
    };

    getEmailContent = jest.fn().mockReturnValue({
      subject: 'You are invited',
      html: '<p>Welcome</p>',
      text: 'Welcome',
    });

    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue(mockUser);
    sendEmail.mockResolvedValue(true);
  });

  it('creates user and returns invite link on success', async () => {
    const result = await sendRoleInvitation({
      email: 'invitee@test.com',
      fullName: 'New Agent',
      role: 'agent',
      inviterEmail: 'admin@test.com',
      getEmailContent,
    });

    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invitee@test.com',
        firstName: 'New',
        lastName: 'Agent',
        role: 'agent',
        isActive: true,
        emailVerified: false,
      })
    );
    expect(result.user).toBeDefined();
    expect(result.inviteLink).toContain('token=mock-uuid');
  });

  it('throws 400 when email is missing', async () => {
    await expect(sendRoleInvitation({
      fullName: 'Test',
      role: 'agent',
      getEmailContent,
    })).rejects.toThrow('email and full_name are required');
  });

  it('throws 400 when fullName is missing', async () => {
    await expect(sendRoleInvitation({
      email: 'test@test.com',
      role: 'agent',
      getEmailContent,
    })).rejects.toThrow('email and full_name are required');
  });

  it('prevents self-invite (case insensitive)', async () => {
    await expect(sendRoleInvitation({
      email: 'Admin@Test.com',
      fullName: 'Self',
      role: 'agent',
      inviterEmail: 'admin@test.com',
      getEmailContent,
    })).rejects.toThrow('You cannot invite your own email address');
  });

  it('throws 400 when user with email already exists', async () => {
    User.findOne.mockResolvedValue({ id: 'existing' });

    await expect(sendRoleInvitation({
      email: 'dup@test.com',
      fullName: 'Dup User',
      role: 'agent',
      getEmailContent,
    })).rejects.toThrow('A user with this email already exists');
  });

  it('sets invitation expiry to 7 days', async () => {
    await sendRoleInvitation({
      email: 'invitee@test.com',
      fullName: 'New Agent',
      role: 'agent',
      getEmailContent,
    });

    const createArg = User.create.mock.calls[0][0];
    const expiresAt = new Date(createArg.invitationExpires);
    const sevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt.getTime() - sevenDays)).toBeLessThan(5000);
  });

  it('parses multi-word full name into firstName and lastName', async () => {
    await sendRoleInvitation({
      email: 'invitee@test.com',
      fullName: 'Alice Bob Charlie',
      role: 'agent',
      getEmailContent,
    });

    const createArg = User.create.mock.calls[0][0];
    expect(createArg.firstName).toBe('Alice');
    expect(createArg.lastName).toBe('Bob Charlie');
  });

  it('calls getEmailContent with correct params and sends email', async () => {
    await sendRoleInvitation({
      email: 'invitee@test.com',
      fullName: 'New Agent',
      role: 'agent',
      getEmailContent,
    });

    expect(getEmailContent).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'New', expiryDays: 7, roleLabel: 'Agent' })
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'invitee@test.com', subject: 'You are invited' })
    );
  });

  it('does not throw when email sending fails', async () => {
    sendEmail.mockRejectedValue(new Error('SMTP down'));

    const result = await sendRoleInvitation({
      email: 'invitee@test.com',
      fullName: 'New Agent',
      role: 'agent',
      getEmailContent,
    });

    expect(result.user).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('applies extraFields to user creation', async () => {
    await sendRoleInvitation({
      email: 'invitee@test.com',
      fullName: 'New Agent',
      role: 'agent',
      extraFields: { owed_leads_count: 10 },
      getEmailContent,
    });

    const createArg = User.create.mock.calls[0][0];
    expect(createArg.owed_leads_count).toBe(10);
  });
});
