import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect, createTestQrTag } from './helpers.js'
import { resetAdminStatsCache } from '../src/services/dashboardService.js'
import { LeadPackage, LeadPackageAssignment, WebhookSubscriber, WebhookDelivery, ExternalAgent } from '../src/models/index.js'

/**
 * Admin rebuild Phase B — API extensions (docs/plans/mktr-admin-rebuild-implementation.md).
 * DB-backed contract tests for:
 *   B1 overview periodTotal/assigned/converted/conversionRate + period-keyed cache
 *   B2 /api/dashboard/attention structured aggregates
 *   B3 /api/dashboard/series SGT daily buckets
 *   B4 /api/dashboard/funnel (prorated scans, floored, estimated flag)
 *   B5 prospects comma-list filters + sort whitelist
 *   B6 campaign list aggregates + /api/campaigns/:id/summary composite
 *   B7 agents roster aggregates
 */

const DAY_MS = 24 * 3600e3

let app, admin, adminToken, agent, agentToken, externalAgent
let campaign, pricedCoveredCampaign, pricedUncoveredCampaign, drawCampaign
let walletPkg, walletAssignment, extProspect

beforeAll(async () => {
  app = await getApp()
  ;({ user: admin, token: adminToken } = await createTestUser({ role: 'admin' }))
  ;({ user: agent, token: agentToken } = await createTestUser({ role: 'agent' }))

  // External (mktr-leads) agent with a wallet balance below the S$50 low-water mark.
  ;({ user: externalAgent } = await createTestUser({
    role: 'agent',
    mktrLeadsId: `mktr-ext-${Date.now()}`,
    walletBalanceCents: 2500,
  }))

  campaign = await createTestCampaign(admin.id)

  // Priced + covered: an open wallet commitment keeps it OFF the zero-commit rail.
  pricedCoveredCampaign = await createTestCampaign(admin.id, { leadPriceCents: 800 })
  walletPkg = await LeadPackage.create({
    name: 'Wallet commitments', type: 'custom', kind: 'wallet', campaignId: pricedCoveredCampaign.id,
    isPublic: false, status: 'active', currency: 'SGD', price: 0, leadCount: 0, createdBy: admin.id,
  })
  walletAssignment = await LeadPackageAssignment.create({
    agentId: externalAgent.id, leadPackageId: walletPkg.id, source: 'wallet',
    unitPriceCents: 800, leadsTotal: 5, leadsRemaining: 3, priceSnapshot: '40.00', status: 'active',
  })

  // Priced + uncovered: no funded assignment at all → zero-commit incident.
  pricedUncoveredCampaign = await createTestCampaign(admin.id, { leadPriceCents: 600 })

  // Draw closing inside the 7-day horizon (YYYY-MM-DD, SGT end-of-day).
  const in3d = new Date(Date.now() + 3 * DAY_MS).toISOString().slice(0, 10)
  drawCampaign = await createTestCampaign(admin.id, {
    design_config: { luckyDraw: { enabled: true, closesAt: in3d, multiplier: 10, winners: 1 } },
  })

  // Prospects: one older than 7d (period boundary), assigned recents, a won
  // conversion, held rows across known + unknown reasons, and one unassigned.
  await createTestProspect(campaign.id, {
    assignedAgentId: agent.id, createdAt: new Date(Date.now() - 10 * DAY_MS),
  })
  await createTestProspect(campaign.id, { assignedAgentId: agent.id })
  await createTestProspect(campaign.id, {
    assignedAgentId: agent.id, leadStatus: 'won', conversionDate: new Date(),
    firstName: 'Zz-Won',
  })
  await createTestProspect(campaign.id, {
    quarantinedAt: new Date(), quarantineReason: 'no_funded_agent', firstName: 'Held-A',
  })
  await createTestProspect(campaign.id, {
    quarantinedAt: new Date(), quarantineReason: 'dnc_pending', leadSource: 'website',
  })
  await createTestProspect(campaign.id, {
    quarantinedAt: new Date(), quarantineReason: 'some_future_reason',
  })
  await createTestProspect(campaign.id, { firstName: 'Aa-Unassigned', leadSource: 'website' })

  // Externally-assigned prospect (the SECOND assignee FK): must count as
  // "assigned", never appear under "unassigned".
  const extBuyer = await ExternalAgent.create({ phone: `+65${String(Date.now()).slice(-8)}`, name: 'Ext Buyer' })
  extProspect = await createTestProspect(campaign.id, { firstName: 'Ext-Assigned', externalAgentId: extBuyer.id })

  await createTestQrTag(campaign.id, admin.id, { scanCount: 90 })

  // Webhook health rows: one pending, one failed-now, one disabled subscriber.
  const sub = await WebhookSubscriber.create({
    name: 'Test Sub', url: 'https://example.test/hook', secret: 's3cret',
    events: ['lead.created'], enabled: true,
  })
  await WebhookSubscriber.create({
    name: 'Disabled Sub', url: 'https://example.test/hook2', secret: 's3cret',
    events: ['lead.created'], enabled: false,
  })
  await WebhookDelivery.create({ subscriberId: sub.id, eventType: 'lead.created', payload: {}, status: 'pending' })
  await WebhookDelivery.create({ subscriberId: sub.id, eventType: 'lead.created', payload: {}, status: 'failed' })

  resetAdminStatsCache()
}, 30000)

