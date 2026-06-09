/**
 * Unit tests for the Lyfe lead-outcome webhook controller.
 *
 * Tests HMAC/timestamp auth, payload validation, and the always-200 dispatch
 * contract in isolation: the leadOutcomeService and Sentry/logger are mocked,
 * and we drive handleLyfeLeadOutcome with hand-built req/res objects (no DB,
 * no supertest), mirroring how req.rawBody is set by the verify hook in prod.
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';

const SECRET = 'test-lead-outcome-secret';

const processLeadOutcomeMock = jest.fn();
const captureExceptionMock = jest.fn();

jest.unstable_mockModule('../src/services/leadOutcomeService.js', () => ({
  processLeadOutcome: processLeadOutcomeMock,
}));
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: captureExceptionMock,
  init: jest.fn(),
  setTag: jest.fn(),
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let handleLyfeLeadOutcome;

beforeAll(async () => {
  ({ handleLyfeLeadOutcome } = await import('../src/controllers/lyfeLeadOutcomeController.js'));
});

beforeEach(() => {
  process.env.LYFE_LEAD_OUTCOME_SECRET = SECRET;
  processLeadOutcomeMock.mockReset().mockResolvedValue({ action: 'dispatched', eventName: 'QualifiedLead' });
  captureExceptionMock.mockClear();
});

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function makeReq(bodyObj, { secret = SECRET, timestamp, signOverride } = {}) {
  const raw = Buffer.from(JSON.stringify(bodyObj));
  const ts = timestamp ?? new Date().toISOString();
  const sig = signOverride ?? crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return {
    rawBody: raw,
    body: bodyObj,
    headers: {
      'x-webhook-signature': `sha256=${sig}`,
      'x-webhook-timestamp': ts,
    },
  };
}

const validBody = {
  external_id: 'prospect-uuid-1',
  lead_id: 'lyfe-lead-1',
  new_status: 'qualified',
  old_status: 'contacted',
  agent_id: 'agent-1',
  occurred_at: '2026-06-09T10:00:00Z',
};

describe('handleLyfeLeadOutcome', () => {
  it('500s when the secret is not configured', async () => {
    delete process.env.LYFE_LEAD_OUTCOME_SECRET;
    const req = makeReq(validBody);
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(500);
  });

  it('500s when rawBody is missing (verify hook not wired)', async () => {
    const req = makeReq(validBody);
    delete req.rawBody;
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(500);
  });

  it('401s on a bad signature', async () => {
    const req = makeReq(validBody, { signOverride: 'deadbeef'.repeat(8) });
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(401);
    expect(processLeadOutcomeMock).not.toHaveBeenCalled();
  });

  it('401s on a signature computed with the wrong secret', async () => {
    const req = makeReq(validBody, { secret: 'wrong-secret' });
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401s on a malformed signature header', async () => {
    const req = makeReq(validBody);
    req.headers['x-webhook-signature'] = 'not-sha256-prefixed';
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401s when the timestamp is outside the ±5min window', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const req = makeReq(validBody, { timestamp: stale });
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('400s when external_id is missing', async () => {
    const { external_id, ...rest } = validBody;
    const req = makeReq(rest);
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('200 no-op for an unhandled status (does not call the service)', async () => {
    const req = makeReq({ ...validBody, new_status: 'contacted' });
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBe('unhandled_status');
    expect(processLeadOutcomeMock).not.toHaveBeenCalled();
  });

  it('200 and delegates to the service on a valid qualified event', async () => {
    const req = makeReq(validBody);
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, action: 'dispatched', eventName: 'QualifiedLead' });
    expect(processLeadOutcomeMock).toHaveBeenCalledWith(validBody);
  });

  it('still returns 200 (not 5xx) if the service throws — no pg_net retry storm', async () => {
    processLeadOutcomeMock.mockRejectedValueOnce(new Error('boom'));
    const req = makeReq(validBody);
    const res = makeRes();
    await handleLyfeLeadOutcome(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBe('error');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
