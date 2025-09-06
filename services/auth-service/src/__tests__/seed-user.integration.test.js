import request from 'supertest';
import { createApp } from '../../src/server.js';

describe('Dev seed endpoint', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    process.env.SEED_EMAIL = 'test@mktr.sg';
    process.env.SEED_PASSWORD = 'test';
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  it('POST /internal/dev/seed-user returns ok and email', async () => {
    const { app } = await createApp();
    const res = await request(app).post('/internal/dev/seed-user');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, email: 'test@mktr.sg' });
  });

  it('login with seeded creds returns token', async () => {
    const { app } = await createApp();
    await request(app).post('/internal/dev/seed-user');
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'test@mktr.sg', password: 'test' });
    if (process.env.NODE_ENV === 'production') {
      expect([401, 404]).toContain(login.status);
    } else {
      expect(login.status).toBe(200);
      const token = login.body?.token || '';
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    }
  });
});