afterAll(async () => {
  await closeDb()
})

// ── B1 — overview extension + period-keyed cache ─────────────────────────────

describe('B1 — GET /api/dashboard/overview (admin extension)', () => {
  it('returns period-scoped periodTotal/assigned/converted/conversionRate; total stays all-time', async () => {
    resetAdminStatsCache()
    const res = await request(app).get('/api/dashboard/overview?period=30d').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const p = res.body.data.stats.prospects
    expect(p.total).toBeGreaterThanOrEqual(7)
    expect(p.periodTotal).toBeGreaterThanOrEqual(7) // the 10d-old row is inside 30d
    expect(p.assigned).toBeGreaterThanOrEqual(3)
    expect(p.converted).toBeGreaterThanOrEqual(1)
    expect(typeof p.conversionRate).toBe('number')
  })

  it('period cache is keyed: back-to-back 30d vs 7d differ (the old global-cache bug)', async () => {
    resetAdminStatsCache()
    const r30 = await request(app).get('/api/dashboard/overview?period=30d').set('Authorization', `Bearer ${adminToken}`)
    const r7 = await request(app).get('/api/dashboard/overview?period=7d').set('Authorization', `Bearer ${adminToken}`)
    // Within the same 30s TTL window — the 7d response must NOT be the cached 30d value.
    expect(r7.body.data.stats.prospects.periodTotal).toBe(r30.body.data.stats.prospects.periodTotal - 1)
  })
})

// ── B2 — attention aggregates ────────────────────────────────────────────────

describe('B2 — GET /api/dashboard/attention', () => {
  it('is admin-only', async () => {
    const res = await request(app).get('/api/dashboard/attention').set('Authorization', `Bearer ${agentToken}`)
    expect(res.status).toBe(403)
  })

  it('returns the full structured aggregate with real-schema semantics', async () => {
    const res = await request(app).get('/api/dashboard/attention').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const d = res.body.data

    // webhooks
    expect(d.webhooks.pending).toBeGreaterThanOrEqual(1)
    expect(d.webhooks.failedLast24h).toBeGreaterThanOrEqual(1)
    expect(d.webhooks.subscriberDisabled).toBe(true)

    // held: all five known reasons present, unknown reconciles into `other`
    expect(d.held.byReason.no_funded_agent).toBeGreaterThanOrEqual(1)
    expect(d.held.byReason.dnc_pending).toBeGreaterThanOrEqual(1)
    expect(d.held.byReason.other).toBeGreaterThanOrEqual(1)
    expect(Object.keys(d.held.byReason)).toEqual(
      expect.arrayContaining(['no_funded_agent', 'no_funded_external_buyer', 'dnc_pending', 'dnc_registered', 'returned_by_admin', 'other'])
    )
    const reasonSum = Object.values(d.held.byReason).reduce((s, n) => s + n, 0)
    expect(d.held.total).toBe(reasonSum)

    // unassigned = no assignee (either FK) AND not held
    expect(d.unassigned).toBeGreaterThanOrEqual(1)

    // zero-commit: uncovered priced campaign flagged; covered one is NOT; unpriced never
    const zcIds = d.zeroCommitCampaigns.map((c) => c.id)
    expect(zcIds).toContain(pricedUncoveredCampaign.id)
    expect(zcIds).not.toContain(pricedCoveredCampaign.id)
    expect(zcIds).not.toContain(campaign.id)

    // wallets: external cohort only — low (< S$50) includes our agent
    expect(d.wallets.low.map((a) => a.id)).toContain(externalAgent.id)
    expect(d.wallets.floatCents).toBeGreaterThanOrEqual(2500)

    // committed demand from the open wallet assignment (3 × 800)
    expect(d.committed.leads).toBeGreaterThanOrEqual(3)
    expect(d.committed.valueCents).toBeGreaterThanOrEqual(2400)
    expect(d.committed.campaigns).toBeGreaterThanOrEqual(1)

    // draw closing inside 7d; draw campaigns never appear under endings
    expect(d.drawsClosing.map((c) => c.id)).toContain(drawCampaign.id)
    expect(d.endingCampaigns.map((c) => c.id)).not.toContain(drawCampaign.id)
  })
})

