import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticateToken: (_req, _res, next) => next(),
}));

const allow = (_req, res) => res.sendStatus(204);
jest.unstable_mockModule('../src/controllers/redeemOps/discoveryController.js', () => ({
  startDiscovery: allow,
  suggestTerms: allow,
  listRuns: allow,
  getRun: allow,
  enrichCandidates: allow,
  addToPartners: allow,
  dismissCandidate: allow,
  webhook: allow,
}));

const { default: router } = await import('../src/routes/redeemOpsDiscovery.js');

const USERS = {
  admin: { role: 'admin' },
  super_admin: { role: 'redeem_ops', redeemOpsRole: 'super_admin' },
  ops_admin: { role: 'redeem_ops', redeemOpsRole: 'ops_admin' },
  bdm: { role: 'redeem_ops', redeemOpsRole: 'bdm' },
  outreach_exec: { role: 'redeem_ops', redeemOpsRole: 'outreach_exec' },
  campaign_ops: { role: 'redeem_ops', redeemOpsRole: 'campaign_ops' },
  redemption_ops: { role: 'redeem_ops', redeemOpsRole: 'redemption_ops' },
  analyst: { role: 'redeem_ops', redeemOpsRole: 'analyst' },
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = USERS[req.get('x-test-user')];
  next();
});
app.use('/api/redeem-ops', router);

const paidRoutes = [
  ['search', '/api/redeem-ops/discovery/runs'],
  ['search', '/api/redeem-ops/discovery/suggest-terms'],
  ['enrich', '/api/redeem-ops/discovery/candidates/enrich'],
];

describe('Redeem Ops discovery route capabilities', () => {
  test.each(['campaign_ops', 'redemption_ops', 'analyst'])(
    '%s is forbidden from paid discovery mutations',
    async (role) => {
      for (const [, url] of paidRoutes) {
        await request(app).post(url).set('x-test-user', role).send({}).expect(403);
      }
    }
  );

  test.each(['admin', 'super_admin', 'ops_admin', 'bdm', 'outreach_exec'])(
    '%s is allowed through both paid discovery gates',
    async (role) => {
      for (const [, url] of paidRoutes) {
        await request(app).post(url).set('x-test-user', role).send({}).expect(204);
      }
    }
  );

  test.each(Object.keys(USERS))('%s retains read and dismiss access', async (role) => {
    const headers = { 'x-test-user': role };
    await request(app).get('/api/redeem-ops/discovery/runs').set(headers).expect(204);
    await request(app).get('/api/redeem-ops/discovery/runs/run-id').set(headers).expect(204);
    await request(app)
      .patch('/api/redeem-ops/discovery/candidates/candidate-id')
      .set(headers)
      .send({})
      .expect(204);
  });
});
