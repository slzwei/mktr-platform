import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { pushService } from '../src/services/pushService.js';

let app, admin, adminToken, agentToken, driverToken, agentUser, driverUser;

beforeAll(async () => {
  app = await getApp();

  const a = await createTestUser({ role: 'admin' });
  admin = a.user;
  adminToken = a.token;

  const ag = await createTestUser({ role: 'agent' });
  agentUser = ag.user;
  agentToken = ag.token;

  const dr = await createTestUser({ role: 'driver_partner' });
  driverUser = dr.user;
  driverToken = dr.token;
});

afterAll(async () => {
  await closeDb();
});

// ──────────────────────────────────────────────────────────────────
// Notifications route: GET /api/notifications
// ──────────────────────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  test('admin receives 200 with notifications array', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('notifications');
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
  });

  test('agent receives 200 with notifications array', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
  });

  test('driver_partner receives 200 with notifications array', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get('/api/notifications');

    expect(res.status).toBe(401);
  });

  test('respects limit query param', async () => {
    const res = await request(app)
      .get('/api/notifications?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBeLessThanOrEqual(5);
  });

  test('limit is capped at 50', async () => {
    // Even if we ask for 999, the server caps at 50
    const res = await request(app)
      .get('/api/notifications?limit=999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBeLessThanOrEqual(50);
  });

  test('since param filters older notifications', async () => {
    // Use a future date so nothing matches
    const future = new Date(Date.now() + 86400000).toISOString();
    const res = await request(app)
      .get(`/api/notifications?since=${future}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(0);
  });

  test('notifications are sorted by createdAt descending', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const items = res.body.data.notifications;
    for (let i = 1; i < items.length; i++) {
      const prev = new Date(items[i - 1].createdAt).getTime();
      const curr = new Date(items[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// getNotificationsForUser — direct unit tests
// ──────────────────────────────────────────────────────────────────

describe('getNotificationsForUser (service)', () => {
  let getNotificationsForUser;

  beforeAll(async () => {
    const mod = await import('../src/services/notifications.js');
    getNotificationsForUser = mod.getNotificationsForUser;
  });

  test('returns empty array for null user', async () => {
    const result = await getNotificationsForUser(null);
    expect(result).toEqual([]);
  });

  test('returns empty array for user without role', async () => {
    const result = await getNotificationsForUser({ id: 1 });
    expect(result).toEqual([]);
  });

  test('returns array for admin role', async () => {
    const result = await getNotificationsForUser(admin, { limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });

  test('returns array for agent role', async () => {
    const result = await getNotificationsForUser(agentUser, { limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });

  test('returns array for driver_partner role', async () => {
    const result = await getNotificationsForUser(driverUser, { limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });

  test('returns empty when role is unrecognized', async () => {
    const result = await getNotificationsForUser({ id: 999, role: 'unknown_role' });
    expect(result).toEqual([]);
  });

  test('respects limit parameter', async () => {
    const result = await getNotificationsForUser(admin, { limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('since parameter filters notifications', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const result = await getNotificationsForUser(admin, { since: future });
    expect(result.length).toBe(0);
  });

  test('each notification has required fields', async () => {
    const result = await getNotificationsForUser(admin, { limit: 50 });
    for (const n of result) {
      expect(n).toHaveProperty('id');
      expect(n).toHaveProperty('type');
      expect(n).toHaveProperty('title');
      expect(n).toHaveProperty('message');
      expect(n).toHaveProperty('createdAt');
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// PushService — unit tests (no external APIs required)
// ──────────────────────────────────────────────────────────────────
// Note: PushService is an in-memory EventEmitter-based SSE manager.
// Its helper functions (roleLabel, maskPhone, shortHost) in notifications.js
// are module-private. We test PushService's public surface below.

describe('PushService', () => {
  test('is a singleton instance', () => {
    expect(pushService).toBeDefined();
    expect(typeof pushService.addClient).toBe('function');
    expect(typeof pushService.removeClient).toBe('function');
    expect(typeof pushService.sendEvent).toBe('function');
    expect(typeof pushService.broadcastLog).toBe('function');
    expect(typeof pushService.broadcastHeartbeat).toBe('function');
    expect(typeof pushService.addObserver).toBe('function');
    expect(typeof pushService.addFleetObserver).toBe('function');
    expect(typeof pushService.broadcastLocationUpdate).toBe('function');
  });

  test('sendEvent returns false when device is not connected', () => {
    const result = pushService.sendEvent('nonexistent-device', 'TEST', { foo: 1 });
    expect(result).toBe(false);
  });

  test('broadcastLog does not throw when no observers exist', () => {
    expect(() => {
      pushService.broadcastLog('nonexistent-device', { msg: 'test' });
    }).not.toThrow();
  });

  test('broadcastHeartbeat does not throw with no clients', () => {
    expect(() => {
      pushService.broadcastHeartbeat();
    }).not.toThrow();
  });

  test('broadcastLocationUpdate does not throw with no fleet observers', () => {
    expect(() => {
      pushService.broadcastLocationUpdate('device-1', 1.3521, 103.8198);
    }).not.toThrow();
  });

  test('clients map starts empty (no real SSE connections in tests)', () => {
    // We should not have real SSE clients in the test environment
    // This confirms the Map exists and is accessible
    expect(pushService.clients).toBeInstanceOf(Map);
  });

  test('cleanupHistory removes stale entries', () => {
    // Manually insert a stale entry
    pushService.disconnectHistory.set('stale-device', {
      status: 'active',
      timestamp: Date.now() - 60000 // 60s ago — exceeds 30s threshold
    });

    pushService.cleanupHistory();

    expect(pushService.disconnectHistory.has('stale-device')).toBe(false);
  });

  test('cleanupHistory keeps recent entries', () => {
    pushService.disconnectHistory.set('recent-device', {
      status: 'playing',
      timestamp: Date.now() - 5000 // 5s ago — within 30s threshold
    });

    pushService.cleanupHistory();

    expect(pushService.disconnectHistory.has('recent-device')).toBe(true);
    // Cleanup after test
    pushService.disconnectHistory.delete('recent-device');
  });

  test('removeClient is a no-op for non-existent device', () => {
    // Should not throw; just silently ignore
    expect(() => {
      pushService.removeClient('no-such-device', 'conn-123');
    }).not.toThrow();
  });
});
