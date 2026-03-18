import './setup.js';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import request from 'supertest';

let app, admin, _token, campaign;

beforeAll(async () => {
  app = await getApp();
  const result = await createTestUser({ role: 'admin' });
  admin = result.user;
  _token = result.token;
  campaign = await createTestCampaign(admin.id);
});

afterAll(async () => {
  await closeDb();
});

describe('Phone E.164 Validation', () => {
  test('Accepts valid E.164 phone number', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test', lastName: 'User',
        email: `e164-valid-${Date.now()}@test.com`,
        phone: '+6591234567',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.phone).toBe('+6591234567');
  });

  test('Accepts valid E.164 with other country codes', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test US', lastName: 'User',
        email: `e164-us-${Date.now()}@test.com`,
        phone: '+14155551234',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
  });

  test('Accepts raw digits phone (backward compat, normalized to E.164)', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test', lastName: 'User',
        email: `rawdigits-${Date.now()}@test.com`,
        phone: '81112222',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    // Service normalizes 8-digit SG number to +65XXXXXXXX
    expect(res.body.data.prospect.phone).toBe('+6581112222');
  });

  test('Rejects phone with too few digits', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test', lastName: 'User',
        email: `short-phone-${Date.now()}@test.com`,
        phone: '123',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(400);
  });

  test('Rejects phone with letters', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test', lastName: 'User',
        email: `letters-phone-${Date.now()}@test.com`,
        phone: 'not-a-phone',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(400);
  });

  test('Accepts prospect without phone (phone is optional)', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'No Phone', lastName: 'User',
        email: `no-phone-${Date.now()}@test.com`,
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
  });

  test('Normalizes 10-digit SG number starting with 65 to +65XXXXXXXX', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test', lastName: 'SG65',
        email: `sg65-${Date.now()}@test.com`,
        phone: '6591234567',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.phone).toBe('+6591234567');
  });

  test('Rejects phone with special characters (not digits or +)', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Test', lastName: 'Special',
        email: `special-phone-${Date.now()}@test.com`,
        phone: '+65-9123-4567!',
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(400);
  });
});
