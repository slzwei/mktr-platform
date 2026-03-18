import { jest } from '@jest/globals';
import '../setup.js';

// Mock pino so it doesn't output during tests and we can spy on calls
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
};

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: mockLogger,
}));

// Mock sequelize error classes
const MockValidationError = class extends Error {
  constructor(msg, errors = []) {
    super(msg);
    this.name = 'SequelizeValidationError';
    this.errors = errors;
  }
};

jest.unstable_mockModule('sequelize', () => ({
  ValidationError: MockValidationError,
  DatabaseError: class extends Error { constructor(m) { super(m); } },
  ConnectionError: class extends Error { constructor(m) { super(m); } },
}));

const { errorHandler, AppError } = await import('../../src/middleware/errorHandler.js');

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    id: 'req-123',
    ...overrides,
  };
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

describe('errorHandler & observability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs structured error with requestId, method, and url', () => {
    const err = new Error('Something broke');
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, jest.fn());

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const logArgs = mockLogger.error.mock.calls[0];
    expect(logArgs[0].req.id).toBe('req-123');
    expect(logArgs[0].req.method).toBe('GET');
    expect(logArgs[0].req.url).toBe('/api/test');
    expect(logArgs[0].err.message).toBe('Something broke');
  });

  it('includes statusCode in error log when available', () => {
    const err = new AppError('Not found', 404);
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, jest.fn());

    const logArgs = mockLogger.error.mock.calls[0];
    expect(logArgs[0].err.statusCode).toBe(404);
  });

  it('returns 500 for generic errors', () => {
    const err = new Error('Unexpected');
    const res = mockRes();

    errorHandler(err, mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._body.success).toBe(false);
  });

  it('returns custom statusCode for AppError', () => {
    const err = new AppError('Forbidden', 403, 'details here');
    const res = mockRes();

    errorHandler(err, mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.message).toBe('Forbidden');
    expect(res._body.details).toBe('details here');
  });

  it('returns 401 for JsonWebTokenError', () => {
    const err = new Error('bad token');
    err.name = 'JsonWebTokenError';
    const res = mockRes();

    errorHandler(err, mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.message).toBe('Invalid Token');
  });

  it('returns 401 for TokenExpiredError', () => {
    const err = new Error('expired');
    err.name = 'TokenExpiredError';
    const res = mockRes();

    errorHandler(err, mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.message).toBe('Token Expired');
  });

  it('returns 400 for file size limit error', () => {
    const err = new Error('too big');
    err.code = 'LIMIT_FILE_SIZE';
    const res = mockRes();

    errorHandler(err, mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._body.message).toBe('File too large');
  });

  it('AppError sets isOperational flag', () => {
    const err = new AppError('Oops', 500);
    expect(err.isOperational).toBe(true);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Oops');
  });
});
