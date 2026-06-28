/**
 * Unit tests for the external (MKTR Leads) held-lead dispatch controller.
 *
 * Tests HMAC (body-only) auth + freshness, the held-list PII masking, and the
 * assign status→HTTP-code mapping in isolation: prospectService + logger are
 * mocked and we drive the handlers with hand-built req/res objects (no DB), the
 * way req.rawBody is set by the /api/external/ verify hook in prod.
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';

const SECRET = 'test-external-app-secret';

const orphansMock = jest.fn();
const releaseMock = jest.fn();

jest.unstable_mockModule('../src/services/prospectService.js', () => ({
  listDispatchableOrphans: orphansMock,
  releaseHeldProspect: releaseMock,
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let listHeldLeads, assignHeldLead;

beforeAll(async () => {
  ({ listHeldLeads, assignHeldLead } = await import('../src/controllers/externalHeldLeadsController.js'));
});

beforeEach(() => {
  process.env.EXTERNAL_APP_SECRET = SECRET;
  orphansMock.mockReset();
  releaseMock.mockReset();
});

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function makeReq(bodyObj, { secret = SECRET, signOverride } = {}) {
  const raw = Buffer.from(JSON.stringify(bodyObj));
  const sig = signOverride ?? crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { rawBody: raw, body: bodyObj, headers: { 'x-webhook-signature': `sha256=${sig}` } };
}

describe('externalHeldLeadsController — auth', () => {
  it('rejects a bad signature with 401', async () => {
    const req = makeReq({ timestamp: new Date().toISOString() }, { signOverride: 'sha256=deadbeef' });
    const res = makeRes();
    await listHeldLeads(req, res);
    expect(res.statusCode).toBe(401);
    expect(orphansMock).not.toHaveBeenCalled();
  });

  it('rejects a stale timestamp with 401', async () => {
    const req = makeReq({ timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    const res = makeRes();
    await assignHeldLead(req, res);
    expect(res.statusCode).toBe(401);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('500s when the secret is not configured', async () => {
    delete process.env.EXTERNAL_APP_SECRET;
    const req = makeReq({ timestamp: new Date().toISOString() });
    const res = makeRes();
    await listHeldLeads(req, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('externalHeldLeadsController.listHeldLeads', () => {
  it('surfaces held + System-Agent orphans with masked + full PII and reason/since', async () => {
    orphansMock.mockResolvedValue({
      count: 2,
      orphans: [
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', phone: '6591234567', email: 'jane@example.com', leadSource: 'meta', campaignId: 'c1', campaignName: 'Cab', reason: 'no_funded_agent', since: 't1', createdAt: 't1' },
        { id: 'p2', firstName: 'Sam', lastName: 'Lim', phone: '6599999999', leadSource: 'meta', campaignId: 'c1', campaignName: 'Cab', reason: 'unassigned', since: 't2', createdAt: 't2' },
      ],
    });
    const req = makeReq({ timestamp: new Date().toISOString() });
    const res = makeRes();
    await listHeldLeads(req, res);

    expect(res.statusCode).toBe(null); // res.json without status() → 200 default
    expect(orphansMock).toHaveBeenCalledWith({ campaignId: undefined, limit: 50 });
    expect(res.body.count).toBe(2);
    const [a, b] = res.body.held;
    expect(a).toMatchObject({ id: 'p1', firstName: 'Jane', lastInitial: 'D', maskedPhone: '••••4567', campaignName: 'Cab', reason: 'no_funded_agent', since: 't1' });
    expect(b).toMatchObject({ id: 'p2', reason: 'unassigned' });
    // Full PII is now returned ADDITIVELY (admin-only surface) alongside the masked fields.
    expect(a).toMatchObject({ lastName: 'Doe', phone: '6591234567', email: 'jane@example.com' });
    expect(a.maskedPhone).toBe('••••4567'); // masked field retained for back-compat
  });

  it('summary mode returns ids + campaign + since ONLY (no PII enters the sweep path)', async () => {
    orphansMock.mockResolvedValue({
      count: 1,
      orphans: [
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', phone: '6591234567', email: 'jane@example.com', leadSource: 'meta', campaignId: 'c1', campaignName: 'Cab', reason: 'no_funded_agent', since: 't1', createdAt: 't1' },
      ],
    });
    const req = makeReq({ timestamp: new Date().toISOString(), summary: true });
    const res = makeRes();
    await listHeldLeads(req, res);

    expect(res.body.count).toBe(1);
    const [a] = res.body.held;
    expect(a).toEqual({ id: 'p1', campaignName: 'Cab', since: 't1' });
    // The cron sweep must never receive lead PII.
    expect(a.firstName).toBeUndefined();
    expect(a.lastName).toBeUndefined();
    expect(a.phone).toBeUndefined();
    expect(a.maskedPhone).toBeUndefined();
    expect(a.email).toBeUndefined();
  });
});

describe('externalHeldLeadsController.assignHeldLead', () => {
  it('maps service statuses to HTTP codes and passes the idempotency key', async () => {
    releaseMock.mockResolvedValue({ status: 'assigned', leadId: 'p1', agent: { firstName: 'Hui', lastName: 'Xin' } });
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1', agentMktrUserId: 'app-agent-1', idempotencyKey: 'k1' });
    const res = makeRes();
    await assignHeldLead(req, res);

    expect(releaseMock).toHaveBeenCalledWith('p1', 'app-agent-1', { idempotencyKey: 'k1', actorUserId: null });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'assigned', leadId: 'p1' });
  });

  it.each([
    ['already_handled', 200],
    ['invalid_agent', 400],
    ['not_found', 404],
    ['not_assignable_external', 409],
    ['undeliverable', 503],
  ])('maps %s → %i', async (status, code) => {
    releaseMock.mockResolvedValue({ status });
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1', agentMktrUserId: 'a1', idempotencyKey: 'k' });
    const res = makeRes();
    await assignHeldLead(req, res);
    expect(res.statusCode).toBe(code);
  });

  it('400s when prospectId or agentMktrUserId is missing', async () => {
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1', idempotencyKey: 'k' });
    const res = makeRes();
    await assignHeldLead(req, res);
    expect(res.statusCode).toBe(400);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('400s when idempotencyKey is missing (mandatory replay contract)', async () => {
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1', agentMktrUserId: 'a1' });
    const res = makeRes();
    await assignHeldLead(req, res);
    expect(res.statusCode).toBe(400);
    expect(releaseMock).not.toHaveBeenCalled();
  });
});
