import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'

let app

// Shared user tokens by role
const tokens = {}

beforeAll(async () => {
  app = await getApp()

  // Create one user per role and cache their tokens
  const roles = ['admin', 'agent', 'customer', 'driver_partner', 'fleet_owner']
  for (const role of roles) {
    const { user, token } = await createTestUser({ role })
    tokens[role] = { user, token }
  }
}, 20000)

afterAll(async () => {
  await closeDb()
})

// ---------------------------------------------------------------------------
// Helper: run a single authorization test
// ---------------------------------------------------------------------------
function expectForbidden(method, path, token) {
  const m = method.toLowerCase();
  return request(app)[m](path)
    .set('Authorization', `Bearer ${token}`)
    .send(method === 'POST' || method === 'PUT' || method === 'PATCH' ? { name: 'test' } : undefined)
    .then(res => {
      expect([401, 403]).toContain(res.status)
    })
}

// ---------------------------------------------------------------------------
// Admin-only endpoints — should return 403 for non-admin roles
// ---------------------------------------------------------------------------
describe('Admin-only endpoints reject non-admin roles', () => {
  const adminEndpoints = [
    { method: 'GET',    path: '/api/users' },
    { method: 'POST',   path: '/api/users' },
    { method: 'POST',   path: '/api/users/invite' },
    { method: 'POST',   path: '/api/users/bulk-delete' },
    { method: 'DELETE', path: '/api/users/00000000-0000-0000-0000-000000000001' },
    { method: 'PATCH',  path: '/api/users/00000000-0000-0000-0000-000000000001/status' },
    { method: 'PATCH',  path: '/api/users/00000000-0000-0000-0000-000000000001/approval' },
    { method: 'GET',    path: '/api/agents' },
    { method: 'GET',    path: '/api/agents/leaderboard/performance' },
    { method: 'POST',   path: '/api/agents/invite' },
    { method: 'POST',   path: '/api/commissions' },
    { method: 'GET',    path: '/api/commissions/agents/00000000-0000-0000-0000-000000000001/summary' },
    { method: 'PATCH',  path: '/api/commissions/00000000-0000-0000-0000-000000000001/approve' },
    { method: 'PATCH',  path: '/api/commissions/00000000-0000-0000-0000-000000000001/pay' },
    { method: 'PATCH',  path: '/api/commissions/bulk/approve' },
    { method: 'PUT',    path: '/api/commissions/00000000-0000-0000-0000-000000000001' },
    { method: 'POST',   path: '/api/fleet/owners' },
    { method: 'PUT',    path: '/api/fleet/owners/00000000-0000-0000-0000-000000000001' },
    { method: 'DELETE', path: '/api/fleet/owners/00000000-0000-0000-0000-000000000001' },
    { method: 'POST',   path: '/api/qrcodes' },
    { method: 'PUT',    path: '/api/qrcodes/00000000-0000-0000-0000-000000000001' },
    { method: 'DELETE', path: '/api/qrcodes/00000000-0000-0000-0000-000000000001' },
    { method: 'POST',   path: '/api/qrcodes/bulk' },
    { method: 'DELETE', path: '/api/campaigns/00000000-0000-0000-0000-000000000001/permanent' },
    { method: 'GET',    path: '/api/devices' },
    { method: 'PATCH',  path: '/api/devices/00000000-0000-0000-0000-000000000001' },
  ]

  const nonAdminRoles = ['agent', 'customer', 'driver_partner', 'fleet_owner']

  for (const endpoint of adminEndpoints) {
    for (const role of nonAdminRoles) {
      it(`${endpoint.method} ${endpoint.path} returns 403 for ${role}`, async () => {
        await expectForbidden(endpoint.method, endpoint.path, tokens[role].token)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Agent-or-Admin endpoints — should return 403 for customer, driver_partner, fleet_owner
// ---------------------------------------------------------------------------
describe('Agent-or-Admin endpoints reject unauthorized roles', () => {
  const agentOrAdminEndpoints = [
    { method: 'POST',   path: '/api/campaigns' },
    { method: 'PUT',    path: '/api/campaigns/00000000-0000-0000-0000-000000000001' },
    { method: 'DELETE', path: '/api/campaigns/00000000-0000-0000-0000-000000000001' },
    { method: 'PATCH',  path: '/api/campaigns/00000000-0000-0000-0000-000000000001/metrics' },
    { method: 'POST',   path: '/api/campaigns/00000000-0000-0000-0000-000000000001/duplicate' },
    { method: 'PATCH',  path: '/api/campaigns/00000000-0000-0000-0000-000000000001/archive' },
    { method: 'PATCH',  path: '/api/campaigns/00000000-0000-0000-0000-000000000001/restore' },
    { method: 'PUT',    path: '/api/prospects/00000000-0000-0000-0000-000000000001' },
    { method: 'DELETE', path: '/api/prospects/00000000-0000-0000-0000-000000000001' },
    { method: 'PATCH',  path: '/api/prospects/bulk/assign' },
    { method: 'GET',    path: '/api/prospects/stats/overview' },
    { method: 'GET',    path: '/api/users/stats/overview' },
    { method: 'GET',    path: '/api/users/agents/list' },
    { method: 'GET',    path: '/api/commissions/stats/overview' },
    { method: 'GET',    path: '/api/dashboard/analytics' },
    { method: 'POST',   path: '/api/lead-packages' },
    { method: 'POST',   path: '/api/lead-packages/assign' },
  ]

  const forbiddenRoles = ['customer', 'driver_partner', 'fleet_owner']

  for (const endpoint of agentOrAdminEndpoints) {
    for (const role of forbiddenRoles) {
      it(`${endpoint.method} ${endpoint.path} returns 403 for ${role}`, async () => {
        await expectForbidden(endpoint.method, endpoint.path, tokens[role].token)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Driver/Fleet-specific endpoints — reject wrong roles
// ---------------------------------------------------------------------------
describe('Driver-specific endpoints reject non-driver roles', () => {
  const driverEndpoints = [
    { method: 'GET', path: '/api/dashboard/driver/scans' },
    { method: 'GET', path: '/api/dashboard/driver/commissions' },
  ]

  const forbiddenRoles = ['agent', 'customer', 'fleet_owner']

  for (const endpoint of driverEndpoints) {
    for (const role of forbiddenRoles) {
      it(`${endpoint.method} ${endpoint.path} returns 403 for ${role}`, async () => {
        await expectForbidden(endpoint.method, endpoint.path, tokens[role].token)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Admin webhook endpoints — reject all non-admin roles
// ---------------------------------------------------------------------------
describe('Webhook admin endpoints reject non-admin roles', () => {
  const webhookEndpoints = [
    { method: 'GET',    path: '/api/admin/webhooks/subscribers' },
    { method: 'POST',   path: '/api/admin/webhooks/subscribers' },
    { method: 'GET',    path: '/api/admin/webhooks/deliveries' },
    { method: 'GET',    path: '/api/admin/webhooks/stats' },
  ]

  const nonAdminRoles = ['agent', 'customer', 'driver_partner', 'fleet_owner']

  for (const endpoint of webhookEndpoints) {
    for (const role of nonAdminRoles) {
      it(`${endpoint.method} ${endpoint.path} returns 403 for ${role}`, async () => {
        await expectForbidden(endpoint.method, endpoint.path, tokens[role].token)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Admin agent group endpoints — reject all non-admin roles
// ---------------------------------------------------------------------------
describe('Agent group admin endpoints reject non-admin roles', () => {
  const agentGroupEndpoints = [
    { method: 'GET',    path: '/api/admin/agent-groups' },
    { method: 'POST',   path: '/api/admin/agent-groups' },
  ]

  const nonAdminRoles = ['agent', 'customer', 'driver_partner', 'fleet_owner']

  for (const endpoint of agentGroupEndpoints) {
    for (const role of nonAdminRoles) {
      it(`${endpoint.method} ${endpoint.path} returns 403 for ${role}`, async () => {
        await expectForbidden(endpoint.method, endpoint.path, tokens[role].token)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Public endpoints — should work without authentication
// ---------------------------------------------------------------------------
describe('Public endpoints accessible without auth', () => {
  it('POST /api/prospects (lead capture) works without auth', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Public',
        lastName: 'Lead',
        email: `public-lead-${Date.now()}@test.com`,
        phone: `+65${String(Date.now()).slice(-8)}`,
        leadSource: 'website',
      })
    // 201 Created or 200 OK — but not 401
    expect([200, 201, 400]).toContain(res.status)
    expect(res.status).not.toBe(401)
  })

  it('POST /api/contact works without auth', async () => {
    const res = await request(app)
      .post('/api/contact')
      .send({
        name: 'Public User',
        email: 'public@test.com',
        message: 'This is a public contact form submission for testing.'
      })
    // Should be accepted or rejected by validation, not by auth
    expect([200, 201, 400, 429]).toContain(res.status)
    expect(res.status).not.toBe(401)
  })

  it('POST /api/auth/login works without auth', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'wrong' })
    // Should fail login, not fail auth
    expect([400, 401]).toContain(res.status)
  })

  it('POST /api/auth/register works without auth', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `register-test-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        firstName: 'Test',
        lastName: 'Register'
      })
    // Should not return 401 (auth is not required)
    expect(res.status).not.toBe(401)
    expect([200, 201, 400, 409]).toContain(res.status)
  })

  it('POST /api/retell/webhook works without Bearer auth (uses signature)', async () => {
    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .send({ event: 'call_ended', call: { call_id: 'public-test' } })
    // Should fail on signature, not on auth middleware
    expect([401, 503]).toContain(res.status)
    // 503 = secret not configured, 401 = missing/bad signature — both are valid
    expect(res.status).not.toBe(403)
  })

  it('GET /health works without auth', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('OK')
  })

  it('POST /api/provision/session works without auth', async () => {
    const res = await request(app)
      .post('/api/provision/session')
      .send({})
    // Should not require auth
    expect(res.status).not.toBe(401)
    expect([200, 201, 400, 429]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// Admin-only provisioning fulfill endpoint
// ---------------------------------------------------------------------------
describe('Provisioning fulfill requires admin', () => {
  const nonAdminRoles = ['agent', 'customer', 'driver_partner', 'fleet_owner']

  for (const role of nonAdminRoles) {
    it(`POST /api/provision/fulfill returns 403 for ${role}`, async () => {
      await expectForbidden('POST', '/api/provision/fulfill', tokens[role].token)
    })
  }
})

// ---------------------------------------------------------------------------
// Admin can access admin-only endpoints
// ---------------------------------------------------------------------------
describe('Admin role can access admin endpoints', () => {
  it('GET /api/users returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tokens.admin.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/agents returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokens.admin.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/devices returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${tokens.admin.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/admin/webhooks/subscribers returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${tokens.admin.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/admin/agent-groups returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/admin/agent-groups')
      .set('Authorization', `Bearer ${tokens.admin.token}`)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Agent role can access agent-or-admin endpoints
// ---------------------------------------------------------------------------
describe('Agent role can access agent-or-admin endpoints', () => {
  it('GET /api/campaigns returns 200 for agent', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${tokens.agent.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/prospects returns 200 for agent', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${tokens.agent.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/dashboard/analytics returns 200 for agent', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics')
      .set('Authorization', `Bearer ${tokens.agent.token}`)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Driver partner can access driver-specific endpoints
// ---------------------------------------------------------------------------
describe('Driver partner can access driver endpoints', () => {
  it('GET /api/dashboard/driver/scans returns 200 for driver_partner', async () => {
    const res = await request(app)
      .get('/api/dashboard/driver/scans')
      .set('Authorization', `Bearer ${tokens.driver_partner.token}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/dashboard/driver/commissions returns 200 for driver_partner', async () => {
    const res = await request(app)
      .get('/api/dashboard/driver/commissions')
      .set('Authorization', `Bearer ${tokens.driver_partner.token}`)
    expect(res.status).toBe(200)
  })
})
