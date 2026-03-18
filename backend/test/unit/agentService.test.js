import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Helpers ──

function buildMocks() {
  const mockAgent = {
    id: 'agent-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@test.com',
    phone: '+6590000001',
    role: 'agent',
    isActive: true,
    owed_leads_count: 5,
    assignedProspects: [
      { leadStatus: 'new' },
      { leadStatus: 'contacted' },
      { leadStatus: 'won' },
    ],
    commissions: [
      { amount: '100.00', status: 'paid' },
      { amount: '200.00', status: 'pending' },
    ],
    createdCampaigns: [
      { status: 'active', prospects: [{ id: 'p1' }, { id: 'p2' }] },
      { status: 'inactive', prospects: [] },
    ],
    assignedPackages: [
      { leadsRemaining: 10, package: { id: 'pkg-1', name: 'Basic', price: 50, type: 'standard' } },
    ],
    toJSON: jest.fn(function () {
      return {
        id: this.id,
        firstName: this.firstName,
        lastName: this.lastName,
        email: this.email,
        phone: this.phone,
        role: this.role,
        isActive: this.isActive,
        owed_leads_count: this.owed_leads_count,
        assignedProspects: this.assignedProspects,
        commissions: this.commissions,
        createdCampaigns: this.createdCampaigns,
        assignedPackages: this.assignedPackages,
        prospectCount: this.prospectCount,
        convertedCount: this.convertedCount,
        totalCommissions: this.totalCommissions,
        paidCommissions: this.paidCommissions,
        createdCampaignsCount: this.createdCampaignsCount,
        activeCampaignsCount: this.activeCampaignsCount,
      };
    }),
    update: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(true),
  };

  // A second agent for list scenarios
  const mockAgent2 = {
    id: 'agent-2',
    firstName: 'John',
    lastName: 'Smith',
    email: 'john@test.com',
    role: 'agent',
    isActive: true,
    owed_leads_count: 0,
    prospectCount: '5',
    convertedCount: '1',
    totalCommissions: '500.00',
    paidCommissions: '200.00',
    createdCampaignsCount: '2',
    activeCampaignsCount: '1',
    assignedPackages: [],
    toJSON: jest.fn(function () {
      return { ...this, toJSON: undefined };
    }),
  };

  const mockListAgent = {
    ...mockAgent,
    prospectCount: '10',
    convertedCount: '3',
    totalCommissions: '1000.00',
    paidCommissions: '400.00',
    createdCampaignsCount: '3',
    activeCampaignsCount: '2',
    assignedPackages: [{ leadsRemaining: 5 }],
    toJSON: jest.fn(function () {
      return { ...this, toJSON: undefined };
    }),
  };

  const mockCampaign = {
    id: 'camp-1',
    name: 'Test Campaign',
    type: 'lead_gen',
    status: 'active',
    prospectCount: '10',
    convertedCount: '3',
    qrTagCount: '2',
    toJSON: jest.fn(function () {
      return {
        id: this.id,
        name: this.name,
        type: this.type,
        status: this.status,
        prospectCount: this.prospectCount,
        convertedCount: this.convertedCount,
        qrTagCount: this.qrTagCount,
      };
    }),
  };

  const mockProspect = {
    id: 'prospect-1',
    firstName: 'Lead',
    lastName: 'One',
    email: 'lead@test.com',
    leadStatus: 'new',
    campaign: { id: 'camp-1', name: 'Test Campaign', type: 'lead_gen' },
    qrTag: null,
  };

  const mockCommission = {
    id: 'comm-1',
    amount: '150.00',
    status: 'paid',
    type: 'conversion',
    earnedDate: new Date('2025-06-15'),
    campaign: { id: 'camp-1', name: 'Test Campaign', type: 'lead_gen' },
    prospect: { id: 'prospect-1', firstName: 'Lead', lastName: 'One', email: 'lead@test.com' },
    leadPackage: null,
  };

  const mockCommission2 = {
    id: 'comm-2',
    amount: '200.00',
    status: 'pending',
    type: 'conversion',
    earnedDate: new Date('2025-07-01'),
    campaign: null,
    prospect: null,
    leadPackage: null,
  };

  // --- Models ---

  const User = {
    findOne: jest.fn().mockResolvedValue(mockAgent),
    findByPk: jest.fn().mockResolvedValue(mockAgent),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockListAgent] }),
  };

  const Prospect = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockProspect] }),
  };

  const Commission = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 2, rows: [mockCommission, mockCommission2] }),
  };

  const Campaign = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockCampaign] }),
  };

  const LeadPackage = {};

  const LeadPackageAssignment = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const sequelize = {
    literal: jest.fn((expr) => expr),
  };

  const getSystemAgentId = jest.fn().mockResolvedValue('system-agent-id');
  const getAssignedCampaignCounts = jest.fn().mockResolvedValue({});
  const computeAgentStatsFromCounts = jest.fn((agent) => {
    const plain = agent.toJSON();
    return { ...plain, stats: { totalProspects: parseInt(plain.prospectCount) || 0 } };
  });
  const getAgentMonthlyPerformance = jest.fn().mockResolvedValue([]);

  const sendRoleInvitation = jest.fn().mockResolvedValue({
    user: { id: 'new-agent', email: 'new@test.com', firstName: 'New', role: 'agent' },
    inviteLink: 'https://app.test/invite?token=abc',
  });

  const getAgentInviteEmail = jest.fn().mockReturnValue('<html>invite</html>');
  const getAgentInviteSubject = jest.fn().mockReturnValue('You are invited');
  const getAgentInviteText = jest.fn().mockReturnValue('You are invited');

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return {
    mockAgent,
    mockAgent2,
    mockListAgent,
    mockCampaign,
    mockProspect,
    mockCommission,
    mockCommission2,
    models: { User, Prospect, Commission, Campaign, LeadPackage, LeadPackageAssignment },
    sequelize,
    getSystemAgentId,
    getAssignedCampaignCounts,
    computeAgentStatsFromCounts,
    getAgentMonthlyPerformance,
    sendRoleInvitation,
    getAgentInviteEmail,
    getAgentInviteSubject,
    getAgentInviteText,
    AppError,
    logger,
  };
}

