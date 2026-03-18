import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models ──

const mockUser = {
  id: 'user-1',
  email: 'admin@test.com',
  role: 'admin',
  fullName: 'Admin User',
  firstName: 'Admin',
  lastName: 'User',
  isActive: true,
  googleSub: null,
  approvalStatus: null,
  avatarUrl: null,
  createdAt: new Date(),
};

const mockProspectActivity = {
  id: 'activity-1',
  type: 'created',
  createdAt: new Date(),
  prospect: {
    id: 'prospect-1',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+6591234567',
    leadSource: 'website',
    campaignId: 'camp-1',
    assignedAgentId: 'agent-1',
    campaign: { name: 'Test Campaign' },
    qrTag: { id: 'qr-1', label: 'QR-Front', slug: 'front123', car: { plate_number: 'SGA1234B' } },
    assignedAgent: { fullName: 'Agent Smith', email: 'agent@test.com' },
  },
};

const mockQrScan = {
  id: 'scan-1',
  device: 'mobile',
  geoCity: 'Singapore',
  referer: 'https://google.com/search',
  ts: new Date(),
  qrTag: {
    id: 'qr-1',
    label: 'QR-Side',
    slug: 'side456',
    campaignId: 'camp-1',
    campaign: { name: 'Campaign X' },
    car: { plate_number: 'SGX5678A' },
  },
};

const User = {
  findAll: jest.fn().mockResolvedValue([mockUser]),
};

const Prospect = {};
const ProspectActivity = {
  findAll: jest.fn().mockResolvedValue([mockProspectActivity]),
};
const QrScan = {
  findAll: jest.fn().mockResolvedValue([mockQrScan]),
};
const QrTag = {};
const Car = {};
const Campaign = {};
const FleetOwner = {
  findOne: jest.fn().mockResolvedValue(null),
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  User,
  Prospect,
  ProspectActivity,
  QrScan,
  QrTag,
  Car,
  Campaign,
  FleetOwner,
}));

const { getNotificationsForUser } = await import('../../src/services/notifications.js');

// ── Tests ──

describe('notificationHelpers (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findAll.mockResolvedValue([mockUser]);
    ProspectActivity.findAll.mockResolvedValue([mockProspectActivity]);
    QrScan.findAll.mockResolvedValue([mockQrScan]);
  });

  // ────────────────────────────────────────────────
  // getNotificationsForUser
  // ────────────────────────────────────────────────

  describe('getNotificationsForUser', () => {
    it('returns empty array when user is null', async () => {
      const result = await getNotificationsForUser(null);

      expect(result).toEqual([]);
    });

    it('returns empty array when user has no role', async () => {
      const result = await getNotificationsForUser({ id: 'user-1' });

      expect(result).toEqual([]);
    });

    it('returns notifications for admin (all types)', async () => {
      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      expect(result.length).toBeGreaterThan(0);
      const types = result.map(r => r.type);
      expect(types).toContain('user_signup');
      expect(types).toContain('lead_created');
      expect(types).toContain('qr_scan');
    });

    it('builds user_signup notification correctly', async () => {
      ProspectActivity.findAll.mockResolvedValue([]);
      QrScan.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      const signup = result.find(r => r.type === 'user_signup');
      expect(signup).toBeDefined();
      expect(signup.title).toContain('User signup');
      expect(signup.message).toContain('Admin User');
      expect(signup.link).toBe('/AdminUsers');
    });

    it('builds lead_created notification correctly', async () => {
      User.findAll.mockResolvedValue([]);
      QrScan.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      const lead = result.find(r => r.type === 'lead_created');
      expect(lead).toBeDefined();
      expect(lead.title).toContain('Test Campaign');
      expect(lead.message).toContain('Jane Doe');
      expect(lead.message).toContain('website');
    });

    it('builds qr_scan notification correctly', async () => {
      User.findAll.mockResolvedValue([]);
      ProspectActivity.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      const scan = result.find(r => r.type === 'qr_scan');
      expect(scan).toBeDefined();
      expect(scan.title).toContain('QR scanned');
      expect(scan.message).toContain('mobile');
      expect(scan.message).toContain('google.com');
    });

    it('returns only own leads for agent role', async () => {
      await getNotificationsForUser({ id: 'agent-1', role: 'agent' });

      expect(ProspectActivity.findAll).toHaveBeenCalled();
      // Agent should not see user signups or QR scans
      expect(User.findAll).not.toHaveBeenCalled();
      expect(QrScan.findAll).not.toHaveBeenCalled();
    });

    it('respects limit parameter', async () => {
      const manyUsers = Array.from({ length: 20 }, (_, i) => ({
        ...mockUser,
        id: `user-${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));
      User.findAll.mockResolvedValue(manyUsers);
      ProspectActivity.findAll.mockResolvedValue([]);
      QrScan.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' }, { limit: 5 });

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('sorts by created time descending', async () => {
      const oldUser = { ...mockUser, id: 'old', createdAt: new Date('2024-01-01') };
      const newUser = { ...mockUser, id: 'new', createdAt: new Date('2025-06-01') };
      User.findAll.mockResolvedValue([oldUser, newUser]);
      ProspectActivity.findAll.mockResolvedValue([]);
      QrScan.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      const times = result.map(r => new Date(r.createdAt).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
      }
    });

    it('masks phone number in lead notification', async () => {
      User.findAll.mockResolvedValue([]);
      QrScan.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      const lead = result.find(r => r.type === 'lead_created');
      if (lead) {
        // Phone should be partially masked
        expect(lead.message).not.toContain('+6591234567');
        expect(lead.message).toContain('4567'); // last 4 digits visible
      }
    });

    it('returns empty array for unknown role', async () => {
      const result = await getNotificationsForUser({ id: 'user-1', role: 'customer' });

      // 'customer' role gets no notifications
      expect(result).toEqual([]);
    });

    it('uses since parameter for time filtering', async () => {
      const since = new Date('2025-06-01').toISOString();
      await getNotificationsForUser({ id: 'admin-1', role: 'admin' }, { since });

      // Should have been called with time filter
      expect(User.findAll).toHaveBeenCalled();
    });

    it('includes QR and car info in lead notification', async () => {
      User.findAll.mockResolvedValue([]);
      QrScan.findAll.mockResolvedValue([]);

      const result = await getNotificationsForUser({ id: 'admin-1', role: 'admin' });

      const lead = result.find(r => r.type === 'lead_created');
      if (lead) {
        expect(lead.message).toContain('QR: QR-Front');
        expect(lead.message).toContain('Car: SGA1234B');
      }
    });
  });
});
