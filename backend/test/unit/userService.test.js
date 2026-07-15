import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Mock models ──

const User = {
  findOne: jest.fn(),
  findByPk: jest.fn(),
  findAll: jest.fn(),
  findAndCountAll: jest.fn(),
  create: jest.fn(),
  count: jest.fn(),
  destroy: jest.fn(),
};

const Campaign = { count: jest.fn() };
const Commission = { count: jest.fn() };
const Prospect = { findAll: jest.fn(), update: jest.fn() };
const LeadPackageAssignment = { destroy: jest.fn(), count: jest.fn() };
const ProspectActivity = { bulkCreate: jest.fn() };
// Wallet guards (agent-wallet build): ledger history RESTRICTs hard-deletes;
// open wallet state (balance / open commitments) 409s deactivate + delete.
const WalletLedger = { count: jest.fn() };

const mockTransaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
  LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' },
};

const sequelize = {
  transaction: jest.fn(async (cb) => cb(mockTransaction)),
  fn: jest.fn((name, col) => `${name}(${col})`),
  col: jest.fn((n) => n),
};

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  User, Campaign, Commission, Prospect, LeadPackageAssignment, ProspectActivity, WalletLedger, sequelize, Op,
}));
jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({ AppError }));

const mod = await import('../../src/services/userService.js');
const { createUser, listUsers, getUserById, updateUser, toggleUserStatus, deactivateUser, permanentlyDeleteUser, bulkDeleteUsers } = mod;

// ── Tests ──