/**
 * Build an agentService object whose functions use the injected mocks
 * instead of real model imports.  Mirrors the makeProspectService DI pattern.
 */
function makeService(mocks) {
  const {
    models: { User, Prospect, Commission, Campaign, LeadPackage, LeadPackageAssignment },
    sequelize,
    getSystemAgentId,
    getAssignedCampaignCounts,
    computeAgentStatsFromCounts,
    getAgentMonthlyPerformance,
    sendRoleInvitation,
    getAgentInviteEmail,
    getAgentInviteSubject,
    getAgentInviteText,
    AppError,
  } = mocks;

  // ── periodToStartDate ──
  function periodToStartDate(period) {
    const now = new Date();
    switch (period) {
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case 'quarter': {
        const quarter = Math.floor(now.getMonth() / 3);
        return new Date(now.getFullYear(), quarter * 3, 1);
      }
      case 'year':
        return new Date(now.getFullYear(), 0, 1);
      default:
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  // ── listAgents ──
  async function listAgents(query) {
    const { page = 1, limit = 10, search, status, sortBy = 'createdAt', order = 'DESC' } = query;
    const offset = (page - 1) * limit;

    const whereConditions = { role: 'agent' };

    const systemId = await getSystemAgentId();
    if (systemId) {
      whereConditions.id = { [Op.ne]: systemId };
    }

    if (status) {
      whereConditions.isActive = status === 'active';
    }

    if (search) {
      const sanitizedSearch = String(search).slice(0, 100);
      whereConditions[Op.or] = [
        { firstName: { [Op.iLike]: `%${sanitizedSearch}%` } },
        { lastName: { [Op.iLike]: `%${sanitizedSearch}%` } },
        { email: { [Op.iLike]: `%${sanitizedSearch}%` } },
      ];
    }

    const { count, rows: agents } = await User.findAndCountAll({
      where: whereConditions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [[sortBy, order.toUpperCase()]],
      attributes: {
        exclude: ['password'],
        include: [
          [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."assignedAgentId" = "User".id)'), 'prospectCount'],
        ],
      },
      include: [
        {
          association: 'assignedPackages',
          where: { status: 'active' },
          attributes: ['leadsRemaining'],
          required: false,
        },
      ],
    });

    const assignedCounts = await getAssignedCampaignCounts();
    const agentsWithStats = agents.map(agent => computeAgentStatsFromCounts(agent, assignedCounts));

    return {
      agents: agentsWithStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    };
  }

  // ── getAgentDetail ──
  async function getAgentDetail(agentId, requestingUser) {
    if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
      throw new AppError('Access denied', 403);
    }

    const agent = await User.findOne({
      where: { id: agentId, role: 'agent' },
      attributes: { exclude: ['password'] },
      include: [
        { association: 'assignedProspects', include: [{ association: 'campaign', attributes: ['id', 'name'] }] },
        { association: 'commissions', include: [{ association: 'campaign', attributes: ['id', 'name'] }, { association: 'prospect', attributes: ['id', 'firstName', 'lastName'] }] },
        { association: 'createdCampaigns', include: [{ association: 'prospects', attributes: ['id', 'leadStatus'] }] },
        { association: 'assignedPackages', include: [{ association: 'package', attributes: ['id', 'name', 'price', 'type'] }] },
      ],
    });

    if (!agent) {
      throw new AppError('Agent not found', 404);
    }

    const totalProspects = agent.assignedProspects.length;
    const prospectsByStatus = agent.assignedProspects.reduce((acc, prospect) => {
      acc[prospect.leadStatus] = (acc[prospect.leadStatus] || 0) + 1;
      return acc;
    }, {});

    const totalCommissions = agent.commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    const commissionsByStatus = agent.commissions.reduce((acc, commission) => {
      acc[commission.status] = (acc[commission.status] || 0) + parseFloat(commission.amount);
      return acc;
    }, {});

    const monthlyPerformance = await getAgentMonthlyPerformance(agentId);

    return {
      ...agent.toJSON(),
      stats: {
        prospects: {
          total: totalProspects,
          byStatus: prospectsByStatus,
          conversionRate: totalProspects > 0 ? (prospectsByStatus.won || 0) / totalProspects * 100 : 0,
        },
        commissions: {
          total: totalCommissions,
          byStatus: commissionsByStatus,
          average: agent.commissions.length > 0 ? totalCommissions / agent.commissions.length : 0,
        },
        campaigns: {
          total: agent.createdCampaigns.length,
          active: agent.createdCampaigns.filter(c => c.status === 'active').length,
          totalLeads: agent.createdCampaigns.reduce((sum, c) => sum + c.prospects.length, 0),
        },
        monthlyPerformance,
      },
    };
  }

  // ── updateAgent ──
  async function updateAgent(agentId, updates, requestingUser) {
    if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
      throw new AppError('Access denied', 403);
    }

    const agent = await User.findOne({ where: { id: agentId, role: 'agent' } });
    if (!agent) {
      throw new AppError('Agent not found', 404);
    }

    const { firstName, lastName, phone, avatar, isActive } = updates;
    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (phone) updateData.phone = phone;
    if (avatar) updateData.avatar = avatar;

    if (requestingUser.role === 'admin' && typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }

    await agent.update(updateData);
    return agent.toJSON();
  }

  // ── getAgentProspects ──
  async function getAgentProspects(agentId, query, requestingUser) {
    if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
      throw new AppError('Access denied', 403);
    }

    const { page = 1, limit = 10, status, priority, search } = query;
    const offset = (page - 1) * limit;

    const whereConditions = { assignedAgentId: agentId };
    if (status) whereConditions.leadStatus = status;
    if (priority) whereConditions.priority = priority;

    if (search) {
      const sanitizedSearch = String(search).slice(0, 100);
      whereConditions[Op.or] = [
        { firstName: { [Op.iLike]: `%${sanitizedSearch}%` } },
        { lastName: { [Op.iLike]: `%${sanitizedSearch}%` } },
        { email: { [Op.iLike]: `%${sanitizedSearch}%` } },
        { company: { [Op.iLike]: `%${sanitizedSearch}%` } },
      ];
    }

    const { count, rows: prospects } = await Prospect.findAndCountAll({
      where: whereConditions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [
        { association: 'campaign', attributes: ['id', 'name', 'type'] },
        { association: 'qrTag', attributes: ['id', 'name', 'type'] },
      ],
    });

    return {
      prospects,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    };
  }

  // ── getAgentCommissions ──
  async function getAgentCommissions(agentId, query, requestingUser) {
    if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
      throw new AppError('Access denied', 403);
    }

    const { page = 1, limit = 10, status, type, period } = query;
    const offset = (page - 1) * limit;

    const whereConditions = { agentId };
    if (status) whereConditions.status = status;
    if (type) whereConditions.type = type;

    if (period) {
      const startDate = periodToStartDate(period);
      whereConditions.earnedDate = { [Op.gte]: startDate, [Op.lte]: new Date() };
    }

    const { count, rows: commissions } = await Commission.findAndCountAll({
      where: whereConditions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['earnedDate', 'DESC']],
      include: [
        { association: 'campaign', attributes: ['id', 'name', 'type'] },
        { association: 'prospect', attributes: ['id', 'firstName', 'lastName', 'email'] },
        { association: 'leadPackage', attributes: ['id', 'name', 'type', 'price'] },
      ],
    });

    const totalAmount = commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    const paidAmount = commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.amount), 0);
    const pendingAmount = commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + parseFloat(c.amount), 0);

    return {
      commissions,
      summary: { totalAmount, paidAmount, pendingAmount, averageCommission: commissions.length > 0 ? totalAmount / commissions.length : 0 },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    };
  }

  // ── getAgentCampaigns ──
  async function getAgentCampaigns(agentId, query, requestingUser) {
    if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
      throw new AppError('Access denied', 403);
    }

    const { page = 1, limit = 10, status, type } = query;
    const offset = (page - 1) * limit;

    const agentAssignments = await LeadPackageAssignment.findAll({
      where: { agentId },
      include: [{ model: LeadPackage, as: 'package', attributes: ['campaignId'], required: true }],
      raw: true,
      nest: true,
    });
    const assignedIds = [...new Set(agentAssignments.map(a => a.package.campaignId).filter(Boolean))];

    const where = {
      [Op.or]: [
        { createdBy: agentId },
        ...(assignedIds.length > 0 ? [{ id: { [Op.in]: assignedIds } }] : []),
      ],
    };
    if (status) where.status = status;
    if (type) where.type = type;

    const { count, rows: campaigns } = await Campaign.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      attributes: {
        include: [
          [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id)'), 'prospectCount'],
        ],
      },
      include: [{ association: 'creator', attributes: ['id', 'firstName', 'lastName'] }],
    });

    const campaignsWithStats = campaigns.map(campaign => {
      const plain = campaign.toJSON();
      const totalProspects = parseInt(plain.prospectCount) || 0;
      const convertedProspects = parseInt(plain.convertedCount) || 0;
      const totalScans = parseInt(plain.qrTagCount) || 0;
      return {
        ...plain,
        stats: {
          totalProspects,
          convertedProspects,
          totalScans,
          conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
        },
      };
    });

    return {
      campaigns: campaignsWithStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    };
  }

  // ── inviteAgent ──
  async function inviteAgent(email, fullName, owedLeadsCount, inviterUser) {
    const { user, inviteLink } = await sendRoleInvitation({
      email,
      fullName,
      role: 'agent',
      inviterEmail: inviterUser?.email,
      extraFields: { owed_leads_count: parseInt(owedLeadsCount) || 0 },
      getEmailContent: ({ firstName, inviteLink: link, companyName, companyUrl, expiryDays }) => ({
        subject: getAgentInviteSubject(companyName),
        html: getAgentInviteEmail({ firstName, inviteLink: link, companyName, companyUrl, expiryDays }),
        text: getAgentInviteText({ firstName, inviteLink: link, companyName, expiryDays }),
      }),
    });
    return { user, inviteLink };
  }

  return {
    listAgents,
    getAgentDetail,
    updateAgent,
    getAgentProspects,
    getAgentCommissions,
    getAgentCampaigns,
    inviteAgent,
  };
}

