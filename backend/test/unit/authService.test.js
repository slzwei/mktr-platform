import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock Helpers ──

function buildMocks() {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    fullName: 'Test User',
    phone: '+6591234567',
    role: 'customer',
    isActive: true,
    googleSub: null,
    avatarUrl: null,
    lastLogin: null,
    invitationToken: null,
    invitationExpires: null,
    emailVerified: false,
    emailVerificationToken: 'verify-token-123',
    resetPasswordToken: null,
    resetPasswordExpires: null,
    password: 'hashedpassword',
    dateOfBirth: null,
    companyName: null,
    comparePassword: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
    toJSON: jest.fn(function () { return { ...this }; }),
  };

  const User = {
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(mockUser),
    create: jest.fn().mockResolvedValue(mockUser),
    scope: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(mockUser),
      findByPk: jest.fn().mockResolvedValue(mockUser),
    }),
  };

  const generateToken = jest.fn().mockReturnValue('jwt-token-123');

  const AppError = class extends Error {
    constructor(message, statusCode, details = null) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
      this.isOperational = true;
    }
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return { mockUser, User, generateToken, AppError, logger };
}

// ── Module-level mocking (ESM) ──

let mocks;
let authService;

// We need to set up module mocks before importing the service.
// Since authService uses top-level imports, we use jest.unstable_mockModule.

let _User, _generateToken, _AppError, _logger;

beforeAll(async () => {
  mocks = buildMocks();
  _User = mocks.User;
  _generateToken = mocks.generateToken;
  _AppError = mocks.AppError;
  _logger = mocks.logger;

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    User: _User,
  }));

  jest.unstable_mockModule('../../src/middleware/auth.js', () => ({
    generateToken: _generateToken,
  }));

  jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
    AppError: _AppError,
  }));

  jest.unstable_mockModule('../../src/utils/logger.js', () => ({
    logger: _logger,
  }));

  authService = await import('../../src/services/authService.js');
});

// ── Tests ──

