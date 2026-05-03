import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';
import path from 'path';
import { Op } from 'sequelize';
import { verifyRetellSignature } from '../../src/services/retellService.js';
import { makeProspectService } from '../../src/services/prospectService.js';
import { errorHandler, AppError } from '../../src/middleware/errorHandler.js';
import { ValidationError, DatabaseError, ConnectionError } from 'sequelize';

// ── Shared helpers ──

function makeMockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function makeMockReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/test',
    id: 'req-1',
    ...overrides,
  };
}

// ============================================================================
// Test 1: LIKE injection protection (prospectService.listProspects)
// ============================================================================

describe('LIKE injection protection (prospectService.listProspects)', () => {
  let service;
  let capturedWhere;

  beforeEach(() => {
    capturedWhere = null;

    const mockProspect = {
      findAndCountAll: jest.fn().mockImplementation(({ where }) => {
        capturedWhere = where;
        return Promise.resolve({ count: 0, rows: [] });
      }),
    };

    service = makeProspectService({
      models: {
        Prospect: mockProspect,
        User: {},
        Campaign: {},
        QrTag: {},
        Commission: {},
        Attribution: {},
        ProspectActivity: {},
        AgentGroup: {},
        AgentGroupMember: {},
      },
      sequelize: { fn: jest.fn(), col: jest.fn(), literal: jest.fn() },
      buildProspectWhere: jest.fn().mockResolvedValue({}),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      AppError,
    });
  });

  it('escapes % characters in search term to prevent LIKE wildcards', async () => {
    await service.listProspects({ id: 'user-1', role: 'admin' }, { search: '100%' });

    // The [Op.or] in the where clause should contain the escaped search
    const orClause = capturedWhere[Op.or];
    expect(orClause).toBeDefined();

    // Each LIKE condition should have the % escaped to \\%
    const firstNameLike = orClause[0].firstName[Op.iLike];
    expect(firstNameLike).toBe('%100\\%%');
    expect(firstNameLike).not.toBe('%100%%');
  });

  it('escapes _ characters in search term to prevent single-char LIKE wildcards', async () => {
    await service.listProspects({ id: 'user-1', role: 'admin' }, { search: 'test_user' });

    const orClause = capturedWhere[Op.or];
    const firstNameLike = orClause[0].firstName[Op.iLike];
    expect(firstNameLike).toBe('%test\\_user%');
    expect(firstNameLike).not.toBe('%test_user%');
  });

  it('escapes both % and _ in the same search term', async () => {
    await service.listProspects({ id: 'user-1', role: 'admin' }, { search: '50%_off' });

    const orClause = capturedWhere[Op.or];
    const firstNameLike = orClause[0].firstName[Op.iLike];
    expect(firstNameLike).toBe('%50\\%\\_off%');
  });

  it('truncates search term to 100 characters', async () => {
    const longSearch = 'a'.repeat(200);
    await service.listProspects({ id: 'user-1', role: 'admin' }, { search: longSearch });

    const orClause = capturedWhere[Op.or];
    const firstNameLike = orClause[0].firstName[Op.iLike];
    // The wrapped search should be at most 100 chars between the outer % chars
    const innerSearch = firstNameLike.slice(1, -1); // strip outer %...%
    expect(innerSearch.length).toBeLessThanOrEqual(100);
  });

  it('searches across all four fields: firstName, lastName, email, company', async () => {
    await service.listProspects({ id: 'user-1', role: 'admin' }, { search: 'test' });

    const orClause = capturedWhere[Op.or];
    expect(orClause).toHaveLength(4);

    const fieldNames = orClause.map((condition) => Object.keys(condition)[0]);
    expect(fieldNames).toEqual(['firstName', 'lastName', 'email', 'company']);
  });

  it('does not add search conditions when search param is absent', async () => {
    await service.listProspects({ id: 'user-1', role: 'admin' }, {});

    expect(capturedWhere[Op.or]).toBeUndefined();
  });

  it('handles search with only special characters', async () => {
    await service.listProspects({ id: 'user-1', role: 'admin' }, { search: '%_%' });

    const orClause = capturedWhere[Op.or];
    const firstNameLike = orClause[0].firstName[Op.iLike];
    expect(firstNameLike).toBe('%\\%\\_\\%%');
  });
});

// ============================================================================
// Test 2: Retell webhook replay protection (verifyRetellSignature)
// ============================================================================

