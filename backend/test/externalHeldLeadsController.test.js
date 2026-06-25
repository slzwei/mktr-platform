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

const listHeldMock = jest.fn();
const releaseMock = jest.fn();

jest.unstable_mockModule('../src/services/prospectService.js', () => ({
  listHeldProspects: listHeldMock,
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
  listHeldMock.mockReset();
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
    expect(listHeldMock).not.toHaveBeenCalled();
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
  it('returns only no_funded_agent holds, masked', async () => {
    listHeldMock.mockResolvedValue({
      count: 2,
      held: [
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', phone: '6591234567', email: 'j@x', leadSource: 'meta', campaignId: 'c1', campaignName: 'Cab', quarantineReason: 'no_funded_agent', quarantinedAt: 't', createdAt: 't' },
        { id: 'p2', firstName: 'Ext', lastName: 'Buyer', phone: '6599999999', quarantineReason: 'no_funded_external_buyer', campaignId: 'c1' },
      ],
    });
    const req = makeReq({ timestamp: new Date().toISOString() });
    const res = makeRes();
    await listHeldLeads(req, res);

    expect(res.statusCode).toBe(null); // res.json without status() → 200 default
    expect(res.body.count).toBe(1); // external-buyer hold filtered out
    const row = res.body.held[0];
    expect(row).toMatchObject({ id: 'p1', firstName: 'Jane', lastInitial: 'D', maskedPhone: '••••4567', campaignName: 'Cab' });
    expect(row.email).toBeUndefined(); // email not exposed
    expect(row.lastName).toBeUndefined(); // full surname not exposed
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
  ])('maps %s → %i', async (status, code) => {
    releaseMock.mockResolvedValue({ status });
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1', agentMktrUserId: 'a1' });
    const res = makeRes();
    await assignHeldLead(req, res);
    expect(res.statusCode).toBe(code);
  });

  it('400s when prospectId or agentMktrUserId is missing', async () => {
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1' });
    const res = makeRes();
    await assignHeldLead(req, res);
    expect(res.statusCode).toBe(400);
    expect(releaseMock).not.toHaveBeenCalled();
  });
});