// ── Tests ──

describe('agentService (unit)', () => {
  let mocks, service;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // listAgents
  // ────────────────────────────────────────────────

  describe('listAgents', () => {
    it('returns agents with pagination metadata', async () => {
      const result = await service.listAgents({ page: 1, limit: 10 });

      expect(result.agents).toHaveLength(1);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.totalItems).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('applies correct offset for page > 1', async () => {
      mocks.models.User.findAndCountAll.mockResolvedValue({ count: 25, rows: [] });

      await service.listAgents({ page: 3, limit: 5 });

      const callArg = mocks.models.User.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(10); // (3-1) * 5
      expect(callArg.limit).toBe(5);
    });

    it('applies search filter with iLike on name and email', async () => {
      await service.listAgents({ page: 1, limit: 10, search: 'jane' });

      const callArg = mocks.models.User.findAndCountAll.mock.calls[0][0];
      const orConditions = callArg.where[Op.or];
      expect(orConditions).toHaveLength(3);
      expect(orConditions[0].firstName[Op.iLike]).toBe('%jane%');
      expect(orConditions[2].email[Op.iLike]).toBe('%jane%');
    });

    it('applies sorting parameters', async () => {
      await service.listAgents({ page: 1, limit: 10, sortBy: 'firstName', order: 'asc' });

      const callArg = mocks.models.User.findAndCountAll.mock.calls[0][0];
      expect(callArg.order).toEqual([['firstName', 'ASC']]);
    });

    it('excludes System Agent from results', async () => {
      mocks.getSystemAgentId.mockResolvedValue('system-agent-id');

      await service.listAgents({ page: 1, limit: 10 });

      const callArg = mocks.models.User.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.id[Op.ne]).toBe('system-agent-id');
    });

    it('includes computed stats via computeAgentStatsFromCounts', async () => {
      const result = await service.listAgents({ page: 1, limit: 10 });

      expect(mocks.computeAgentStatsFromCounts).toHaveBeenCalled();
      expect(result.agents[0].stats).toBeDefined();
    });

    it('filters by status when provided', async () => {
      await service.listAgents({ page: 1, limit: 10, status: 'active' });

      const callArg = mocks.models.User.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.isActive).toBe(true);
    });
  });

  // ────────────────────────────────────────────────
  // getAgentDetail
  // ────────────────────────────────────────────────

  describe('getAgentDetail', () => {
    const admin = { id: 'admin-1', role: 'admin' };

    it('returns agent with stats when found', async () => {
      const result = await service.getAgentDetail('agent-1', admin);

      expect(result.id).toBe('agent-1');
      expect(result.stats).toBeDefined();
      expect(result.stats.prospects.total).toBe(3);
      expect(result.stats.prospects.byStatus.won).toBe(1);
      expect(result.stats.prospects.conversionRate).toBeCloseTo(33.33, 1);
      expect(result.stats.commissions.total).toBe(300);
      expect(result.stats.commissions.average).toBe(150);
      expect(result.stats.campaigns.total).toBe(2);
      expect(result.stats.campaigns.active).toBe(1);
      expect(result.stats.campaigns.totalLeads).toBe(2);
    });

    it('throws 404 when agent not found', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.getAgentDetail('nonexistent', admin))
        .rejects.toThrow('Agent not found');

      try {
        await service.getAgentDetail('nonexistent', admin);
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('allows agent to see their own profile', async () => {
      const selfUser = { id: 'agent-1', role: 'agent' };
      const result = await service.getAgentDetail('agent-1', selfUser);

      expect(result.id).toBe('agent-1');
    });

    it('denies agent from viewing another agent profile (403)', async () => {
      const otherAgent = { id: 'agent-2', role: 'agent' };

      await expect(service.getAgentDetail('agent-1', otherAgent))
        .rejects.toThrow('Access denied');

      try {
        await service.getAgentDetail('agent-1', otherAgent);
      } catch (err) {
        expect(err.statusCode).toBe(403);
      }
    });

    it('admin can view any agent profile', async () => {
      const result = await service.getAgentDetail('agent-1', admin);
      expect(result.id).toBe('agent-1');
    });

    it('includes monthly performance data', async () => {
      mocks.getAgentMonthlyPerformance.mockResolvedValue([{ month: '2025-06', count: 5 }]);

      const result = await service.getAgentDetail('agent-1', admin);

      expect(mocks.getAgentMonthlyPerformance).toHaveBeenCalledWith('agent-1');
      expect(result.stats.monthlyPerformance).toEqual([{ month: '2025-06', count: 5 }]);
    });
  });

  // ────────────────────────────────────────────────
  // updateAgent
  // ────────────────────────────────────────────────

  describe('updateAgent', () => {
    const admin = { id: 'admin-1', role: 'admin' };

    it('updates agent fields successfully', async () => {
      const result = await service.updateAgent('agent-1', { firstName: 'Updated' }, admin);

      expect(mocks.mockAgent.update).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Updated' })
      );
      expect(result).toBeDefined();
    });

    it('denies agent from updating another agent (403)', async () => {
      const otherAgent = { id: 'agent-2', role: 'agent' };

      await expect(service.updateAgent('agent-1', { firstName: 'Hack' }, otherAgent))
        .rejects.toThrow('Access denied');
    });

    it('allows agent to update own profile', async () => {
      const selfUser = { id: 'agent-1', role: 'agent' };
      await service.updateAgent('agent-1', { firstName: 'NewName' }, selfUser);

      expect(mocks.mockAgent.update).toHaveBeenCalled();
    });

    it('throws 404 when agent not found', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.updateAgent('nonexistent', { firstName: 'X' }, admin))
        .rejects.toThrow('Agent not found');
    });

    it('only admin can set isActive', async () => {
      await service.updateAgent('agent-1', { isActive: false }, admin);

      const updateArg = mocks.mockAgent.update.mock.calls[0][0];
      expect(updateArg.isActive).toBe(false);
    });

    it('non-admin cannot set isActive', async () => {
      const selfUser = { id: 'agent-1', role: 'agent' };
      await service.updateAgent('agent-1', { isActive: false }, selfUser);

      const updateArg = mocks.mockAgent.update.mock.calls[0][0];
      expect(updateArg.isActive).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────
  // getAgentProspects
  // ────────────────────────────────────────────────

  describe('getAgentProspects', () => {
    const admin = { id: 'admin-1', role: 'admin' };

    it('returns paginated prospects for agent', async () => {
      const result = await service.getAgentProspects('agent-1', { page: 1, limit: 10 }, admin);

      expect(result.prospects).toHaveLength(1);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.totalItems).toBe(1);

      const callArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.assignedAgentId).toBe('agent-1');
    });

    it('applies pagination offset correctly', async () => {
      mocks.models.Prospect.findAndCountAll.mockResolvedValue({ count: 30, rows: [] });

      await service.getAgentProspects('agent-1', { page: 2, limit: 5 }, admin);

      const callArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(5);
      expect(callArg.limit).toBe(5);
    });

    it('denies non-admin viewing another agent prospects (403)', async () => {
      const otherAgent = { id: 'agent-2', role: 'agent' };

      await expect(service.getAgentProspects('agent-1', { page: 1, limit: 10 }, otherAgent))
        .rejects.toThrow('Access denied');
    });

    it('allows agent to view own prospects', async () => {
      const selfUser = { id: 'agent-1', role: 'agent' };
      const result = await service.getAgentProspects('agent-1', { page: 1, limit: 10 }, selfUser);

      expect(result.prospects).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // getAgentCommissions
  // ────────────────────────────────────────────────

  describe('getAgentCommissions', () => {
    const admin = { id: 'admin-1', role: 'admin' };

    it('returns commissions with summary totals', async () => {
      const result = await service.getAgentCommissions('agent-1', { page: 1, limit: 10 }, admin);

      expect(result.commissions).toHaveLength(2);
      expect(result.summary.totalAmount).toBe(350); // 150 + 200
      expect(result.summary.paidAmount).toBe(150);
      expect(result.summary.pendingAmount).toBe(200);
      expect(result.summary.averageCommission).toBe(175); // 350 / 2
    });

    it('returns pagination metadata', async () => {
      const result = await service.getAgentCommissions('agent-1', { page: 1, limit: 10 }, admin);

      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.totalItems).toBe(2);
    });

    it('applies correct offset for page > 1', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 50, rows: [] });

      await service.getAgentCommissions('agent-1', { page: 3, limit: 10 }, admin);

      const callArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(20);
    });

    it('denies non-admin from viewing another agent commissions (403)', async () => {
      const otherAgent = { id: 'agent-2', role: 'agent' };

      await expect(service.getAgentCommissions('agent-1', { page: 1, limit: 10 }, otherAgent))
        .rejects.toThrow('Access denied');
    });

    it('allows agent to view own commissions', async () => {
      const selfUser = { id: 'agent-1', role: 'agent' };
      const result = await service.getAgentCommissions('agent-1', { page: 1, limit: 10 }, selfUser);

      expect(result.commissions).toBeDefined();
    });

    it('returns zero averageCommission when no commissions', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const result = await service.getAgentCommissions('agent-1', { page: 1, limit: 10 }, admin);

      expect(result.summary.averageCommission).toBe(0);
      expect(result.summary.totalAmount).toBe(0);
    });

    it('filters by period when provided', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.getAgentCommissions('agent-1', { page: 1, limit: 10, period: 'month' }, admin);

      const callArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.earnedDate).toBeDefined();
      expect(callArg.where.earnedDate[Op.gte]).toBeInstanceOf(Date);
      expect(callArg.where.earnedDate[Op.lte]).toBeInstanceOf(Date);
    });
  });

  // ────────────────────────────────────────────────
  // getAgentCampaigns
  // ────────────────────────────────────────────────

  describe('getAgentCampaigns', () => {
    const admin = { id: 'admin-1', role: 'admin' };

    it('returns campaigns with stats for agent', async () => {
      const result = await service.getAgentCampaigns('agent-1', { page: 1, limit: 10 }, admin);

      expect(result.campaigns).toHaveLength(1);
      expect(result.campaigns[0].stats).toBeDefined();
      expect(result.campaigns[0].stats.totalProspects).toBe(10);
      expect(result.pagination.totalItems).toBe(1);
    });

    it('queries both created and assigned campaigns', async () => {
      mocks.models.LeadPackageAssignment.findAll.mockResolvedValue([
        { package: { campaignId: 'camp-assigned-1' } },
        { package: { campaignId: 'camp-assigned-2' } },
      ]);

      await service.getAgentCampaigns('agent-1', { page: 1, limit: 10 }, admin);

      const callArg = mocks.models.Campaign.findAndCountAll.mock.calls[0][0];
      const orConditions = callArg.where[Op.or];
      expect(orConditions).toHaveLength(2); // createdBy + assigned IDs
      expect(orConditions[0].createdBy).toBe('agent-1');
    });

    it('denies non-admin from viewing another agent campaigns (403)', async () => {
      const otherAgent = { id: 'agent-2', role: 'agent' };

      await expect(service.getAgentCampaigns('agent-1', { page: 1, limit: 10 }, otherAgent))
        .rejects.toThrow('Access denied');
    });
  });

  // ────────────────────────────────────────────────
  // inviteAgent
  // ────────────────────────────────────────────────

  describe('inviteAgent', () => {
    const inviter = { id: 'admin-1', email: 'admin@test.com', role: 'admin' };

    it('calls sendRoleInvitation with correct params', async () => {
      const result = await service.inviteAgent('new@test.com', 'New Agent', 5, inviter);

      expect(mocks.sendRoleInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@test.com',
          fullName: 'New Agent',
          role: 'agent',
          inviterEmail: 'admin@test.com',
          extraFields: { owed_leads_count: 5 },
        })
      );

      expect(result.user).toBeDefined();
      expect(result.inviteLink).toBeDefined();
    });

    it('returns user and inviteLink on success', async () => {
      const result = await service.inviteAgent('new@test.com', 'New Agent', 0, inviter);

      expect(result.user.email).toBe('new@test.com');
      expect(result.inviteLink).toContain('invite');
    });

    it('propagates duplicate email error from sendRoleInvitation (409-like)', async () => {
      const err = new mocks.AppError('A user with this email already exists. Permanently delete the existing user first to send a new invitation.', 400);
      mocks.sendRoleInvitation.mockRejectedValue(err);

      await expect(service.inviteAgent('existing@test.com', 'Dup User', 0, inviter))
        .rejects.toThrow('A user with this email already exists');
    });

    it('propagates validation error when email missing', async () => {
      const err = new mocks.AppError('email and full_name are required', 400);
      mocks.sendRoleInvitation.mockRejectedValue(err);

      await expect(service.inviteAgent('', 'Name', 0, inviter))
        .rejects.toThrow('email and full_name are required');
    });

    it('passes owed_leads_count as integer', async () => {
      await service.inviteAgent('new@test.com', 'Agent', '10', inviter);

      const callArg = mocks.sendRoleInvitation.mock.calls[0][0];
      expect(callArg.extraFields.owed_leads_count).toBe(10);
    });

    it('defaults owed_leads_count to 0 when not provided', async () => {
      await service.inviteAgent('new@test.com', 'Agent', undefined, inviter);

      const callArg = mocks.sendRoleInvitation.mock.calls[0][0];
      expect(callArg.extraFields.owed_leads_count).toBe(0);
    });
  });
});