describe('Retell webhook replay protection (verifyRetellSignature)', () => {
  const SECRET = 'test-webhook-secret';
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.RETELL_WEBHOOK_SECRET;
    process.env.RETELL_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RETELL_WEBHOOK_SECRET;
    } else {
      process.env.RETELL_WEBHOOK_SECRET = originalEnv;
    }
  });

  function makeValidSignature(body, timestampMs) {
    const ts = String(timestampMs);
    const bodyStr = body.toString();
    const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${bodyStr}`).digest('hex');
    return `v=${ts},d=${hmac}`;
  }

  it('accepts a signature with a timestamp within the 5-minute window', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const now = Date.now();
    const sig = makeValidSignature(body, now);

    expect(verifyRetellSignature(body, sig)).toBe(true);
  });

  it('accepts a signature 4 minutes in the past (within window)', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const fourMinutesAgo = Date.now() - 4 * 60 * 1000;
    const sig = makeValidSignature(body, fourMinutesAgo);

    expect(verifyRetellSignature(body, sig)).toBe(true);
  });

  it('rejects a signature older than 5 minutes (replay attack)', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const sig = makeValidSignature(body, sixMinutesAgo);

    expect(verifyRetellSignature(body, sig)).toBe(false);
  });

  it('rejects a signature 10 minutes old', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const sig = makeValidSignature(body, tenMinutesAgo);

    expect(verifyRetellSignature(body, sig)).toBe(false);
  });

  it('rejects a signature 1 hour old', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const sig = makeValidSignature(body, oneHourAgo);

    expect(verifyRetellSignature(body, sig)).toBe(false);
  });

  it('rejects a signature from the future beyond 5 minutes', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const sixMinutesFuture = Date.now() + 6 * 60 * 1000;
    const sig = makeValidSignature(body, sixMinutesFuture);

    expect(verifyRetellSignature(body, sig)).toBe(false);
  });

  it('accepts a signature slightly in the future (within window)', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const twoMinutesFuture = Date.now() + 2 * 60 * 1000;
    const sig = makeValidSignature(body, twoMinutesFuture);

    expect(verifyRetellSignature(body, sig)).toBe(true);
  });

  it('rejects a non-numeric timestamp', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const bodyStr = body.toString();
    const hmac = crypto.createHmac('sha256', SECRET).update(`abc.${bodyStr}`).digest('hex');

    expect(verifyRetellSignature(body, `v=abc,d=${hmac}`)).toBe(false);
  });

  it('rejects when timestamp field is missing', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const hmac = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

    expect(verifyRetellSignature(body, `d=${hmac}`)).toBe(false);
  });

  it('rejects when hmac field is missing', () => {
    const body = Buffer.from('{"event":"call_ended"}');
    const ts = String(Date.now());

    expect(verifyRetellSignature(body, `v=${ts}`)).toBe(false);
  });

  it('rejects a valid HMAC but with tampered body', () => {
    const originalBody = Buffer.from('{"event":"call_ended"}');
    const ts = Date.now();
    const sig = makeValidSignature(originalBody, ts);
    const tamperedBody = Buffer.from('{"event":"call_ended","admin":true}');

    expect(verifyRetellSignature(tamperedBody, sig)).toBe(false);
  });

  it('rejects when RETELL_WEBHOOK_SECRET is not set', () => {
    delete process.env.RETELL_WEBHOOK_SECRET;
    const body = Buffer.from('test');
    expect(verifyRetellSignature(body, 'v=123,d=abc')).toBe(false);
  });

  it('rejects when signature header is empty', () => {
    const body = Buffer.from('test');
    expect(verifyRetellSignature(body, '')).toBe(false);
  });
});

// ============================================================================
// Test 3: Error handler production mode (errorHandler middleware)
// ============================================================================

describe('Error handler production mode (errorHandler)', () => {
  let originalNodeEnv;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ── Sequelize ValidationError ──

  describe('Sequelize ValidationError', () => {
    it('hides field-level error details in production', () => {
      process.env.NODE_ENV = 'production';
      const err = new ValidationError('Validation failed', [
        { message: 'email must be unique', path: 'email', type: 'unique violation' },
        { message: 'phone is invalid', path: 'phone', type: 'Validation error' },
      ]);

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      // Must NOT include actual field errors in production
      expect(res.body.details).toBe('Invalid input data');
      expect(res.body.errors).toBeUndefined();
    });

    it('shows field-level error details in development', () => {
      process.env.NODE_ENV = 'development';
      const err = new ValidationError('Validation failed', [
        { message: 'email must be unique', path: 'email', type: 'unique violation' },
      ]);

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res.body.details).toContain('email must be unique');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors).toHaveLength(1);
    });
  });

  // ── Sequelize DatabaseError ──

  describe('Sequelize DatabaseError', () => {
    it('hides SQL error details in production', () => {
      process.env.NODE_ENV = 'production';
      const err = new DatabaseError(new Error('relation "users" does not exist'));

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Database Error');
      expect(res.body.details).toBe('Internal server error');
      // Must not leak the actual SQL error message
      expect(res.body.details).not.toContain('relation');
      expect(res.body.details).not.toContain('users');
    });

    it('shows SQL error details in development', () => {
      process.env.NODE_ENV = 'development';
      const err = new DatabaseError(new Error('relation "users" does not exist'));

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.details).toContain('relation');
    });
  });

  // ── Generic server error ──

  describe('generic unhandled error', () => {
    it('hides error message in production', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('Internal: password hash mismatch at row 42');

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.details).toBe('Something went wrong');
      // Must not leak internal error message
      expect(JSON.stringify(res.body)).not.toContain('password');
      expect(JSON.stringify(res.body)).not.toContain('row 42');
    });

    it('shows error message in development', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('Some internal debug message');

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.details).toBe('Some internal debug message');
    });
  });

  // ── Non-operational errors with statusCode ──

  describe('non-operational error with statusCode', () => {
    it('hides message in production for non-operational errors', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('Detailed internal failure info');
      err.statusCode = 500;
      // isOperational is not set, so this is NOT an AppError

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBe('An error occurred');
      expect(JSON.stringify(res.body)).not.toContain('Detailed internal failure info');
    });

    it('shows message in development for non-operational errors', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('Detailed internal failure info');
      err.statusCode = 500;

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBe('Detailed internal failure info');
    });
  });

  // ── AppError (intentional, safe to expose) ──

  describe('AppError (operational)', () => {
    it('exposes message in production since AppError is intentional', () => {
      process.env.NODE_ENV = 'production';
      const err = new AppError('Prospect not found', 404);

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toBe('Prospect not found');
    });

    it('hides details in production even for AppError', () => {
      process.env.NODE_ENV = 'production';
      const err = new AppError('Bad input', 400, 'Field X was missing');

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Bad input');
      // Details should NOT be present in production
      expect(res.body.details).toBeUndefined();
    });

    it('shows details in development for AppError', () => {
      process.env.NODE_ENV = 'development';
      const err = new AppError('Bad input', 400, 'Field X was missing');

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Bad input');
      expect(res.body.details).toBe('Field X was missing');
    });
  });

  // ── ConnectionError ──

  describe('Sequelize ConnectionError', () => {
    it('returns 503 without leaking connection details', () => {
      process.env.NODE_ENV = 'production';
      const err = new ConnectionError(new Error('ECONNREFUSED 10.0.0.1:5432'));

      const req = makeMockReq();
      const res = makeMockRes();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(503);
      expect(res.body.message).toBe('Database Connection Error');
      expect(res.body.details).toBe('Service temporarily unavailable');
      expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
    });
  });
});

// ============================================================================
// Test 4: APK filename sanitization (routes/apk.js)
// ============================================================================

describe('APK filename sanitization', () => {
  // The sanitization logic from apk.js:
  //   path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')
  // We extract and test this logic directly since the multer middleware is hard
  // to unit-test in isolation.

  function sanitizeFilename(originalname) {
    return path.basename(originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  it('strips path traversal sequences (../../)', () => {
    const result = sanitizeFilename('../../etc/passwd');
    // path.basename extracts "passwd", then sanitization keeps it as-is
    expect(result).toBe('passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('strips deeper path traversal sequences', () => {
    const result = sanitizeFilename('../../../etc/shadow');
    expect(result).toBe('shadow');
    expect(result).not.toContain('..');
  });

  it('strips encoded path traversal (URL-decoded before reaching Node)', () => {
    // By the time Node.js receives it, URL encoding is decoded
    const result = sanitizeFilename('..%2F..%2Fetc%2Fpasswd');
    // path.basename sees the literal string and extracts after last /
    // Since there are no actual / chars (they are %2F literally), basename returns the whole string
    // Then the regex strips the % chars
    expect(result).not.toContain('/');
    expect(result).not.toContain('%');
  });

  it('replaces special characters with underscores', () => {
    const result = sanitizeFilename('my app (v2) [beta].apk');
    expect(result).toBe('my_app__v2___beta_.apk');
    expect(result).not.toContain(' ');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
  });

  it('preserves valid characters: alphanumeric, dots, hyphens, underscores', () => {
    const result = sanitizeFilename('lyfe-app_v1.2.3.apk');
    expect(result).toBe('lyfe-app_v1.2.3.apk');
  });

  it('strips backslash path separators (Windows-style)', () => {
    const result = sanitizeFilename('..\\..\\Windows\\System32\\config.apk');
    // On POSIX, path.basename does not treat \\ as separators, but the regex
    // replaces all backslashes with underscores, neutralizing the traversal
    expect(result).not.toContain('\\');
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    // The final filename must end with .apk and contain no path separators
    expect(result).toMatch(/\.apk$/);
  });

  it('handles null byte injection attempts', () => {
    const result = sanitizeFilename('safe.apk\x00malicious.sh');
    // The null byte and everything after it: all non-allowed chars become _
    expect(result).not.toContain('\x00');
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('handles empty filename', () => {
    const result = sanitizeFilename('');
    expect(result).toBe('');
  });

  it('handles filename with only special characters', () => {
    const result = sanitizeFilename('$@#!^&*');
    expect(result).toBe('_______');
    expect(result).toMatch(/^_+$/);
  });

  it('strips Unicode/emoji characters', () => {
    const result = sanitizeFilename('app-\u{1F600}-release.apk');
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(result).not.toContain('\u{1F600}');
  });

  it('handles very long filenames', () => {
    const longName = 'a'.repeat(500) + '.apk';
    const result = sanitizeFilename(longName);
    // Sanitization does not truncate, but it should not crash
    expect(result).toBe(longName);
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('path.basename prevents absolute path injection', () => {
    const result = sanitizeFilename('/etc/passwd');
    expect(result).toBe('passwd');
    expect(result).not.toContain('/');
  });

  it('path.basename prevents home directory traversal', () => {
    const result = sanitizeFilename('~/../../etc/shadow');
    expect(result).toBe('shadow');
  });
});
