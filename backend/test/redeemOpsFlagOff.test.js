/**
 * Dark-launch guarantee: with REDEEM_OPS_ENABLED unset, the entire
 * /api/redeem-ops namespace does not exist (auto-loader skips the mount —
 * routes/index.js flag gating). This is the "flag-off → production unchanged"
 * assertion from docs/redeem-ops/IMPLEMENTATION_PLAN.md Phase 1.
 */
delete process.env.REDEEM_OPS_ENABLED; // must be unset before getApp() mounts routes

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';

let app;

beforeAll(async () => {
  app = await getApp();
});

afterAll(async () => {
  await closeDb();
});

describe('REDEEM_OPS_ENABLED unset', () => {
  test('the namespace is unmounted — 404 even for an admin', async () => {
    const { token } = await createTestUser({ role: 'admin' });
    const res = await request(app)
      .get('/api/redeem-ops/meta/constants')
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
  });
});
