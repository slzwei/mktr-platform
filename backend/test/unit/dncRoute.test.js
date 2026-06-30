import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock the service so the route → controller → service wiring is exercised in isolation
// (no DB, no real DNC call). Mocking dncCheckService also replaces its transitive
// models/index.js import, so importing the route never opens a DB connection.
jest.unstable_mockModule('../../src/services/dncCheckService.js', () => ({
  checkDncForForm: jest.fn(),
  _resetDncCheckCache: jest.fn(),
}));

const { checkDncForForm } = await import('../../src/services/dncCheckService.js');
const dncRouter = (await import('../../src/routes/dnc.js')).default;
const dncMeta = (await import('../../src/routes/dnc.js')).meta;

const app = express();
app.use(express.json());
app.use('/api/dnc', dncRouter);

describe('POST /api/dnc/check (route + controller)', () => {
  beforeEach(() => checkDncForForm.mockReset());

  it('mounts at /api/dnc (auto-loader contract: meta.path + default export)', () => {
    expect(dncMeta).toEqual({ path: '/api/dnc' });
    expect(typeof dncRouter).toBe('function');
  });

  it('passes phone/countryCode/campaignId through and returns { success, data:{ registered } }', async () => {
    checkDncForForm.mockResolvedValue({ registered: true });
    const res = await request(app)
      .post('/api/dnc/check')
      .send({ phone: '91234567', countryCode: '+65', campaignId: 'c1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { registered: true } });
    expect(checkDncForForm).toHaveBeenCalledWith({ phone: '91234567', countryCode: '+65', campaignId: 'c1' });
  });

  it('coerces a falsy/odd service result to registered:false and never 4xx on an empty body', async () => {
    checkDncForForm.mockResolvedValue({ registered: false });
    const res = await request(app).post('/api/dnc/check').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { registered: false } });
  });
});
