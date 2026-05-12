import request from 'supertest';
import { getApp, closeDb, createTestUser, makeToken } from '../helpers.js';

/**
 * Integration tests for the authentication pipeline.
 *
 * Covers: POST /api/auth/register   (creation, duplicate guard)
 *         POST /api/auth/login      (valid creds, wrong password)
 *         GET  /api/auth/profile    (token-gated)
 *         PUT  /api/auth/profile    (field update)
 *         PUT  /api/auth/change-password (current password check)
 */

const RUN = Date.now();

let app;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';
  app = await getApp();
}, 20000);

afterAll(async () => {
  await closeDb();
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('creates a user and sets the auth cookie (no body token — audit 2.9)', async () => {
    const email = `reg-ok-${RUN}@integ-test.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Str0ngP@ss!',
        firstName: 'Integ',
        lastName: 'Register'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe(email);
    // Password must never leak
    expect(res.body.data.user.password).toBeUndefined();
    // Audit 2.9: token issued via httpOnly cookie, not response body.
    expect(res.body.data.token).toBeUndefined();
    const setCookie = res.headers['set-cookie'] || [];
    expect(setCookie.some((c) => /^mktr_token=/.test(c))).toBe(true);
    expect(setCookie.some((c) => /HttpOnly/i.test(c))).toBe(true);
  });

  it('rejects duplicate email', async () => {
    const email = `reg-dup-${RUN}@integ-test.com`;

    // First registration
    const res1 = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'Pass1234!', firstName: 'First', lastName: 'User' });
    expect(res1.status).toBe(201);

    // Second registration with the same email
    const res2 = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'Pass5678!', firstName: 'Second', lastName: 'User' });

    expect(res2.status).toBe(400);
    expect(res2.body.success).toBe(false);
    expect(res2.body.message).toMatch(/already exists/i);
  });
});

// ── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const loginEmail = `login-${RUN}@integ-test.com`;
  const loginPassword = 'LoginP@ss123!';

  beforeAll(async () => {
    // Seed the user via register endpoint so password hashing is exercised
    await request(app)
      .post('/api/auth/register')
      .send({ email: loginEmail, password: loginPassword, firstName: 'Login', lastName: 'User' });
  });

  it('sets the auth cookie on valid credentials (no body token — audit 2.9)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginEmail, password: loginPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(loginEmail);
    // Audit 2.9: token issued via httpOnly cookie, not response body.
    expect(res.body.data.token).toBeUndefined();
    const setCookie = res.headers['set-cookie'] || [];
    expect(setCookie.some((c) => /^mktr_token=/.test(c))).toBe(true);
    expect(setCookie.some((c) => /HttpOnly/i.test(c))).toBe(true);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginEmail, password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it('returns 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `ghost-${RUN}@integ-test.com`, password: 'Whatever!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ── Profile ──────────────────────────────────────────────────────────────────

describe('GET /api/auth/profile', () => {
  it('returns user data when authenticated', async () => {
    const { user, token } = await createTestUser({ role: 'customer' });

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.email).toBe(user.email);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', 'Bearer totally.invalid.jwt');

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/profile', () => {
  it('updates user fields and returns the updated user', async () => {
    const { user, token } = await createTestUser({ role: 'customer', firstName: 'Old' });

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Updated', phone: '+6598765432' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.firstName).toBe('Updated');
    expect(res.body.data.user.phone).toBe('+6598765432');
  });
});

// ── Change Password ──────────────────────────────────────────────────────────

describe('PUT /api/auth/change-password', () => {
  const cpEmail = `cp-${RUN}@integ-test.com`;
  const cpOldPass = 'OldPassword1!';
  const cpNewPass = 'NewPassword2!';
  let cpToken;

  beforeAll(async () => {
    // Register via HTTP so password hashing is exercised end-to-end.
    // Token is no longer returned in body (audit 2.9 — cookie-only); mint a
    // Bearer token from the response user.id for subsequent requests. The
    // middleware accepts both cookie + Bearer.
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: cpEmail, password: cpOldPass, firstName: 'Change', lastName: 'Pass' });
    cpToken = makeToken(regRes.body.data.user.id);
  });

  it('succeeds when current password is correct', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${cpToken}`)
      .send({ currentPassword: cpOldPass, newPassword: cpNewPass });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the new password actually works
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: cpEmail, password: cpNewPass });
    expect(loginRes.status).toBe(200);
  });

  it('fails when current password is wrong', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${cpToken}`)
      .send({ currentPassword: 'WrongCurrent!', newPassword: 'AnotherNew3!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/incorrect/i);
  });
});
