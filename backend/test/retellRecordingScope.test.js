/**
 * P1-4 regression: call recordings are owner-scoped.
 *
 * GET /api/retell/recording/:prospectId was gated by authenticateToken ONLY,
 * and the service did a bare `Prospect.findByPk(prospectId)` — the one prospect
 * fetch in the domain that skipped buildProspectWhere. Any authenticated
 * principal, including a self-registered customer, could walk prospect UUIDs
 * and receive PDPA-regulated recording URLs (which the route then caches).
 *
 * The route now carries the same role gate as the other prospect reads and the
 * lookup runs through the scope filter, so out-of-scope prospects are
 * indistinguishable from missing ones.
 */
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';

const RECORDING_URL = 'https://recordings.retell.ai/call-p1-4.mp3';

let app, admin, owner, otherAgent, customer, prospect;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  owner = await createTestUser({ role: 'agent' });
  otherAgent = await createTestUser({ role: 'agent' });
  customer = await createTestUser({ role: 'customer' });

  const campaign = await createTestCampaign(admin.user.id, { name: 'Recording Scope Campaign' });
  prospect = await createTestProspect(campaign.id, {
    assignedAgentId: owner.user.id,
    leadSource: 'call_bot',
    sourceMetadata: { retellCallId: 'call-p1-4', recordingUrl: RECORDING_URL },
  });
});

afterAll(async () => { await closeDb(); });

const get = (token) => request(app)
  .get(`/api/retell/recording/${prospect.id}`)
  .set('Authorization', `Bearer ${token}`);

describe('GET /api/retell/recording/:prospectId', () => {
  it('gives the owning agent the recording', async () => {
    const res = await get(owner.token);
    expect(res.status).toBe(200);
    expect(res.body.recordingUrl).toBe(RECORDING_URL);
  });

  it('gives an admin the recording', async () => {
    const res = await get(admin.token);
    expect(res.status).toBe(200);
    expect(res.body.recordingUrl).toBe(RECORDING_URL);
  });

  it('does not leak the recording to a different agent', async () => {
    const res = await get(otherAgent.token);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(RECORDING_URL);
  });

  it('refuses a customer session outright', async () => {
    const res = await get(customer.token);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(RECORDING_URL);
  });

  it('still requires authentication', async () => {
    const res = await request(app).get(`/api/retell/recording/${prospect.id}`);
    expect(res.status).toBe(401);
  });
});
