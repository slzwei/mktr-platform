import request from 'supertest';
import { createApp } from '../server.js';
import { generateKeyPair, exportPKCS8, importJWK, jwtVerify } from 'jose';

describe('Persistent RSA key: restart token validity', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment variables to avoid bleeding between tests
    process.env = { ...originalEnv };
  });

  it('token issued before restart verifies against JWKS after restart', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const pem = await exportPKCS8(privateKey);

    process.env.AUTH_PRIVATE_KEY_PEM = pem;
    process.env.KID = 'test-kid-restart';

    const { app: app1 } = await createApp();

    const loginRes = await request(app1)
      .post('/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'admin' });

    expect(loginRes.status).toBe(200);
    const token = loginRes.body?.token || loginRes.body?.data?.token;
    expect(typeof token).toBe('string');

    // Simulate restart by creating a new app with the same env
    const { app: app2 } = await createApp();

    const jwksRes = await request(app2).get('/.well-known/jwks.json');
    expect(jwksRes.status).toBe(200);
    expect(Array.isArray(jwksRes.body.keys)).toBe(true);
    expect(jwksRes.body.keys.length).toBeGreaterThan(0);
    const jwk = jwksRes.body.keys[0];
    expect(jwk.alg).toBe('RS256');
    expect(jwk.kid).toBe('test-kid-restart');

    const publicKey = await importJWK(jwk, 'RS256');
    const { payload, protectedHeader } = await jwtVerify(token, publicKey);
    expect(protectedHeader.kid).toBe('test-kid-restart');
    expect(payload.sub).toBe('user-1');
  });
});


