/**
 * Unit tests for the external (MKTR Leads) lead-outcome webhook controller.
 *
 * Tests HMAC (body-only) auth, freshness on the signed body timestamp, payload
 * validation, the raw-body size budget, and status-code passthrough in
 * isolation: the externalLeadOutcomeService and Sentry/logger are mocked, and
 * we drive handleExternalLeadOutcome with hand-built req/res objects (no DB,
 * no supertest), mirroring how req.rawBody is set by the verify hook in prod.
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';

const SECRET = 'test-external-outcome-secret';

const processOutcomeMock = jest.fn();
const captureExceptionMock = jest.fn();

jest.unstable_mockModule('../src/services/externalLeadOutcomeService.js', () => ({
  processExternalLeadOutcome: processOutcomeMock,
  MKTR_LEADS_STATUSES: ['new', 'contacted', 'qualified', 'proposed', 'won', 'lost', 'invalid', 'disputed'],
}));
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: captureExceptionMock,
  init: jest.fn(),
  setTag: jest.fn(),
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let handleExternalLeadOutcome;

beforeAll(async () => {
  ({ handleExternalLeadOutcome } = await import('../src/controllers/externalLeadOutcomeController.js'));
});

beforeEach(() => {
  process.env.EXTERNAL_OUTCOME_WEBHOOK_SECRET = SECRET;
  processOutcomeMock
    .mockReset()
    .mockResolvedValue({ statusCode: 200, body: { success: true, appliedLeadStatus: 'won' } });
  captureExceptionMock.mockClear();
});

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Signs the body-only scheme (MKTR_LEADS_PLAN.md §0.8).
function makeReq(bodyObj, { secret = SECRET, signOverride } = {}) {
  const raw = Buffer.from(JSON.stringify(bodyObj));
  const sig = signOverride ?? crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return {
    rawBody: raw,
    body: bodyObj,
    headers: { 'x-webhook-signature': `sha256=${sig}` },
  };
}

function validBody(overrides = {}) {
  return {
    event: 'lead.outcome',
    eventId: 'lead-uuid-1:won',
    timestamp: new Date().toISOString(),
    data: {
      externalId: 'prospect-uuid-1',
      sourceName: 'mktr',
      deliveryId: 'delivery-uuid-1',
      mktrLeadsStatus: 'won',
      ...(overrides.data || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'data')),
  };
}

describe('handleExternalLeadOutcome', () => {
  it('500s when the secret is not configured', async () => {
    delete process.env.EXTERNAL_OUTCOME_WEBHOOK_SECRET;
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody()), res);
    expect(res.statusCode).toBe(500);
    expect(processOutcomeMock).not.toHaveBeenCalled();
  });

  it('500s when rawBody is missing (verify hook not wired)', async () => {
    const req = makeReq(validBody());
    delete req.rawBody;
    const res = makeRes();
    await handleExternalLeadOutcome(req, res);
    expect(res.statusCode).toBe(500);
  });

  it('413s an oversized raw body before any other work', async () => {
    const req = makeReq(validBody());
    req.rawBody = Buffer.alloc(64 * 1024 + 1, 0x7b);
    const res = makeRes();
    await handleExternalLeadOutcome(req, res);
    expect(res.statusCode).toBe(413);
    expect(processOutcomeMock).not.toHaveBeenCalled();
  });

  it('401s on a missing signature header', async () => {
    const req = makeReq(validBody());
    delete req.headers['x-webhook-signature'];
    const res = makeRes();
    await handleExternalLeadOutcome(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401s on a signature made with the wrong secret', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody(), { secret: 'wrong-secret' }), res);
    expect(res.statusCode).toBe(401);
    expect(processOutcomeMock).not.toHaveBeenCalled();
  });

  it('401s on a tampered body', async () => {
    const body = validBody();
    const req = makeReq(body);
    req.body = { ...body, data: { ...body.data, mktrLeadsStatus: 'lost' } };
    req.rawBody = Buffer.from(JSON.stringify(req.body)); // re-serialized, signature now stale
    const res = makeRes();
    await handleExternalLeadOutcome(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401s a stale signed timestamp (> 5 min old)', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(
      makeReq(validBody({ timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString() })),
      res
    );
    expect(res.statusCode).toBe(401);
  });

  it('401s a far-future signed timestamp', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(
      makeReq(validBody({ timestamp: new Date(Date.now() + 3 * 60 * 1000).toISOString() })),
      res
    );
    expect(res.statusCode).toBe(401);
  });

  it('401s a malformed timestamp', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody({ timestamp: 'not-a-date' })), res);
    expect(res.statusCode).toBe(401);
  });

  it('400s an unsupported event', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody({ event: 'lead.created' })), res);
    expect(res.statusCode).toBe(400);
  });

  it('400s a missing eventId', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody({ eventId: '' })), res);
    expect(res.statusCode).toBe(400);
  });

  it('400s a missing data.externalId', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody({ data: { externalId: null } })), res);
    expect(res.statusCode).toBe(400);
  });

  it('400s a status outside the shared contract', async () => {
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody({ data: { mktrLeadsStatus: 'negotiating' } })), res);
    expect(res.statusCode).toBe(400);
    expect(processOutcomeMock).not.toHaveBeenCalled();
  });

  it('dispatches a valid request and returns the service status/body', async () => {
    const body = validBody();
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(body), res);
    expect(processOutcomeMock).toHaveBeenCalledWith({
      event: body.event,
      eventId: body.eventId,
      timestamp: body.timestamp,
      data: body.data,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, appliedLeadStatus: 'won' });
  });

  it('passes through a 422 from the service (unknown prospect stays unstamped)', async () => {
    processOutcomeMock.mockResolvedValue({
      statusCode: 422,
      body: { success: false, error: 'unknown_prospect' },
    });
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody()), res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('unknown_prospect');
  });

  it('500s and reports to Sentry when the service throws', async () => {
    processOutcomeMock.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handleExternalLeadOutcome(makeReq(validBody()), res);
    expect(res.statusCode).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