describe('authService (unit)', () => {
  beforeEach(() => {
    // Reset all mock call counts between tests
    jest.clearAllMocks();

    // Re-assign default mock behaviors
    mocks.User.findOne.mockResolvedValue(null);
    mocks.User.findByPk.mockResolvedValue(mocks.mockUser);
    mocks.User.create.mockResolvedValue(mocks.mockUser);
    mocks.mockUser.comparePassword.mockResolvedValue(true);
    mocks.mockUser.save.mockResolvedValue(true);
    mocks.mockUser.update.mockResolvedValue(true);
    mocks.mockUser.isActive = true;
    mocks.mockUser.role = 'customer';
    mocks.mockUser.invitationToken = null;
    mocks.mockUser.googleSub = null;
    mocks.mockUser.avatarUrl = null;
    mocks.mockUser.fullName = 'Test User';

    // Reset scope mock
    const scopedModel = {
      findOne: jest.fn().mockResolvedValue(mocks.mockUser),
      findByPk: jest.fn().mockResolvedValue(mocks.mockUser),
    };
    mocks.User.scope.mockReturnValue(scopedModel);
  });

  // ────────────────────────────────────────────────
  // register
  // ────────────────────────────────────────────────

  describe('register', () => {
    it('creates a new user and returns user + token', async () => {
      mocks.User.findOne.mockResolvedValue(null); // no existing user

      const result = await authService.register({
        email: 'new@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'User',
      });

      expect(mocks.User.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          password: 'password123',
          firstName: 'New',
          lastName: 'User',
          role: 'customer',
        })
      );
      expect(result.user).toBeDefined();
      expect(result.token).toBe('jwt-token-123');
    });

    it('throws 400 when email already exists', async () => {
      mocks.User.findOne.mockResolvedValue(mocks.mockUser); // existing user

      await expect(
        authService.register({ email: 'existing@example.com', password: 'password123' })
      ).rejects.toThrow('User with this email already exists');

      try {
        await authService.register({ email: 'existing@example.com', password: 'password123' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('calls generateToken with the new user ID', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await authService.register({ email: 'new@example.com', password: 'pass123' });

      expect(mocks.generateToken).toHaveBeenCalledWith(mocks.mockUser.id);
    });

    it('creates user with emailVerificationToken', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await authService.register({ email: 'new@example.com', password: 'pass123' });

      const createArg = mocks.User.create.mock.calls[0][0];
      expect(createArg.emailVerificationToken).toBeDefined();
      expect(typeof createArg.emailVerificationToken).toBe('string');
      expect(createArg.emailVerificationToken.length).toBeGreaterThan(0);
    });

    it('defaults role to customer when not specified', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await authService.register({ email: 'new@example.com', password: 'pass123' });

      const createArg = mocks.User.create.mock.calls[0][0];
      expect(createArg.role).toBe('customer');
    });
  });

  // ────────────────────────────────────────────────
  // login
  // ────────────────────────────────────────────────

  describe('login', () => {
    it('returns user + token for valid credentials', async () => {
      const scopedFindOne = jest.fn().mockResolvedValue(mocks.mockUser);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });
      mocks.mockUser.comparePassword.mockResolvedValue(true);

      const result = await authService.login('test@example.com', 'correctpassword');

      expect(result.user).toBeDefined();
      expect(result.token).toBe('jwt-token-123');
      expect(mocks.User.scope).toHaveBeenCalledWith('withPassword');
    });

    it('throws 401 for invalid email (no user found)', async () => {
      const scopedFindOne = jest.fn().mockResolvedValue(null);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });

      await expect(
        authService.login('nonexistent@example.com', 'password')
      ).rejects.toThrow('Invalid email or password');

      try {
        await authService.login('nonexistent@example.com', 'password');
      } catch (err) {
        expect(err.statusCode).toBe(401);
      }
    });

    it('throws 401 for invalid password', async () => {
      const scopedFindOne = jest.fn().mockResolvedValue(mocks.mockUser);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });
      mocks.mockUser.comparePassword.mockResolvedValue(false);

      await expect(
        authService.login('test@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid email or password');

      try {
        await authService.login('test@example.com', 'wrongpassword');
      } catch (err) {
        expect(err.statusCode).toBe(401);
      }
    });

    it('locks out after 5 failed attempts', async () => {
      const scopedFindOne = jest.fn().mockResolvedValue(null);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });

      const email = 'lockout-test@example.com';

      // Fail 5 times
      for (let i = 0; i < 5; i++) {
        await expect(authService.login(email, 'wrong')).rejects.toThrow('Invalid email or password');
      }

      // 6th attempt should trigger lockout
      await expect(authService.login(email, 'wrong')).rejects.toThrow(
        'Too many login attempts. Please try again in 15 minutes.'
      );

      try {
        await authService.login(email, 'wrong');
      } catch (err) {
        expect(err.statusCode).toBe(429);
      }
    });

    it('allows login after lockout period expires', async () => {
      const scopedFindOne = jest.fn().mockResolvedValue(null);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });

      const email = 'lockout-expiry@example.com';

      // Fail 5 times
      for (let i = 0; i < 5; i++) {
        await expect(authService.login(email, 'wrong')).rejects.toThrow('Invalid email or password');
      }

      // Verify lockout is active
      await expect(authService.login(email, 'wrong')).rejects.toThrow('Too many login attempts');

      // Simulate lockout expiry by manipulating Date.now
      const originalDateNow = Date.now;
      Date.now = () => originalDateNow() + 16 * 60 * 1000; // 16 minutes later

      // After lockout expires, the attempt should go through normally (still fails because no user, but not 429)
      await expect(authService.login(email, 'wrong')).rejects.toThrow('Invalid email or password');

      Date.now = originalDateNow; // restore
    });

    it('throws 401 for inactive user', async () => {
      const inactiveUser = { ...mocks.mockUser, isActive: false, comparePassword: jest.fn().mockResolvedValue(true), save: jest.fn() };
      const scopedFindOne = jest.fn().mockResolvedValue(inactiveUser);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });

      await expect(
        authService.login('inactive@example.com', 'password')
      ).rejects.toThrow('Account is deactivated');

      try {
        await authService.login('inactive@example.com', 'password');
      } catch (err) {
        expect(err.statusCode).toBe(401);
      }
    });

    it('updates lastLogin on successful login', async () => {
      const user = {
        ...mocks.mockUser,
        comparePassword: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
        isActive: true,
        role: 'customer',
        invitationToken: null,
      };
      const scopedFindOne = jest.fn().mockResolvedValue(user);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });

      await authService.login('test@example.com', 'password');

      expect(user.lastLogin).toBeInstanceOf(Date);
      expect(user.save).toHaveBeenCalled();
    });

    it('throws 403 for agent with pending invitation', async () => {
      const agentUser = {
        ...mocks.mockUser,
        role: 'agent',
        invitationToken: 'pending-token',
        isActive: true,
        comparePassword: jest.fn().mockResolvedValue(true),
        save: jest.fn(),
      };
      const scopedFindOne = jest.fn().mockResolvedValue(agentUser);
      mocks.User.scope.mockReturnValue({ findOne: scopedFindOne });

      await expect(
        authService.login('agent@example.com', 'password')
      ).rejects.toThrow('Please accept your invitation via the email link before logging in.');

      try {
        await authService.login('agent@example.com', 'password');
      } catch (err) {
        expect(err.statusCode).toBe(403);
      }
    });
  });

  // ────────────────────────────────────────────────
  // changePassword
  // ────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password with valid current password', async () => {
      const user = {
        ...mocks.mockUser,
        comparePassword: jest.fn().mockResolvedValue(true),
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.scope.mockReturnValue({
        findByPk: jest.fn().mockResolvedValue(user),
      });

      const result = await authService.changePassword('user-1', 'oldpass123', 'newpass1234');

      expect(user.comparePassword).toHaveBeenCalledWith('oldpass123');
      expect(user.update).toHaveBeenCalledWith({ password: 'newpass1234' });
      expect(result).toBeDefined();
    });

    it('throws 400 for incorrect current password', async () => {
      const user = {
        ...mocks.mockUser,
        comparePassword: jest.fn().mockResolvedValue(false),
        update: jest.fn(),
      };
      mocks.User.scope.mockReturnValue({
        findByPk: jest.fn().mockResolvedValue(user),
      });

      await expect(
        authService.changePassword('user-1', 'wrongcurrent', 'newpass1234')
      ).rejects.toThrow('Current password is incorrect');

      try {
        await authService.changePassword('user-1', 'wrongcurrent', 'newpass1234');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 400 when current or new password is missing', async () => {
      await expect(
        authService.changePassword('user-1', '', 'newpass1234')
      ).rejects.toThrow('Current password and new password are required');

      await expect(
        authService.changePassword('user-1', 'oldpass', '')
      ).rejects.toThrow('Current password and new password are required');
    });

    it('throws 400 when new password is too short', async () => {
      await expect(
        authService.changePassword('user-1', 'oldpass123', 'short')
      ).rejects.toThrow('New password must be at least 8 characters long');
    });
  });

  // ────────────────────────────────────────────────
  // googleIdTokenLogin
  // ────────────────────────────────────────────────

  describe('googleIdTokenLogin', () => {
    it('logs in existing user by email', async () => {
      const existingUser = {
        ...mocks.mockUser,
        isActive: true,
        googleSub: 'google-sub-123',
        save: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(existingUser);

      const result = await authService.googleIdTokenLogin({
        email: 'test@example.com',
        googleSub: 'google-sub-123',
        name: 'Test User',
        picture: 'https://photo.url',
      });

      expect(result.user).toBeDefined();
      expect(result.token).toBe('jwt-token-123');
      expect(existingUser.save).toHaveBeenCalled();
      expect(existingUser.lastLogin).toBeInstanceOf(Date);
    });

    it('creates new user when email not found', async () => {
      mocks.User.findOne.mockResolvedValue(null);
      const newUser = {
        ...mocks.mockUser,
        id: 'new-google-user',
        isActive: true,
      };
      mocks.User.create.mockResolvedValue(newUser);

      const result = await authService.googleIdTokenLogin({
        email: 'newgoogle@example.com',
        googleSub: 'google-sub-new',
        name: 'Google User',
        picture: 'https://photo.url',
      });

      expect(mocks.User.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newgoogle@example.com',
          googleSub: 'google-sub-new',
          role: 'customer',
          isActive: true,
          emailVerified: true,
          password: null,
        })
      );
      expect(result.token).toBe('jwt-token-123');
    });

    it('links Google sub to existing user without googleSub', async () => {
      const existingUser = {
        ...mocks.mockUser,
        googleSub: null,
        isActive: true,
        save: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(existingUser);

      await authService.googleIdTokenLogin({
        email: 'test@example.com',
        googleSub: 'new-google-sub',
        name: 'Test User',
      });

      expect(existingUser.googleSub).toBe('new-google-sub');
      expect(existingUser.save).toHaveBeenCalled();
    });

    it('throws 403 for inactive Google user', async () => {
      const inactiveUser = {
        ...mocks.mockUser,
        isActive: false,
        googleSub: 'google-sub-123',
        save: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(inactiveUser);

      await expect(
        authService.googleIdTokenLogin({
          email: 'inactive@example.com',
          googleSub: 'google-sub-123',
        })
      ).rejects.toThrow('User account is inactive');

      try {
        await authService.googleIdTokenLogin({
          email: 'inactive@example.com',
          googleSub: 'google-sub-123',
        });
      } catch (err) {
        expect(err.statusCode).toBe(403);
      }
    });

    it('fills in missing fullName and avatarUrl on existing user', async () => {
      const existingUser = {
        ...mocks.mockUser,
        isActive: true,
        googleSub: 'google-sub-123',
        fullName: null,
        avatarUrl: null,
        save: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(existingUser);

      await authService.googleIdTokenLogin({
        email: 'test@example.com',
        googleSub: 'google-sub-123',
        name: 'Filled Name',
        picture: 'https://avatar.url',
      });

      expect(existingUser.fullName).toBe('Filled Name');
      expect(existingUser.avatarUrl).toBe('https://avatar.url');
    });
  });

  // ────────────────────────────────────────────────
  // verifyEmail
  // ────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('activates user with valid verification token', async () => {
      const user = {
        ...mocks.mockUser,
        emailVerified: false,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(user);

      const result = await authService.verifyEmail('verify-token-123');

      expect(mocks.User.findOne).toHaveBeenCalledWith({
        where: { emailVerificationToken: 'verify-token-123' },
      });
      expect(user.update).toHaveBeenCalledWith({
        emailVerified: true,
        emailVerificationToken: null,
      });
      expect(result).toBeDefined();
    });

    it('throws 400 for invalid or expired token', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyEmail('invalid-token')
      ).rejects.toThrow('Invalid verification token');

      try {
        await authService.verifyEmail('invalid-token');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });
  });

  // ────────────────────────────────────────────────
  // forgotPassword
  // ────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('generates reset token for existing user', async () => {
      const user = {
        ...mocks.mockUser,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(user);

      const result = await authService.forgotPassword('test@example.com');

      expect(result.resetToken).toBeDefined();
      expect(typeof result.resetToken).toBe('string');
      expect(user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          resetPasswordToken: expect.any(String),
          resetPasswordExpires: expect.any(Date),
        })
      );
    });

    it('returns null resetToken for non-existent email (no leak)', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      const result = await authService.forgotPassword('nonexistent@example.com');

      expect(result.resetToken).toBeNull();
    });

    it('throws 400 when email is missing', async () => {
      await expect(authService.forgotPassword('')).rejects.toThrow('Email is required');
      await expect(authService.forgotPassword(undefined)).rejects.toThrow('Email is required');
    });

    it('sets reset token expiry to 1 hour in the future', async () => {
      const user = {
        ...mocks.mockUser,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(user);

      const before = Date.now();
      await authService.forgotPassword('test@example.com');
      const after = Date.now();

      const updateArg = user.update.mock.calls[0][0];
      const expiresTime = updateArg.resetPasswordExpires.getTime();

      // Expiry should be ~1 hour from now (within a small tolerance)
      expect(expiresTime).toBeGreaterThanOrEqual(before + 3600000 - 1000);
      expect(expiresTime).toBeLessThanOrEqual(after + 3600000 + 1000);
    });
  });

  // ────────────────────────────────────────────────
  // resetPassword
  // ────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('resets password with valid token', async () => {
      const user = {
        ...mocks.mockUser,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(user);

      const result = await authService.resetPassword('valid-reset-token', 'newpassword123');

      expect(user.update).toHaveBeenCalledWith({
        password: 'newpassword123',
        resetPasswordToken: null,
        resetPasswordExpires: null,
      });
      expect(result).toBeDefined();
    });

    it('throws 400 for expired or invalid token', async () => {
      mocks.User.findOne.mockResolvedValue(null); // token not found or expired

      await expect(
        authService.resetPassword('expired-token', 'newpassword123')
      ).rejects.toThrow('Invalid or expired reset token');

      try {
        await authService.resetPassword('expired-token', 'newpassword123');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 400 when password is too short', async () => {
      await expect(
        authService.resetPassword('valid-token', 'short')
      ).rejects.toThrow('Password must be at least 8 characters long');
    });

    it('throws 400 when password is missing', async () => {
      await expect(
        authService.resetPassword('valid-token', '')
      ).rejects.toThrow('Password must be at least 8 characters long');
    });

    it('clears resetPasswordToken and resetPasswordExpires after reset', async () => {
      const user = {
        ...mocks.mockUser,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(user);

      await authService.resetPassword('valid-token', 'newpassword123');

      const updateArg = user.update.mock.calls[0][0];
      expect(updateArg.resetPasswordToken).toBeNull();
      expect(updateArg.resetPasswordExpires).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // acceptInvite
  // ────────────────────────────────────────────────

  describe('acceptInvite', () => {
    it('accepts valid invitation and returns user + token', async () => {
      const invitedUser = {
        ...mocks.mockUser,
        firstName: 'Invited',
        lastName: 'Agent',
        invitationToken: 'invite-token',
        invitationExpires: new Date(Date.now() + 86400000), // 1 day from now
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(invitedUser);

      const result = await authService.acceptInvite({
        token: 'invite-token',
        email: 'agent@example.com',
        password: 'password123',
        fullName: 'Invited Agent',
        phone: '+6591111111',
      });

      expect(result.user).toBeDefined();
      expect(result.token).toBe('jwt-token-123');
      expect(invitedUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'password123',
          emailVerified: true,
          invitationToken: null,
          invitationExpires: null,
        })
      );
    });

    it('throws 400 for expired invitation', async () => {
      const expiredUser = {
        ...mocks.mockUser,
        invitationToken: 'expired-invite',
        invitationExpires: new Date(Date.now() - 86400000), // 1 day ago
        update: jest.fn(),
      };
      mocks.User.findOne.mockResolvedValue(expiredUser);

      await expect(
        authService.acceptInvite({
          token: 'expired-invite',
          email: 'agent@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('Invitation has expired');
    });

    it('throws 400 for invalid invitation token', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await expect(
        authService.acceptInvite({
          token: 'bad-token',
          email: 'agent@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('Invalid invitation token');
    });

    it('throws 400 when required fields are missing', async () => {
      await expect(
        authService.acceptInvite({ token: '', email: 'a@b.com', password: 'pass123' })
      ).rejects.toThrow('token, email and password are required');

      await expect(
        authService.acceptInvite({ token: 'tok', email: '', password: 'pass123' })
      ).rejects.toThrow('token, email and password are required');

      await expect(
        authService.acceptInvite({ token: 'tok', email: 'a@b.com', password: '' })
      ).rejects.toThrow('token, email and password are required');
    });

    it('parses fullName into firstName and lastName', async () => {
      const invitedUser = {
        ...mocks.mockUser,
        firstName: 'OldFirst',
        lastName: 'OldLast',
        invitationToken: 'invite-token',
        invitationExpires: new Date(Date.now() + 86400000),
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.User.findOne.mockResolvedValue(invitedUser);

      await authService.acceptInvite({
        token: 'invite-token',
        email: 'agent@example.com',
        password: 'password123',
        fullName: 'John Michael Doe',
      });

      const updateArg = invitedUser.update.mock.calls[0][0];
      expect(updateArg.firstName).toBe('John');
      expect(updateArg.lastName).toBe('Michael Doe');
    });
  });

  // ────────────────────────────────────────────────
  // getProfile
  // ────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns user with fleet_owner associations', async () => {
      mocks.User.findByPk.mockResolvedValue(mocks.mockUser);

      const result = await authService.getProfile('user-1', 'fleet_owner');

      expect(mocks.User.findByPk).toHaveBeenCalledWith('user-1', {
        include: expect.arrayContaining([
          { association: 'fleetOwnerProfile' },
          { association: 'payout', required: false },
        ]),
      });
      expect(result).toBeDefined();
    });

    it('returns user with driver associations', async () => {
      mocks.User.findByPk.mockResolvedValue(mocks.mockUser);

      const result = await authService.getProfile('user-1', 'driver');

      expect(mocks.User.findByPk).toHaveBeenCalledWith('user-1', {
        include: expect.arrayContaining([
          { association: 'driverProfile' },
          { association: 'payout', required: false },
        ]),
      });
      expect(result).toBeDefined();
    });

    it('returns user with only payout association for other roles', async () => {
      mocks.User.findByPk.mockResolvedValue(mocks.mockUser);

      const result = await authService.getProfile('user-1', 'customer');

      expect(mocks.User.findByPk).toHaveBeenCalledWith('user-1', {
        include: [{ association: 'payout', required: false }],
      });
      expect(result).toBeDefined();
    });

    it('returns null when user not found', async () => {
      mocks.User.findByPk.mockResolvedValue(null);

      const result = await authService.getProfile('nonexistent', 'customer');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // refreshToken
  // ────────────────────────────────────────────────

  describe('refreshToken', () => {
    it('returns a new token for the given userId', () => {
      const result = authService.refreshToken('user-1');

      expect(mocks.generateToken).toHaveBeenCalledWith('user-1');
      expect(result.token).toBe('jwt-token-123');
    });

    it('returns an object with only the token property', () => {
      const result = authService.refreshToken('user-1');

      expect(Object.keys(result)).toEqual(['token']);
    });
  });

  // ────────────────────────────────────────────────
  // updateProfile
  // ────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('updates allowed profile fields', async () => {
      const user = {
        ...mocks.mockUser,
        email: 'old@example.com',
        update: jest.fn().mockResolvedValue(true),
      };

      const result = await authService.updateProfile(user, {
        firstName: 'Updated',
        lastName: 'Name',
        phone: '+6599999999',
      });

      expect(user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Updated',
          lastName: 'Name',
          phone: '+6599999999',
        })
      );
      expect(result).toBeDefined();
    });

    it('throws 400 when changing email on Google-linked non-admin account', async () => {
      const user = {
        ...mocks.mockUser,
        email: 'google@example.com',
        googleSub: 'google-sub-linked',
        role: 'customer',
        update: jest.fn(),
      };

      await expect(
        authService.updateProfile(user, { email: 'new@example.com' })
      ).rejects.toThrow('Email for Google-linked account cannot be changed');
    });

    it('throws 400 when new email is already in use', async () => {
      const user = {
        ...mocks.mockUser,
        email: 'old@example.com',
        googleSub: null,
        role: 'customer',
        update: jest.fn(),
      };
      mocks.User.findOne.mockResolvedValue({ id: 'other-user' }); // email taken

      await expect(
        authService.updateProfile(user, { email: 'taken@example.com' })
      ).rejects.toThrow('Email is already in use');
    });
  });

  // ────────────────────────────────────────────────
  // getInviteInfo
  // ────────────────────────────────────────────────

  describe('getInviteInfo', () => {
    it('returns invite info for valid token', async () => {
      const invitedUser = {
        email: 'agent@example.com',
        firstName: 'Agent',
        lastName: 'Smith',
        fullName: 'Agent Smith',
        phone: '+6591234567',
        invitationExpires: new Date(Date.now() + 86400000),
      };
      mocks.User.findOne.mockResolvedValue(invitedUser);

      const result = await authService.getInviteInfo('valid-invite-token');

      expect(result.email).toBe('agent@example.com');
      expect(result.fullName).toBe('Agent Smith');
      expect(result.phone).toBe('+6591234567');
    });

    it('throws 400 for invalid invitation token', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await expect(
        authService.getInviteInfo('bad-token')
      ).rejects.toThrow('Invalid invitation token');
    });

    it('throws 400 for expired invitation', async () => {
      const expiredUser = {
        email: 'agent@example.com',
        firstName: 'Agent',
        lastName: 'Smith',
        fullName: null,
        phone: null,
        invitationExpires: new Date(Date.now() - 86400000), // expired
      };
      mocks.User.findOne.mockResolvedValue(expiredUser);

      await expect(
        authService.getInviteInfo('expired-token')
      ).rejects.toThrow('Invitation has expired');
    });
  });
});
