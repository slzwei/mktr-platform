/**
 * Unit tests for the external (MKTR Leads) lead-activities controller — HMAC (body-only)
 * auth + freshness, prospectId validation, and the activities pass-through. prospectService
 * + logger are mocked; handlers are driven with hand-built req/res (no DB), the way
 * req.rawBody is set by the /api/external/ verify hook in prod.
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';

const SECRET = 'test-external-app-secret';
const activitiesMock = jest.fn();

jest.unstable_mockModule('../src/services/prospectService.js', () => ({
  getProspectActivities: activitiesMock,
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let listLeadActivities;

beforeAll(async () => {
  ({ listLeadActivities } = await import('../src/controllers/externalLeadActivitiesController.js'));
});

beforeEach(() => {
  process.env.EXTERNAL_APP_SECRET = SECRET;
  activitiesMock.mockReset();
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

describe('externalLeadActivitiesController.listLeadActivities', () => {
  it('rejects a bad signature with 401', async () => {
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1' }, { signOverride: 'sha256=deadbeef' });
    const res = makeRes();
    await listLeadActivities(req, res);
    expect(res.statusCode).toBe(401);
    expect(activitiesMock).not.toHaveBeenCalled();
  });

  it('rejects a stale timestamp with 401', async () => {
    const req = makeReq({ timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), prospectId: 'p1' });
    const res = makeRes();
    await listLeadActivities(req, res);
    expect(res.statusCode).toBe(401);
    expect(activitiesMock).not.toHaveBeenCalled();
  });

  it('400s when prospectId is missing', async () => {
    const req = makeReq({ timestamp: new Date().toISOString() });
    const res = makeRes();
    await listLeadActivities(req, res);
    expect(res.statusCode).toBe(400);
    expect(activitiesMock).not.toHaveBeenCalled();
  });

  it('returns the prospect activities on a valid signed request', async () => {
    activitiesMock.mockResolvedValue([
      { id: 'a1', type: 'created', description: 'Signed up via Instagram ad', actorUserId: null, metadata: {}, createdAt: 't1' },
      { id: 'a2', type: 'updated', description: 'Held — no funded agent', actorUserId: null, metadata: { quarantined: true }, createdAt: 't2' },
    ]);
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1' });
    const res = makeRes();
    await listLeadActivities(req, res);

    expect(activitiesMock).toHaveBeenCalledWith('p1');
    expect(res.statusCode).toBe(null); // res.json without status() → 200 default
    expect(res.body).toMatchObject({ success: true, count: 2 });
    expect(res.body.activities[0]).toMatchObject({ id: 'a1', type: 'created' });
    expect(res.body.activities[1]).toMatchObject({ id: 'a2', type: 'updated' });
  });

  it('500s when the secret is not configured', async () => {
    delete process.env.EXTERNAL_APP_SECRET;
    const req = makeReq({ timestamp: new Date().toISOString(), prospectId: 'p1' });
    const res = makeRes();
    await listLeadActivities(req, res);
    expect(res.statusCode).toBe(500);
  });
});
