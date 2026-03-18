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
    expect(res.body.data.members.length).toBe(2);
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
    expect(res.body.data.members.length).toBe(1);
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

  test('POST without name returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'No name provided', agents: [] });

    expect(res.status).toBe(400);
  });

  test('PUT non-existent group returns 404', async () => {
    const res = await request(app)
      .put('/api/admin/agent-groups/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost Group' });

    expect(res.status).toBe(404);
  });

  test('DELETE non-existent group returns 404', async () => {
    const res = await request(app)
      .delete('/api/admin/agent-groups/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('Unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get('/api/admin/agent-groups');

    expect(res.status).toBe(401);
  });

  test('driver_partner cannot access agent groups', async () => {
    const { token: driverToken } = await createTestUser({ role: 'driver_partner' });

    const res = await request(app)
      .get('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(403);
  });

  test('POST creates group with empty agents array', async () => {
    const res = await request(app)
      .post('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty Group', description: 'No members', agents: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Empty Group');
    expect(res.body.data.members.length).toBe(0);

    // Clean up
    await request(app)
      .delete(`/api/admin/agent-groups/${res.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
  });

  test('PUT updates only description without touching members', async () => {
    // Create a group first
    const createRes = await request(app)
      .post('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Desc Only Update',
        description: 'Original',
        agents: [{ phone: '+6591111111', name: 'Agent A' }]
      });

    expect(createRes.status).toBe(201);
    const gId = createRes.body.data.id;

    // Update only description (no agents field)
    const updateRes = await request(app)
      .put(`/api/admin/agent-groups/${gId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Updated description' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.description).toBe('Updated description');
    // Members should remain unchanged
    expect(updateRes.body.data.members.length).toBe(1);

    // Clean up
    await request(app)
      .delete(`/api/admin/agent-groups/${gId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  test('GET returns groups with creator info', async () => {
    // Create a group
    const createRes = await request(app)
      .post('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Creator Info Test', agents: [] });

    const gId = createRes.body.data.id;

    const res = await request(app)
      .get('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const group = res.body.data.find(g => g.id === gId);
    expect(group).toBeDefined();
    expect(group.creator).toBeDefined();
    expect(group.creator.id).toBe(admin.id);

    // Clean up
    await request(app)
      .delete(`/api/admin/agent-groups/${gId}`)
      .set('Authorization', `Bearer ${token}`);
  });
});
