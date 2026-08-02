/**
 * P2-11 regression: the ERROR LOG is scrubbed too.
 *
 * errorHandler logged raw `err.message` and `err.stack` to pino. An identifier
 * interpolated into a thrown Error therefore landed verbatim in the log
 * stream — and that stream sits OUTSIDE the PDPA erasure matrix, so a later
 * erasure request cannot take it back. The Sentry half of this task is
 * covered in test/sentryScrub.test.js; this is the half nobody can delete.
 */
import { jest } from '@jest/globals';
import '../setup.js';

const logs = [];
const logger = {
  error: jest.fn((payload, msg) => logs.push({ payload, msg })),
  warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
};

jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger }));

const { errorHandler } = await import('../../src/middleware/errorHandler.js');

const runHandler = (err) => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  errorHandler(err, { method: 'POST', originalUrl: '/api/prospects', id: 'req-1' }, res, () => {});
  return res;
};

beforeEach(() => {
  logs.length = 0;
  jest.clearAllMocks();
});

describe('errorHandler PII scrubbing', () => {
  it('scrubs an email interpolated into the thrown message', () => {
    runHandler(new Error('Lead shawn@example.com not found'));

    const { err } = logs[0].payload;
    expect(err.message).toBe('Lead [email] not found');
    expect(err.message).not.toContain('shawn@example.com');
  });

  it('scrubs a phone number in every format the platform renders', () => {
    runHandler(new Error('dial +65 9123 4567 / +6591234567 / 91234567 failed'));

    expect(logs[0].payload.err.message).toBe('dial [phone] / [phone] / [phone] failed');
  });

  it('scrubs the STACK as well — the message is repeated in its first line', () => {
    runHandler(new Error('holder S1234567A rejected'));

    const { err } = logs[0].payload;
    expect(err.stack).toContain('[nric]');
    expect(err.stack).not.toContain('S1234567A');
  });

  it('still masks URL-borne credentials in the request line', () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    errorHandler(
      new Error('boom'),
      { method: 'GET', originalUrl: '/api/reward-claim/live-secret', id: 'req-2' },
      res,
      () => {}
    );

    expect(logs[0].payload.req.url).toBe('/api/reward-claim/[token]');
  });

  it('leaves a PII-free message intact — no over-redaction of ordinary errors', () => {
    runHandler(new Error('Campaign not found'));

    expect(logs[0].payload.err.message).toBe('Campaign not found');
  });

  it('carries the status code through unchanged', () => {
    const err = new Error('Lead a@b.com blocked');
    err.statusCode = 409;

    runHandler(err);

    expect(logs[0].payload.err.statusCode).toBe(409);
    expect(logs[0].payload.err.message).toBe('Lead [email] blocked');
  });
});
