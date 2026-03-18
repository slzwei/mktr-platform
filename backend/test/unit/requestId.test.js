import { jest } from '@jest/globals';
import '../setup.js';
import { requestId } from '../../src/middleware/requestId.js';

function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  const _headers = {};
  return {
    setHeader: jest.fn((k, v) => { _headers[k] = v; }),
    _headers,
  };
}

describe('requestId middleware', () => {
  it('uses existing X-Request-Id header when present', () => {
    const req = mockReq({ 'x-request-id': 'existing-req-id-123' });
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.id).toBe('existing-req-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'existing-req-id-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID when X-Request-Id header is absent', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.id).toBeDefined();
    // UUID v4 format
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalled();
  });

  it('sets X-Request-Id response header to match req.id', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(res._headers['X-Request-Id']).toBe(req.id);
  });

  it('always calls next()', () => {
    const next = jest.fn();
    requestId(mockReq({}), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
