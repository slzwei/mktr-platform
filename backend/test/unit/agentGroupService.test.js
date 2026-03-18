import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Helpers ──

function buildMocks() {
  const mockGroup = {
    id: 'group-1',
    name: 'Test Group',
    description: 'A test group',
    createdBy: 'user-1',
    destroy: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
  };

  const mockUser = {
    id: 'agent-1',
    phone: '+6590000001',
    role: 'agent',
    isActive: true,
  };

  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  const AgentGroup = {
    findAll: jest.fn().mockResolvedValue([mockGroup]),
    findByPk: jest.fn().mockResolvedValue(mockGroup),
    create: jest.fn().mockResolvedValue(mockGroup),
  };

  const AgentGroupMember = {
    bulkCreate: jest.fn().mockResolvedValue([]),
    destroy: jest.fn().mockResolvedValue(1),
  };

  const QrTag = {
    count: jest.fn().mockResolvedValue(0),
  };

  const User = {
    findAll: jest.fn().mockResolvedValue([mockUser]),
  };

  const sequelize = {
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
  };

  return {
    mockGroup,
    mockUser,
    mockTransaction,
    AgentGroup,
    AgentGroupMember,
    QrTag,
    User,
    sequelize,
  };
}

let mocks;
let service;

beforeEach(async () => {
  mocks = buildMocks();

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    AgentGroup: mocks.AgentGroup,
    AgentGroupMember: mocks.AgentGroupMember,
    QrTag: mocks.QrTag,
    User: mocks.User,
    sequelize: mocks.sequelize,
    Op,
  }));

  service = await import('../../src/services/agentGroupService.js');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── Tests ──

