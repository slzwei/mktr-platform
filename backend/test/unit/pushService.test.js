import { jest } from '@jest/globals';
import '../setup.js';

// Mock the logger and models before importing
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Device: {
    update: jest.fn().mockResolvedValue([1]),
  },
}));

// Import the singleton from the module
const PushServiceModule = await import('../../src/services/pushService.js');

// Helper to create a fresh PushService-like instance for isolated testing
// We import the class indirectly via the module
function createMockRes() {
  const res = {
    write: jest.fn(),
    flush: jest.fn(),
    on: jest.fn(),
    flushHeaders: jest.fn(),
  };
  return res;
}

// ── Tests ──
// Since PushService is a class with side effects (setInterval), we test
// the exported singleton's methods directly but reset state between tests.

describe('pushService (unit)', () => {
  let push;

  beforeEach(() => {
    // Use the singleton but clear its state
    push = PushServiceModule.pushService || PushServiceModule;
    push.clients.clear();
    push.observers.clear();
    push.fleetObservers.clear();
    push.disconnectHistory.clear();
  });

  // ────────────────────────────────────────────────
  // sendEvent
  // ────────────────────────────────────────────────

  describe('sendEvent', () => {
    it('returns false when device is not connected', () => {
      const result = push.sendEvent('nonexistent-device', 'TEST', { foo: 'bar' });
      expect(result).toBe(false);
    });

    it('sends event successfully to connected device', () => {
      const res = createMockRes();
      push.clients.set('device-1', { id: 'conn-1', deviceId: 'device-1', res, connectedAt: Date.now() });

      const result = push.sendEvent('device-1', 'REFRESH_MANIFEST', { timestamp: 123 });

      expect(result).toBe(true);
      expect(res.write).toHaveBeenCalledWith('event: REFRESH_MANIFEST\n');
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('data: '));
    });

    it('calls flush on response if available', () => {
      const res = createMockRes();
      push.clients.set('device-1', { id: 'conn-1', deviceId: 'device-1', res, connectedAt: Date.now() });

      push.sendEvent('device-1', 'TEST', {});

      expect(res.flush).toHaveBeenCalled();
    });

    it('removes client and returns false on write error', () => {
      const res = createMockRes();
      res.write.mockImplementation(() => { throw new Error('Connection reset'); });
      // Need to mock the on handler for removeClient
      res.on.mockImplementation(() => {});
      push.clients.set('device-1', { id: 'conn-1', deviceId: 'device-1', res, connectedAt: Date.now() });

      const result = push.sendEvent('device-1', 'TEST', {});

      expect(result).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // broadcastLog
  // ────────────────────────────────────────────────

  describe('broadcastLog', () => {
    it('sends log to all observers of a device', () => {
      const res1 = createMockRes();
      const res2 = createMockRes();
      const observers = new Set([
        { id: 'obs-1', res: res1 },
        { id: 'obs-2', res: res2 },
      ]);
      push.observers.set('device-1', observers);

      push.broadcastLog('device-1', { level: 'info', message: 'test log' });

      expect(res1.write).toHaveBeenCalledWith('event: log\n');
      expect(res2.write).toHaveBeenCalledWith('event: log\n');
    });

    it('does nothing when no observers exist', () => {
      // Should not throw
      push.broadcastLog('device-1', { level: 'info', message: 'test' });
    });
  });

  // ────────────────────────────────────────────────
  // broadcastStatusChange
  // ────────────────────────────────────────────────

  describe('broadcastStatusChange', () => {
    it('notifies fleet observers of status change', () => {
      const res = createMockRes();
      push.fleetObservers.add({ id: 'fleet-obs-1', res });

      push.broadcastStatusChange('device-1', 'playing');

      expect(res.write).toHaveBeenCalledWith('event: status_change\n');
      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('"deviceId":"device-1"')
      );
    });

    it('notifies device-specific observers', () => {
      const res = createMockRes();
      const observers = new Set([{ id: 'obs-1', res }]);
      push.observers.set('device-1', observers);

      push.broadcastStatusChange('device-1', 'standby');

      expect(res.write).toHaveBeenCalledWith('event: status_change\n');
    });
  });

  // ────────────────────────────────────────────────
  // broadcastLocationUpdate
  // ────────────────────────────────────────────────

  describe('broadcastLocationUpdate', () => {
    it('sends location to fleet observers', () => {
      const res = createMockRes();
      push.fleetObservers.add({ id: 'fleet-obs-1', res });

      push.broadcastLocationUpdate('device-1', 1.3521, 103.8198);

      expect(res.write).toHaveBeenCalledWith('event: location_update\n');
      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('"latitude":1.3521')
      );
    });
  });

  // ────────────────────────────────────────────────
  // removeClient
  // ────────────────────────────────────────────────

  describe('removeClient', () => {
    it('removes client and saves disconnect history', () => {
      const res = createMockRes();
      push.clients.set('device-1', { id: 'conn-1', deviceId: 'device-1', res, status: 'playing', connectedAt: Date.now() });

      push.removeClient('device-1', 'conn-1');

      expect(push.clients.has('device-1')).toBe(false);
      expect(push.disconnectHistory.has('device-1')).toBe(true);
    });

    it('ignores stale disconnect (different connection ID)', () => {
      const res = createMockRes();
      push.clients.set('device-1', { id: 'conn-NEW', deviceId: 'device-1', res, connectedAt: Date.now() });

      push.removeClient('device-1', 'conn-OLD');

      // Client should still be there
      expect(push.clients.has('device-1')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────
  // addFleetObserver
  // ────────────────────────────────────────────────

  describe('addFleetObserver', () => {
    it('adds fleet observer and sends initial event', () => {
      const res = createMockRes();

      push.addFleetObserver(res);

      expect(push.fleetObservers.size).toBe(1);
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: connected'));
    });

    it('removes fleet observer on close', () => {
      const res = createMockRes();
      let closeHandler;
      res.on.mockImplementation((event, handler) => {
        if (event === 'close') closeHandler = handler;
      });

      push.addFleetObserver(res);
      expect(push.fleetObservers.size).toBe(1);

      closeHandler();
      expect(push.fleetObservers.size).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // broadcastHeartbeat
  // ────────────────────────────────────────────────

  describe('broadcastHeartbeat', () => {
    it('sends heartbeat to connected clients', () => {
      const res = createMockRes();
      push.clients.set('device-1', { id: 'conn-1', deviceId: 'device-1', res, connectedAt: Date.now() });

      push.broadcastHeartbeat();

      expect(res.write).toHaveBeenCalledWith('event: heartbeat\n');
    });

    it('sends keep-alive to observers', () => {
      const res = createMockRes();
      push.observers.set('device-1', new Set([{ id: 'obs-1', res }]));

      push.broadcastHeartbeat();

      expect(res.write).toHaveBeenCalledWith(': keep-alive\n\n');
    });

    it('sends keep-alive to fleet observers', () => {
      const res = createMockRes();
      push.fleetObservers.add({ id: 'fleet-1', res });

      push.broadcastHeartbeat();

      expect(res.write).toHaveBeenCalledWith(': keep-alive\n\n');
    });

    it('handles errors during heartbeat (removes dead clients)', () => {
      const res = createMockRes();
      res.write.mockImplementation(() => { throw new Error('Connection lost'); });
      res.on.mockImplementation(() => {});
      push.clients.set('device-1', { id: 'conn-1', deviceId: 'device-1', res, connectedAt: Date.now() });

      // Should not throw
      push.broadcastHeartbeat();
    });

    it('does nothing when no clients or observers', () => {
      // Should not throw
      push.broadcastHeartbeat();
    });
  });

  // ────────────────────────────────────────────────
  // cleanupHistory
  // ────────────────────────────────────────────────

  describe('cleanupHistory', () => {
    it('removes old entries from disconnect history', () => {
      push.disconnectHistory.set('device-old', { status: 'playing', timestamp: Date.now() - 60000 });
      push.disconnectHistory.set('device-new', { status: 'standby', timestamp: Date.now() });

      push.cleanupHistory();

      expect(push.disconnectHistory.has('device-old')).toBe(false);
      expect(push.disconnectHistory.has('device-new')).toBe(true);
    });
  });
});