describe('userService (unit)', () => {
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUser = {
      id: 'user-1',
      email: 'jane@test.com',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+6591234567',
      role: 'agent',
      isActive: true,
      googleSub: null,
      update: jest.fn().mockResolvedValue(true),
      destroy: jest.fn().mockResolvedValue(true),
    };

    User.findOne.mockResolvedValue(null);
    User.findByPk.mockResolvedValue(mockUser);
    User.findAll.mockResolvedValue([]);
    User.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    User.create.mockResolvedValue(mockUser);
    User.count.mockResolvedValue(0);
    User.destroy.mockResolvedValue(1);
    Campaign.count.mockResolvedValue(0);
    Commission.count.mockResolvedValue(0);
    Prospect.findAll.mockResolvedValue([]);
    Prospect.update.mockResolvedValue([0]);
    LeadPackageAssignment.destroy.mockResolvedValue(0);
    LeadPackageAssignment.count.mockResolvedValue(0);
    WalletLedger.count.mockResolvedValue(0);
    ProspectActivity.bulkCreate.mockResolvedValue([]);
  });

  // ── createUser ──

  describe('createUser', () => {
    it('creates user with default role customer', async () => {
      await createUser({ email: 'new@test.com', firstName: 'New', lastName: 'User' });

      expect(User.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'customer', isActive: true, owed_leads_count: 0 })
      );
    });

    it('throws 400 when email already exists', async () => {
      User.findOne.mockResolvedValue({ id: 'existing' });

      await expect(createUser({ email: 'dup@test.com', firstName: 'D', lastName: 'U' }))
        .rejects.toThrow('User with this email already exists');
    });
  });

  // ── listUsers ──

  describe('listUsers', () => {
    it('applies pagination correctly', async () => {
      User.findAndCountAll.mockResolvedValue({ count: 50, rows: [] });

      const result = await listUsers({ page: 3, limit: 10 });

      const arg = User.findAndCountAll.mock.calls[0][0];
      expect(arg.offset).toBe(20);
      expect(arg.limit).toBe(10);
      expect(result.pagination.currentPage).toBe(3);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('filters by role', async () => {
      await listUsers({ role: 'agent' });

      const arg = User.findAndCountAll.mock.calls[0][0];
      expect(arg.where.role).toBe('agent');
    });

    it('filters by status=active -> isActive: true', async () => {
      await listUsers({ status: 'active' });

      const arg = User.findAndCountAll.mock.calls[0][0];
      expect(arg.where.isActive).toBe(true);
    });

    it('applies iLike search on firstName, lastName, email', async () => {
      await listUsers({ search: 'jane' });

      const arg = User.findAndCountAll.mock.calls[0][0];
      expect(arg.where[Op.or]).toHaveLength(3);
    });
  });

  // ── getUserById ──

  describe('getUserById', () => {
    it('returns user with associations when found', async () => {
      const result = await getUserById('user-1');
      expect(result).toBe(mockUser);
    });

    it('throws 404 when user not found', async () => {
      User.findByPk.mockResolvedValue(null);

      await expect(getUserById('nonexistent')).rejects.toThrow('User not found');
    });
  });

  // ── updateUser ──

  describe('updateUser', () => {
    it('allows admin to update role', async () => {
      await updateUser('user-1', { role: 'admin' }, true);

      expect(mockUser.update).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
    });

    it('non-admin cannot update role', async () => {
      await updateUser('user-1', { role: 'admin', firstName: 'Updated' }, false);

      const updateArg = mockUser.update.mock.calls[0][0];
      expect(updateArg.role).toBeUndefined();
      expect(updateArg.firstName).toBe('Updated');
    });

    it('throws 400 when editing email on Google-linked account', async () => {
      mockUser.googleSub = 'google-123';

      await expect(updateUser('user-1', { email: 'new@test.com' }, true))
        .rejects.toThrow('Email for Google-linked account cannot be changed');
    });

    it('throws 404 when user not found', async () => {
      User.findByPk.mockResolvedValue(null);

      await expect(updateUser('nonexistent', {}, true)).rejects.toThrow('User not found');
    });
  });

  // ── toggleUserStatus ──

  describe('toggleUserStatus', () => {
    it('updates isActive to the given value', async () => {
      await toggleUserStatus('user-1', false);

      expect(mockUser.update).toHaveBeenCalledWith({ isActive: false });
    });

    it('throws 404 when user not found', async () => {
      User.findByPk.mockResolvedValue(null);

      await expect(toggleUserStatus('nonexistent', true)).rejects.toThrow('User not found');
    });
  });

  // ── deactivateUser ──

  describe('deactivateUser', () => {
    it('unassigns prospects, removes packages, sets isActive false', async () => {
      Prospect.findAll.mockResolvedValue([{ id: 'p1' }]);

      const result = await deactivateUser('user-1', 'admin-1');

      expect(Prospect.update).toHaveBeenCalledWith(
        { assignedAgentId: null },
        expect.objectContaining({ where: { assignedAgentId: 'user-1' } })
      );
      expect(LeadPackageAssignment.destroy).toHaveBeenCalled();
      // wallet-source rows are financial history — never destroyed here
      expect(LeadPackageAssignment.destroy.mock.calls[0][0].where.source).toEqual({ [Op.ne]: 'wallet' });
      expect(mockUser.update).toHaveBeenCalledWith(
        { isActive: false },
        expect.objectContaining({ transaction: mockTransaction })
      );
      expect(result.message).toContain('deactivated');
    });

    it('409s when the user still holds a wallet balance', async () => {
      User.count.mockResolvedValueOnce(1); // walletBalanceCents > 0 check
      await expect(deactivateUser('user-1', 'admin-1')).rejects.toMatchObject({ statusCode: 409 });
      expect(LeadPackageAssignment.destroy).not.toHaveBeenCalled();
    });

    it('409s when the user has open wallet commitments', async () => {
      User.count.mockResolvedValueOnce(0);
      LeadPackageAssignment.count.mockResolvedValueOnce(3);
      await expect(deactivateUser('user-1', 'admin-1')).rejects.toMatchObject({ statusCode: 409 });
      expect(LeadPackageAssignment.destroy).not.toHaveBeenCalled();
    });
  });

  // ── permanentlyDeleteUser ──

  describe('permanentlyDeleteUser', () => {
    it('throws 409 when user owns campaigns', async () => {
      Campaign.count.mockResolvedValue(2);

      await expect(permanentlyDeleteUser('user-1', 'admin-1'))
        .rejects.toThrow('Cannot delete user who created campaigns');
    });

    it('throws 409 when user has commissions', async () => {
      Commission.count.mockResolvedValue(1);

      await expect(permanentlyDeleteUser('user-1', 'admin-1'))
        .rejects.toThrow('Cannot delete user with commissions');
    });

    it('throws 409 when user has wallet history (financial records are never erased)', async () => {
      WalletLedger.count.mockResolvedValueOnce(4);

      await expect(permanentlyDeleteUser('user-1', 'admin-1'))
        .rejects.toThrow('Cannot delete user with wallet history');
      expect(mockUser.destroy).not.toHaveBeenCalled();
    });

    it('destroys user record in transaction', async () => {
      const result = await permanentlyDeleteUser('user-1', 'admin-1');

      expect(mockUser.destroy).toHaveBeenCalledWith(
        expect.objectContaining({ transaction: mockTransaction })
      );
      expect(result.message).toContain('permanently deleted');
    });
  });

  // ── bulkDeleteUsers ──

  describe('bulkDeleteUsers', () => {
    it('deletes multiple users and returns count', async () => {
      User.findAll.mockResolvedValue([
        { id: 'u1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
      ]);
      User.destroy.mockResolvedValue(2);

      const result = await bulkDeleteUsers(['u1', 'u2'], 'admin-1');

      expect(result.deletedCount).toBe(2);
      expect(User.destroy).toHaveBeenCalled();
    });
  });
});
