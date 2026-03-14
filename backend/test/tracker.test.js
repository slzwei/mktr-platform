import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag } from './helpers.js';
import { QrScan, Verification } from '../src/models/index.js';

let app, adminUser, adminToken, campaign, qrTag;

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;
  campaign = await createTestCampaign(adminUser.id);
  qrTag = await createTestQrTag(campaign.id, adminUser.id, {
    slug: `tracker-test-${Date.now()}`
  });
}, 15000);

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Tracker: GET /api/qrcodes/track/:slug
// ---------------------------------------------------------------------------
describe('Tracker — GET /api/qrcodes/track/:slug', () => {
  it('valid slug redirects 302 to /lead-capture with campaign_id and slug', async () => {
    const res = await request(app)
      .get(`/api/qrcodes/track/${qrTag.slug}`)
      .set('User-Agent', 'TestAgent/1.0');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/lead-capture');
    expect(res.headers.location).toContain(`campaign_id=${campaign.id}`);
    expect(res.headers.location).toContain(`slug=${qrTag.slug}`);
  });

  it('non-existent slug redirects 302 to /lead-capture?error=not_found', async () => {
    const res = await request(app)
      .get('/api/qrcodes/track/does-not-exist-999')
      .set('User-Agent', 'TestAgent/1.0');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/lead-capture?error=not_found');
  });

  it('sets atk and sid cookies on successful scan', async () => {
    const res = await request(app)
      .get(`/api/qrcodes/track/${qrTag.slug}`)
      .set('User-Agent', 'TestAgent/1.0');

    expect(res.status).toBe(302);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    expect(cookieStr).toMatch(/atk=/);
    expect(cookieStr).toMatch(/sid=/);
  });

  it('records a QrScan entry in the database', async () => {
    const slug = `scan-record-${Date.now()}`;
    const tag = await createTestQrTag(campaign.id, adminUser.id, { slug });

    const res = await request(app)
      .get(`/api/qrcodes/track/${slug}`)
      .set('User-Agent', 'ScanRecordAgent/1.0');

    expect(res.status).toBe(302);

    const scans = await QrScan.findAll({ where: { qrTagId: tag.id } });
    expect(scans.length).toBeGreaterThanOrEqual(1);
    expect(scans[0].ua).toBe('ScanRecordAgent/1.0');
  });

  it('marks duplicate scan from same IP+UA within 2 minutes', async () => {
    const slug = `dedup-${Date.now()}`;
    const tag = await createTestQrTag(campaign.id, adminUser.id, { slug });

    // First scan
    await request(app)
      .get(`/api/qrcodes/track/${slug}`)
      .set('User-Agent', 'DedupAgent/1.0');

    // Second scan — same UA (supertest uses same loopback IP)
    await request(app)
      .get(`/api/qrcodes/track/${slug}`)
      .set('User-Agent', 'DedupAgent/1.0');

    const scans = await QrScan.findAll({
      where: { qrTagId: tag.id },
      order: [['ts', 'ASC']]
    });

    expect(scans.length).toBe(2);
    expect(scans[0].isDuplicate).toBe(false);
    expect(scans[1].isDuplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tracker session: GET /api/qrcodes/session
// ---------------------------------------------------------------------------
describe('Tracker — GET /api/qrcodes/session', () => {
  it('without sid cookie returns { data: null }', async () => {
    const res = await request(app)
      .get('/api/qrcodes/session');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it('with valid sid that has attribution returns qrTagId and campaignId', async () => {
    const slug = `session-${Date.now()}`;
    const tag = await createTestQrTag(campaign.id, adminUser.id, { slug });

    // Scan to get atk + sid cookies
    const scanRes = await request(app)
      .get(`/api/qrcodes/track/${slug}`)
      .set('User-Agent', 'SessionAgent/1.0');

    // Extract cookies from scan response
    const cookies = scanRes.headers['set-cookie'];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map(c => c.split(';')[0]).join('; ')
      : cookies.split(';')[0];

    // Call /session with those cookies — this triggers atk binding to sid
    const sessionRes = await request(app)
      .get('/api/qrcodes/session')
      .set('Cookie', cookieHeader);

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.success).toBe(true);
    expect(sessionRes.body.data).not.toBeNull();
    expect(sessionRes.body.data.qrTagId).toBe(tag.id);
    expect(sessionRes.body.data.campaignId).toBe(campaign.id);
  });
});

// ---------------------------------------------------------------------------
// Verify: POST /api/verify/send  and  POST /api/verify/check
// ---------------------------------------------------------------------------
describe('Verify — POST /api/verify/send', () => {
  it('returns 400 when phone is missing', async () => {
    const res = await request(app)
      .post('/api/verify/send')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/phone/i);
  });

  it('returns 400 for non-SG country code', async () => {
    const res = await request(app)
      .post('/api/verify/send')
      .send({ phone: '12345678', countryCode: '+1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/singapore/i);
  });
});

describe('Verify — POST /api/verify/check', () => {
  it('returns 400 when phone or code is missing', async () => {
    const res = await request(app)
      .post('/api/verify/check')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/phone.*code/i);
  });

  it('returns 400 with "Invalid verification code" for wrong code', async () => {
    // Seed a verification record directly
    const phone = `+6590${Date.now().toString().slice(-6)}`;
    await Verification.upsert({
      phone,
      code: '123456',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0
    });

    const res = await request(app)
      .post('/api/verify/check')
      .send({ phone: phone.replace('+65', ''), code: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid verification code/i);
  });

  it('returns 400 with "expired" for expired code', async () => {
    const phone = `+6591${Date.now().toString().slice(-6)}`;
    await Verification.upsert({
      phone,
      code: '654321',
      expiresAt: new Date(Date.now() - 1000), // already expired
      attempts: 0
    });

    const res = await request(app)
      .post('/api/verify/check')
      .send({ phone: phone.replace('+65', ''), code: '654321' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });
});
