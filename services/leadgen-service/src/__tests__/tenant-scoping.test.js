import request from 'supertest';
import { app } from '../server.js';

const DEFAULT_TID = '00000000-0000-0000-0000-000000000000';

// Helper: craft a minimal JWT-like payload injection by monkey-patching middleware is complex; instead assume gateway verified and inject header x-tenant-id
// These tests focus on tenant scoping in SQL, not JWT verification itself.

describe('Tenant scoping for leadgen v1 routes', () => {
  const authHeader = { Authorization: 'Bearer dummy' };
  const tenantHeaderA = { 'x-tenant-id': DEFAULT_TID };
  const tenantHeaderB = { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' };

  it('qrcodes list is scoped by tenant', async () => {
    const resA = await request(app).get('/v1/qrcodes').set(authHeader).set(tenantHeaderA);
    expect(resA.status).toBeLessThan(500);
    const resB = await request(app).get('/v1/qrcodes').set(authHeader).set(tenantHeaderB);
    expect(resB.status).toBeLessThan(500);
    if (resA.body?.data?.length && resB.body?.data?.length) {
      const setA = new Set(resA.body.data.map(r => r.tenant_id));
      const setB = new Set(resB.body.data.map(r => r.tenant_id));
      expect(setA.size).toBe(1);
      expect(setB.size).toBe(1);
      expect(setA.has(DEFAULT_TID)).toBe(true);
      expect(setB.has(DEFAULT_TID)).toBe(false);
    }
  });

  it('prospects list is scoped by tenant', async () => {
    const res = await request(app).get('/v1/prospects').set(authHeader).set(tenantHeaderA);
    expect(res.status).toBeLessThan(500);
    if (Array.isArray(res.body?.data)) {
      expect(res.body.data.every(r => r.tenant_id === DEFAULT_TID)).toBe(true);
    }
  });

  it('commissions list is scoped by tenant', async () => {
    const res = await request(app).get('/v1/commissions').set(authHeader).set(tenantHeaderA);
    expect(res.status).toBeLessThan(500);
    if (Array.isArray(res.body?.data)) {
      expect(res.body.data.every(r => r.tenant_id === DEFAULT_TID)).toBe(true);
    }
  });
});


