import request from 'supertest';
import { app } from '../server.js';

describe('JWT claim shape', () => {
  it('login issues token with required claims', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
    expect(res.status).toBe(200);
    const token = res.body?.token || res.body?.data?.token;
    expect(typeof token).toBe('string');
    // We only check decodability and header alg RS256 minimally; jose verification would require JWKS fetch
    const [headerB64, payloadB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    expect(header.alg).toBe('RS256');
    for (const key of ['iss','aud','sub','tid','roles','email','exp']) {
      expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(true);
    }
    expect(Array.isArray(payload.roles)).toBe(true);
    expect(typeof payload.exp).toBe('number');
  });
});