// ── B3 — series ──────────────────────────────────────────────────────────────

describe('B3 — GET /api/dashboard/series', () => {
  it('returns SGT daily buckets with isToday on the last bucket', async () => {
    const res = await request(app).get('/api/dashboard/series?period=7d').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.days).toHaveLength(7)
    expect(d.days[6].isToday).toBe(true)
    expect(d.days.slice(0, 6).every((x) => x.isToday === false)).toBe(true)
    // 6 prospects created "now" land in today's SGT bucket; the 10d-old one doesn't.
    expect(d.today).toBeGreaterThanOrEqual(6)
    expect(d.total).toBe(d.days.reduce((s, x) => s + x.count, 0))
    expect(typeof d.avgPerDay).toBe('number')
  })

  it('normalizes junk periods to 30d', async () => {
    const res = await request(app).get('/api/dashboard/series?period=bogus').set('Authorization', `Bearer ${adminToken}`)
    expect(res.body.data.period).toBe('30d')
    expect(res.body.data.days).toHaveLength(30)
  })
})

// ── B4 — funnel ──────────────────────────────────────────────────────────────

describe('B4 — GET /api/dashboard/funnel', () => {
  it('prorates lifetime scans, floors at submits, and flags the estimate', async () => {
    const res = await request(app).get('/api/dashboard/funnel?period=7d').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.estimated).toBe(true)
    expect(d.scans).toBeGreaterThanOrEqual(d.submits) // floored — the funnel never inverts
    expect(d.submits).toBeGreaterThanOrEqual(d.assigned)
    expect(d.assigned).toBeGreaterThanOrEqual(d.won)
    expect(d.won).toBeGreaterThanOrEqual(1)
  })
})

// ── B5 — prospects comma-list filters + sort ─────────────────────────────────

describe('B5 — GET /api/prospects multi-select + sort', () => {
  it('comma-list leadStatus filters with Op.in; invalid tokens are dropped', async () => {
    const res = await request(app)
      .get('/api/prospects?leadStatus=won,nurturing,not_a_status&limit=50')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const statuses = new Set(res.body.data.prospects.map((p) => p.leadStatus))
    expect(statuses.has('won')).toBe(true)
    for (const s of statuses) expect(['won', 'nurturing']).toContain(s)
  })

  it('an all-invalid filter degrades to an empty page (never 500, never unfiltered)', async () => {
    const res = await request(app)
      .get('/api/prospects?leadSource=carrier_pigeon')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.prospects).toHaveLength(0)
  })

  it('assignment filters see BOTH assignee FKs (external-assigned is never "unassigned")', async () => {
    const assigned = await request(app)
      .get('/api/prospects?assignment=assigned&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(assigned.body.data.prospects.map((p) => p.firstName)).toContain('Ext-Assigned')

    const unassigned = await request(app)
      .get('/api/prospects?assignment=unassigned&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
    const names = unassigned.body.data.prospects.map((p) => p.firstName)
    expect(names).toContain('Aa-Unassigned')
    expect(names).not.toContain('Ext-Assigned')
  })

  it('bulk assign FENCES external-buyer-owned rows (ownership invariant)', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ prospectIds: [extProspect.id], agentId: agent.id })
    expect(res.status).toBe(200)
    expect(res.body.data.affectedCount).toBe(0)
    expect(res.body.data.skipped.externalOwned).toBe(1)

    await extProspect.reload()
    expect(extProspect.assignedAgentId).toBeNull() // never double-owned
    expect(extProspect.externalAgentId).not.toBeNull()
  })

  it('bulk return-to-held never quarantines an external-buyer-owned row', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/return-to-held')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ prospectIds: [extProspect.id] })
    expect(res.status).toBe(200)
    expect(res.body.data.returned).toBe(0)

    await extProspect.reload()
    expect(extProspect.quarantinedAt).toBeNull()
  })

  it('assignment=assigned composes with search (Op.or collision guard)', async () => {
    const res = await request(app)
      .get('/api/prospects?assignment=assigned&search=Zz-Won&limit=50')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const names = res.body.data.prospects.map((p) => p.firstName)
    expect(names).toContain('Zz-Won')
    expect(names).not.toContain('Ext-Assigned') // search still narrows
  })

  it('sort=firstName orders ascending; junk sort falls back to -createdAt', async () => {
    const asc = await request(app)
      .get('/api/prospects?sort=firstName&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
    const names = asc.body.data.prospects.map((p) => p.firstName)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)

    const junk = await request(app)
      .get('/api/prospects?sort=;DROP TABLE&limit=5')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(junk.status).toBe(200) // whitelist fallback, no error
  })
})

