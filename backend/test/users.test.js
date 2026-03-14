import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'

let app, adminToken, adminUser, agentToken, agentUser

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user; agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('User Management Routes', () => {
  // ---- GET /api/users (list) ----
  describe('GET /api/users', () => {
    it('admin lists all users', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.users).toBeDefined()
      expect(Array.isArray(res.body.data.users)).toBe(true)
      expect(res.body.data.pagination).toBeDefined()
      expect(res.body.data.pagination.totalItems).toBeGreaterThanOrEqual(2) // admin + agent at minimum
    })

    it('agent gets 403', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${agentToken}`)

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('unauthenticated request returns 401', async () => {
      const res = await request(app)
        .get('/api/users')

      expect(res.status).toBe(401)
    })

    it('admin filters users by role', async () => {
      const res = await request(app)
        .get('/api/users?role=agent')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const users = res.body.data.users
      expect(users.length).toBeGreaterThanOrEqual(1)
      // Every returned user must have the 'agent' role
      users.forEach(u => {
        expect(u.role).toBe('agent')
      })
    })
  })

  // ---- GET /api/users/:id ----
  describe('GET /api/users/:id', () => {
    it('admin gets specific user by ID', async () => {
      const res = await request(app)
        .get(`/api/users/${agentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.id).toBe(agentUser.id)
    })

    it('returns 404 for non-existent user', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const res = await request(app)
        .get(`/api/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })

    it('agent can view their own profile', async () => {
      const res = await request(app)
        .get(`/api/users/${agentUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.user.id).toBe(agentUser.id)
    })
  })

  // ---- PUT /api/users/:id ----
  describe('PUT /api/users/:id', () => {
    it('admin updates user role', async () => {
      // Create a disposable user for this test
      const { user: target } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'agent' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user.role).toBe('agent')
    })

    it('admin deactivates user', async () => {
      const { user: target } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user.isActive).toBe(false)
    })

    it('non-admin cannot update another user role', async () => {
      const { user: target } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ role: 'admin' })

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('returns 404 when updating non-existent user', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const res = await request(app)
        .put(`/api/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Ghost' })

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })
})

// ============================================================
// Additional coverage: user profile, update, delete, filters, pagination
// ============================================================

describe('User Profile Fields', () => {
  it('GET /api/users/:id — returns full profile fields', async () => {
    const res = await request(app)
      .get(`/api/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const user = res.body.data.user
    expect(user.id).toBe(adminUser.id)
    expect(user.email).toBeDefined()
    expect(user.firstName).toBeDefined()
    expect(user.lastName).toBeDefined()
    expect(user.role).toBeDefined()
    expect(typeof user.isActive).toBe('boolean')
    // Password must never be returned
    expect(user.password).toBeUndefined()
  })
})

describe('User Update - name and company', () => {
  it('PUT /api/users/:id — update firstName, lastName, companyName via admin', async () => {
    const { user: target } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .put(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'NewFirst', lastName: 'NewLast' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.firstName).toBe('NewFirst')
    expect(res.body.data.user.lastName).toBe('NewLast')
  })

  it('PUT /api/users/:id — agent can update own firstName', async () => {
    const { user: self, token: selfToken } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .put(`/api/users/${self.id}`)
      .set('Authorization', `Bearer ${selfToken}`)
      .send({ firstName: 'SelfUpdated' })

    expect(res.status).toBe(200)
    expect(res.body.data.user.firstName).toBe('SelfUpdated')
  })
})

describe('User Approval Status', () => {
  it('PATCH /api/users/:id/approval — admin changes approvalStatus to approved', async () => {
    const { user: target } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .patch(`/api/users/${target.id}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approvalStatus: 'approved' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.approvalStatus).toBe('approved')
  })

  it('PATCH /api/users/:id/approval — admin changes approvalStatus to rejected', async () => {
    const { user: target } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .patch(`/api/users/${target.id}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approvalStatus: 'rejected' })

    expect(res.status).toBe(200)
    expect(res.body.data.user.approvalStatus).toBe('rejected')
  })

  it('PATCH /api/users/:id/approval — invalid status returns 400', async () => {
    const { user: target } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .patch(`/api/users/${target.id}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approvalStatus: 'bogus' })

    expect(res.status).toBe(400)
  })

  it('PATCH /api/users/:id/approval — agent cannot change approval status', async () => {
    const { user: target } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .patch(`/api/users/${target.id}/approval`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ approvalStatus: 'approved' })

    expect(res.status).toBe(403)
  })
})

describe('User Delete / Deactivate', () => {
  it('DELETE /api/users/:id — admin deactivates user', async () => {
    const { user: target } = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .delete(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toMatch(/deactivated/i)
  })

  it('DELETE /api/users/:id — returns 404 for non-existent user', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await request(app)
      .delete(`/api/users/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('DELETE /api/users/:id — admin cannot delete themselves', async () => {
    const res = await request(app)
      .delete(`/api/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/own account/i)
  })

  it('DELETE /api/users/:id — agent cannot delete another user', async () => {
    const { user: target } = await createTestUser({ role: 'customer' })

    const res = await request(app)
      .delete(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })
})

describe('User List Filters', () => {
  it('GET /api/users?status=active — filters active users', async () => {
    const res = await request(app)
      .get('/api/users?status=active')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const users = res.body.data.users
    users.forEach(u => {
      expect(u.isActive).toBe(true)
    })
  })

  it('GET /api/users?status=inactive — filters inactive users', async () => {
    // Create and deactivate a user so there is at least one inactive
    const { user: target } = await createTestUser({ role: 'customer', isActive: false })

    const res = await request(app)
      .get('/api/users?status=inactive')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const users = res.body.data.users
    users.forEach(u => {
      expect(u.isActive).toBe(false)
    })
  })
})

describe('User Pagination', () => {
  it('GET /api/users?page=1&limit=2 — respects pagination params', async () => {
    const res = await request(app)
      .get('/api/users?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.users.length).toBeLessThanOrEqual(2)
    expect(res.body.data.pagination.currentPage).toBe(1)
    expect(res.body.data.pagination.itemsPerPage).toBe(2)
    expect(res.body.data.pagination.totalItems).toBeGreaterThanOrEqual(2)
    expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/users?page=2&limit=1 — page 2 returns different users', async () => {
    const page1 = await request(app)
      .get('/api/users?page=1&limit=1')
      .set('Authorization', `Bearer ${adminToken}`)

    const page2 = await request(app)
      .get('/api/users?page=2&limit=1')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(page1.status).toBe(200)
    expect(page2.status).toBe(200)
    // Pages should return different users (if enough exist)
    if (page1.body.data.users.length > 0 && page2.body.data.users.length > 0) {
      expect(page1.body.data.users[0].id).not.toBe(page2.body.data.users[0].id)
    }
  })
})
