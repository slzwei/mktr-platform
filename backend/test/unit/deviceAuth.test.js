import { jest } from '@jest/globals';
import crypto from 'crypto';
import '../setup.js';

// Mock Device model
const _mockDevice = {
  id: 'dev-1',
  status: 'active',
  secretHash: null,
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Device: {
    findOne: jest.fn(),
  },
}));

const { authenticateDevice, guardFlags } = await import('../../src/middleware/deviceAuth.js');
const { Device } = await import('../../src/models/index.js');

function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _body: null,
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (body) { this._body = body; return this; }),
  };
  return res;
}

describe('deviceAuth middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────────────────────────────────────────
  // authenticateDevice
  // ──────────────────────────────────────────────

  describe('authenticateDevice', () => {
    it('returns 400 when X-Device-Key header is missing', async () => {
      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await authenticateDevice(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._body.message).toBe('Missing X-Device-Key');
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when device is not found', async () => {
      Device.findOne.mockResolvedValue(null);
      const req = mockReq({ 'x-device-key': 'unknown-key' });
      const res = mockRes();
      const next = jest.fn();

      await authenticateDevice(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._body.message).toBe('Unauthorized device');
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when device has a disallowed status', async () => {
      Device.findOne.mockResolvedValue({ id: 'dev-1', status: 'decommissioned' });
      const req = mockReq({ 'x-device-key': 'some-key' });
      const res = mockRes();
      const next = jest.fn();

      await authenticateDevice(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._body.message).toBe('Device disabled');
    });

    it('computes SHA-256 hash of device key for lookup', async () => {
      const deviceKey = 'my-secret-device-key';
      const expectedHash = crypto.createHash('sha256').update(deviceKey).digest('hex');

      Device.findOne.mockResolvedValue({ id: 'dev-1', status: 'active' });
      const req = mockReq({ 'x-device-key': deviceKey });
      const res = mockRes();
      const next = jest.fn();

      await authenticateDevice(req, res, next);

      expect(Device.findOne).toHaveBeenCalledWith({ where: { secretHash: expectedHash } });
    });

    it('sets req.device and calls next() for active device', async () => {
      const device = { id: 'dev-1', status: 'active' };
      Device.findOne.mockResolvedValue(device);
      const req = mockReq({ 'x-device-key': 'valid-key' });
      const res = mockRes();
      const next = jest.fn();

      await authenticateDevice(req, res, next);

      expect(req.device).toBe(device);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows devices with playing, idle, inactive, standby, offline statuses', async () => {
      for (const status of ['playing', 'idle', 'inactive', 'standby', 'offline']) {
        Device.findOne.mockResolvedValue({ id: 'dev-1', status });
        const req = mockReq({ 'x-device-key': 'valid-key' });
        const res = mockRes();
        const next = jest.fn();

        await authenticateDevice(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.device.status).toBe(status);
      }
    });

    it('calls next(error) on unexpected exceptions', async () => {
      const dbError = new Error('DB down');
      Device.findOne.mockRejectedValue(dbError);
      const req = mockReq({ 'x-device-key': 'some-key' });
      const res = mockRes();
      const next = jest.fn();

      await authenticateDevice(req, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ──────────────────────────────────────────────
  // guardFlags
  // ──────────────────────────────────────────────

  describe('guardFlags', () => {
    it('returns 404 when feature flag env var is not set', () => {
      delete process.env.MY_FEATURE_FLAG;
      const middleware = guardFlags('MY_FEATURE_FLAG');
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 404 when feature flag is set to false', () => {
      process.env.MY_FEATURE_FLAG = 'false';
      const middleware = guardFlags('MY_FEATURE_FLAG');
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();

      delete process.env.MY_FEATURE_FLAG;
    });

    it('calls next() when feature flag is true', () => {
      process.env.MY_FEATURE_FLAG = 'true';
      const middleware = guardFlags('MY_FEATURE_FLAG');
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();

      delete process.env.MY_FEATURE_FLAG;
    });
  });
});