// ── B6 — campaign list aggregates + summary composite ───────────────────────

describe('B6 — campaign aggregates', () => {
  it('list carries leadsThisPeriod + committedRemaining + committedValueCents', async () => {
    const res = await request(app)
      .get('/api/campaigns?period=7d&limit=50')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const rows = res.body.data.campaigns
    const covered = rows.find((c) => c.id === pricedCoveredCampaign.id)
    // JSON numbers, not pg-bigint strings — asserted WITHOUT coercion.
    expect(covered.committedRemaining).toBe(3)
    expect(covered.committedValueCents).toBe(2400)
    const main = rows.find((c) => c.id === campaign.id)
    expect(main.leadsThisPeriod).toBeGreaterThanOrEqual(6) // 10d-old row outside 7d
    expect(main.leadsTotal).toBeGreaterThanOrEqual(7)      // Phase C contract key
    expect(Number(main.prospectCount)).toBeGreaterThanOrEqual(7) // legacy key untouched
  })

  it('GET /api/campaigns/:id/summary is admin-only and composes the detail payload', async () => {
    const forbidden = await request(app)
      .get(`/api/campaigns/${campaign.id}/summary`)
      .set('Authorization', `Bearer ${agentToken}`)
    expect(forbidden.status).toBe(403)

    const res = await request(app)
      .get(`/api/campaigns/${pricedCoveredCampaign.id}/summary`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.campaign.id).toBe(pricedCoveredCampaign.id)
    expect(d.series.days).toHaveLength(30)
    expect(d.commitments).toHaveLength(1)
    expect(d.commitments[0]).toMatchObject({ remaining: 3, unitPriceCents: 800, valueCents: 2400 })
    expect(d.committedRemaining).toBe(3)
    expect(d.committedValueCents).toBe(2400)
    expect(Array.isArray(d.recent)).toBe(true)
    expect(Array.isArray(d.qrTags)).toBe(true)
  })
})

// ── B7 — agents roster aggregates ────────────────────────────────────────────

describe('B7 — GET /api/agents roster aggregates', () => {
  it('carries assignedThisPeriod, lastAssignedAt, wallet columns', async () => {
    const res = await request(app)
      .get('/api/agents?limit=100&period=30d')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const rows = res.body.data.agents
    const internal = rows.find((a) => a.id === agent.id)
    expect(internal.assignedThisPeriod).toBeGreaterThanOrEqual(3)
    expect(internal.lastAssignedAt).toBeTruthy()
    // Internal agents have no wallet — null, never a misleading 0.
    expect(internal.walletBalanceCents).toBeNull()
    expect(internal.committedLeads).toBeNull()
    expect(internal.committedValueCents).toBeNull()

    const external = rows.find((a) => a.id === externalAgent.id)
    expect(external.walletBalanceCents).toBe(2500)
    expect(external.committedLeads).toBe(3)
    expect(external.committedValueCents).toBe(2400)
  })
})