describe('agentGroupService (unit)', () => {

  // ── listAgentGroups ──

  describe('listAgentGroups', () => {
    it('returns all agent groups with includes', async () => {
      const result = await service.listAgentGroups();
      expect(mocks.AgentGroup.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          order: [['createdAt', 'DESC']],
          include: expect.any(Array),
        })
      );
      expect(result).toEqual([mocks.mockGroup]);
    });

    it('returns empty array when no groups exist', async () => {
      mocks.AgentGroup.findAll.mockResolvedValue([]);
      const result = await service.listAgentGroups();
      expect(result).toEqual([]);
    });
  });

  // ── createAgentGroup ──

  describe('createAgentGroup', () => {
    it('throws 400 when name is missing', async () => {
      await expect(service.createAgentGroup({}, 'user-1'))
        .rejects.toThrow('name is required');

      try {
        await service.createAgentGroup({}, 'user-1');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('creates group with no agents', async () => {
      await service.createAgentGroup({ name: 'Empty Group' }, 'user-1');

      expect(mocks.AgentGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Empty Group', createdBy: 'user-1' }),
        expect.objectContaining({ transaction: mocks.mockTransaction })
      );
      expect(mocks.AgentGroupMember.bulkCreate).not.toHaveBeenCalled();
    });

    it('creates group with agents and looks up user IDs by phone', async () => {
      const agents = [
        { phone: '+6590000001', name: 'Agent 1' },
        { phone: '+6590000002', name: 'Agent 2' },
      ];

      await service.createAgentGroup({ name: 'With Agents', agents }, 'user-1');

      expect(mocks.User.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'agent',
            isActive: true,
          }),
        })
      );
      expect(mocks.AgentGroupMember.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ phone: '+6590000001', sortOrder: 0 }),
          expect.objectContaining({ phone: '+6590000002', sortOrder: 1 }),
        ]),
        expect.objectContaining({ transaction: mocks.mockTransaction })
      );
    });

    it('resolves userId from phone lookup for known agents', async () => {
      mocks.User.findAll.mockResolvedValue([{ id: 'agent-1', phone: '+6590000001' }]);

      const agents = [{ phone: '+6590000001', name: 'Known Agent' }];
      await service.createAgentGroup({ name: 'Test', agents }, 'user-1');

      const bulkCreateArg = mocks.AgentGroupMember.bulkCreate.mock.calls[0][0];
      expect(bulkCreateArg[0].userId).toBe('agent-1');
    });

    it('sets userId to null when phone does not match any user', async () => {
      mocks.User.findAll.mockResolvedValue([]);

      const agents = [{ phone: '+6599999999', name: 'Unknown Agent' }];
      await service.createAgentGroup({ name: 'Test', agents }, 'user-1');

      const bulkCreateArg = mocks.AgentGroupMember.bulkCreate.mock.calls[0][0];
      expect(bulkCreateArg[0].userId).toBeNull();
    });

    it('skips agents without a phone', async () => {
      const agents = [
        { name: 'No Phone' },
        { phone: '+6590000001', name: 'Has Phone' },
      ];

      await service.createAgentGroup({ name: 'Test', agents }, 'user-1');

      const bulkCreateArg = mocks.AgentGroupMember.bulkCreate.mock.calls[0][0];
      expect(bulkCreateArg).toHaveLength(1);
      expect(bulkCreateArg[0].phone).toBe('+6590000001');
    });

    it('reloads group with includes after creation', async () => {
      await service.createAgentGroup({ name: 'Reload Test' }, 'user-1');

      expect(mocks.AgentGroup.findByPk).toHaveBeenCalledWith(
        mocks.mockGroup.id,
        expect.objectContaining({ include: expect.any(Array) })
      );
    });

    it('passes description as null when not provided', async () => {
      await service.createAgentGroup({ name: 'No Desc' }, 'user-1');

      expect(mocks.AgentGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
        expect.any(Object)
      );
    });
  });

  // ── updateAgentGroup ──

  describe('updateAgentGroup', () => {
    it('throws 404 when group not found', async () => {
      mocks.AgentGroup.findByPk.mockResolvedValueOnce(null);

      await expect(service.updateAgentGroup('nonexistent', { name: 'X' }))
        .rejects.toThrow('Agent group not found');

      try {
        mocks.AgentGroup.findByPk.mockResolvedValueOnce(null);
        await service.updateAgentGroup('nonexistent', { name: 'X' });
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('updates name and description', async () => {
      await service.updateAgentGroup('group-1', { name: 'Updated', description: 'New desc' });

      expect(mocks.mockGroup.update).toHaveBeenCalledWith(
        { name: 'Updated', description: 'New desc' },
        expect.objectContaining({ transaction: mocks.mockTransaction })
      );
    });

    it('replaces members when agents array is provided', async () => {
      const agents = [{ phone: '+6590000001', name: 'Agent 1' }];

      await service.updateAgentGroup('group-1', { agents });

      expect(mocks.AgentGroupMember.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentGroupId: mocks.mockGroup.id },
          transaction: mocks.mockTransaction,
        })
      );
      expect(mocks.AgentGroupMember.bulkCreate).toHaveBeenCalled();
    });

    it('does not touch members when agents is undefined', async () => {
      await service.updateAgentGroup('group-1', { name: 'Only Name' });

      expect(mocks.AgentGroupMember.destroy).not.toHaveBeenCalled();
      expect(mocks.AgentGroupMember.bulkCreate).not.toHaveBeenCalled();
    });

    it('reloads group after update', async () => {
      await service.updateAgentGroup('group-1', { name: 'Reload' });

      // findByPk called twice: once to find, once to reload
      expect(mocks.AgentGroup.findByPk).toHaveBeenCalledTimes(2);
    });
  });

  // ── deleteAgentGroup ──

  describe('deleteAgentGroup', () => {
    it('throws 404 when group not found', async () => {
      mocks.AgentGroup.findByPk.mockResolvedValueOnce(null);

      await expect(service.deleteAgentGroup('nonexistent'))
        .rejects.toThrow('Agent group not found');
    });

    it('throws 409 when QR tags reference the group', async () => {
      mocks.QrTag.count.mockResolvedValue(3);

      await expect(service.deleteAgentGroup('group-1'))
        .rejects.toThrow('Cannot delete: 3 QR code(s) reference this group');

      try {
        await service.deleteAgentGroup('group-1');
      } catch (err) {
        expect(err.statusCode).toBe(409);
      }
    });

    it('destroys group when no QR tags reference it', async () => {
      mocks.QrTag.count.mockResolvedValue(0);

      await service.deleteAgentGroup('group-1');

      expect(mocks.mockGroup.destroy).toHaveBeenCalled();
    });

    it('checks QR tag count with correct agentGroupId', async () => {
      mocks.QrTag.count.mockResolvedValue(0);

      await service.deleteAgentGroup('group-1');

      expect(mocks.QrTag.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentGroupId: mocks.mockGroup.id },
        })
      );
    });
  });
});
