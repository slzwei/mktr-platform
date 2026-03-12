import './setup.js';
import { getApp, closeDb, createTestUser } from './helpers.js';
import request from 'supertest';

let app, admin, token;

beforeAll(async () => {
  app = await getApp();
  const result = await createTestUser({ role: 'admin' });
  admin = result.user;
  token = result.token;
});

afterAll(async () => {
  await closeDb();
});

describe('Agent Groups API', () => {
  let groupId;

  test('POST /api/admin/agent-groups — create group', async () => {
    const res = await request(app)
      .post('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Team',
        description: 'A test agent group',
        agents: [
          { phone: '+6591234567', email: 'agent1@test.com', name: 'Agent One' },
          { phone: '+6598765432', email: 'agent2@test.com', name: 'Agent Two' }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Test Team');
    expect(res.body.data.agentCount).toBe(2);
    groupId = res.body.data.id;
  });

  test('GET /api/admin/agent-groups — list groups', async () => {
    const res = await request(app)
      .get('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('PUT /api/admin/agent-groups/:id — update group', async () => {
    const res = await request(app)
      .put(`/api/admin/agent-groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Team',
        agents: [
          { phone: '+6591234567', email: 'agent1@test.com', name: 'Agent One' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Team');
    expect(res.body.data.agentCount).toBe(1);
  });

  test('DELETE /api/admin/agent-groups/:id — delete group', async () => {
    const res = await request(app)
      .delete(`/api/admin/agent-groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('Requires admin auth', async () => {
    const { token: agentToken } = await createTestUser({ role: 'agent' });

    const res = await request(app)
      .get('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(403);
  });
});
