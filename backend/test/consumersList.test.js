import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { Consumer } from '../src/models/index.js'

/**
 * GET /api/consumers — the People directory list (admin-people-directory §4.1).
 *
 * The load-bearing contracts: membership is prospect-ROW existence (never the
 * signupCount counter — a drift victim with zeroed counts but linked rows must
 * stay visible, a countless artifact must not), erased people are browsable
 * but never identity-searchable, latestProspectId is the newest linked row,
 * and the search escapes LIKE metacharacters for real.
 *
 * Fixtures share the DB with other suites (maxWorkers 1), so every scoped
 * assertion narrows via the distinctive 'Peopledir' surname; the erased row
 * (null identity, unsearchable by design) is located by walking pages.
 */

let app, adminToken, agentToken, campaign
const HOUR = 3600 * 1000
const now = Date.now()

// Fixture consumers, keyed for assertions.
const C = {}

async function mkConsumer(key, fields) {
  C[key] = await Consumer.create({
    firstSeenAt: new Date(now - 10 * 24 * HOUR),
    lastSeenAt: new Date(now - 6 * HOUR),
    signupCount: 1,
    verifiedSignupCount: 0,
    ...fields,
  })
  return C[key]
}

function get(path, token = adminToken) {
  const req = request(app).get(path)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

/** Erased rows can't be searched — walk pages to find a row by id. */
async function findRowById(id, params = '') {
  for (let page = 1; page <= 3; page += 1) {
    const res = await get(`/api/consumers?limit=100&page=${page}${params}`)
    expect(res.status).toBe(200)
    const hit = res.body.data.rows.find((r) => r.id === id)
    if (hit) return hit
    if (res.body.data.rows.length < 100) return null
  }
  return null
}

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
  campaign = await createTestCampaign(admin.user.id)

  // A — the repeat person: two signups, newest wins latestProspectId.
  await mkConsumer('a', {
    phone: '+6598111001', firstName: 'Zephyrine', lastName: 'Peopledir',
    email: 'zephyrine@peopledir.test', signupCount: 2, verifiedSignupCount: 1,
    lastSeenAt: new Date(now - 1 * HOUR),
  })
  C.aOld = await createTestProspect(campaign.id, {
    consumerId: C.a.id, phone: '+6598111001', firstName: 'Zephyrine', lastName: 'Peopledir',
    createdAt: new Date(now - 48 * HOUR),
  })
  C.aNew = await createTestProspect(campaign.id, {
    consumerId: C.a.id, phone: '+6598111991', firstName: 'Zephyrine', lastName: 'Peopledir',
    createdAt: new Date(now - 24 * HOUR),
  })

  // B — one signup.
  await mkConsumer('b', {
    phone: '+6598111002', firstName: 'Quorra', lastName: 'Peopledir',
    email: 'quorra@peopledir.test', lastSeenAt: new Date(now - 2 * HOUR),
  })
  await createTestProspect(campaign.id, { consumerId: C.b.id, phone: '+6598111002' })

  // Z — the pure edit-artifact: zero counts AND zero linked rows. Never listed.
  await mkConsumer('artifact', {
    phone: '+6598111003', firstName: 'Artifact', lastName: 'Peopledir',
    signupCount: 0, verifiedSignupCount: 0,
  })

  // D — the drift victim: counter says 0, a prospect still links. MUST be
  // listed (rows are the truth, the counter is a projection).
  await mkConsumer('drift', {
    phone: '+6598111004', firstName: 'Drifter', lastName: 'Peopledir',
    signupCount: 0, verifiedSignupCount: 0, lastSeenAt: new Date(now - 3 * HOUR),
  })
  C.driftP = await createTestProspect(campaign.id, { consumerId: C.drift.id, phone: '+6598111004' })

  // E — erased: identity nulled, stale counts survive, skeleton keeps the link.
  await mkConsumer('erased', {
    phone: null, phoneHash: null, firstName: null, lastName: null, email: null,
    signupCount: 3, verifiedSignupCount: 2, erasedAt: new Date(now - 24 * HOUR),
    lastSeenAt: new Date(now - 30 * 60 * 1000),
  })
  C.erasedP = await createTestProspect(campaign.id, {
    consumerId: C.erased.id, phone: null, firstName: 'Erased', lastName: null, email: null,
  })

  // Escaping fixtures: literal %, _, and backslash in names, plus lookalike
  // controls that a broken (unescaped) pattern WOULD match.
  await mkConsumer('pct', { phone: '+6598111006', firstName: 'Wild%card', lastName: 'Peopledir' })
  await createTestProspect(campaign.id, { consumerId: C.pct.id, phone: '+6598111006' })
  await mkConsumer('pctCtl', { phone: '+6598111007', firstName: 'Wildzcard', lastName: 'Peopledir' })
  await createTestProspect(campaign.id, { consumerId: C.pctCtl.id, phone: '+6598111007' })
  await mkConsumer('und', { phone: '+6598111008', firstName: 'a_b', lastName: 'Peopledir' })
  await createTestProspect(campaign.id, { consumerId: C.und.id, phone: '+6598111008' })
  await mkConsumer('undCtl', { phone: '+6598111009', firstName: 'axb', lastName: 'Peopledir' })
  await createTestProspect(campaign.id, { consumerId: C.undCtl.id, phone: '+6598111009' })
  await mkConsumer('bs', { phone: '+6598111010', firstName: 'back\\slash', lastName: 'Peopledir' })
  await createTestProspect(campaign.id, { consumerId: C.bs.id, phone: '+6598111010' })
  await mkConsumer('bsCtl', { phone: '+6598111011', firstName: 'backslash', lastName: 'Peopledir' })
  await createTestProspect(campaign.id, { consumerId: C.bsCtl.id, phone: '+6598111011' })
})

afterAll(async () => {
  await closeDb()
})

const scoped = (extra = '') => `/api/consumers?q=Peopledir${extra}`
const ids = (res) => res.body.data.rows.map((r) => r.id)

describe('GET /api/consumers — auth', () => {
  it('401 without a token', async () => {
    const res = await get('/api/consumers', null)
    expect(res.status).toBe(401)
  })

  it('403 for a non-admin', async () => {
    const res = await get('/api/consumers', agentToken)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/consumers — membership is row existence', () => {
  it('lists linked people with the full row shape', async () => {
    const res = await get(scoped())
    expect(res.status).toBe(200)
    expect(typeof res.body.data.total).toBe('number')
    const a = res.body.data.rows.find((r) => r.id === C.a.id)
    expect(a).toBeDefined()
    // + the four MEET × BUY projections (§8). Pinned deliberately: this row
    // shape is the People page's contract, so widening it is a decision, not
    // a side effect.
    //
    // WIDENED 2026-07-28 by one key, and this is that decision: Meet and Buy
    // here are the person's BEST lead's scores (per-campaign-lead-scoring.md
    // §4) and this column sorts on them while naming no campaign. Harmless
    // while every campaign shared one rulebook — prod's six multi-signup
    // people scored 0-1 points apart — but migration 100 lets a campaign carry
    // its own weights, at which point "70" could be 70 for recruitment and 5
    // for whatever the reader sells. `scoreSourceCampaignName` is what stops
    // that ranking being unreadable.
    expect(Object.keys(a).sort()).toEqual([
      'buyScore', 'consumerScore', 'email', 'erasedAt', 'firstName', 'firstSeenAt',
      'id', 'lastName', 'lastSeenAt', 'latestProspectId', 'meetScore', 'phone',
      'scoreSourceCampaignName', 'scoredConfigVersion', 'signupCount', 'verifiedSignupCount',
    ])
    expect(a).toMatchObject({
      firstName: 'Zephyrine', lastName: 'Peopledir', phone: '+6598111001',
      signupCount: 2, verifiedSignupCount: 1, erasedAt: null,
    })
  })

  it('latestProspectId is the NEWEST linked prospect', async () => {
    const res = await get(scoped())
    const a = res.body.data.rows.find((r) => r.id === C.a.id)
    expect(a.latestProspectId).toBe(C.aNew.id)
  })

  it('hides the zero-count artifact with no linked rows', async () => {
    const res = await get(scoped())
    expect(ids(res)).not.toContain(C.artifact.id)
  })

  it('lists the drift victim (counter 0, prospect still linked) — rows beat counters', async () => {
    const res = await get(scoped())
    const drift = res.body.data.rows.find((r) => r.id === C.drift.id)
    expect(drift).toBeDefined()
    expect(drift.signupCount).toBe(0)
    expect(drift.latestProspectId).toBe(C.driftP.id)
  })
})

describe('GET /api/consumers — erased people', () => {
  it('browsable with null identity, stale counts, and a working click target', async () => {
    const row = await findRowById(C.erased.id)
    expect(row).not.toBeNull()
    expect(row).toMatchObject({
      firstName: null, lastName: null, email: null, phone: null,
      signupCount: 3,
    })
    expect(row.erasedAt).toBeTruthy()
    expect(row.latestProspectId).toBe(C.erasedP.id)
  })

  it('never matched by identity search (nothing left to match — by design)', async () => {
    const byName = await get('/api/consumers?q=Erased')
    expect(ids(byName)).not.toContain(C.erased.id)
    const byOldPhone = await get('/api/consumers?q=98111005')
    expect(ids(byOldPhone)).not.toContain(C.erased.id)
  })
})

describe('GET /api/consumers — search', () => {
  it('matches first name, email, and the concatenated full name', async () => {
    for (const q of ['Zephyrine', 'zephyrine@peopledir.test', 'Zephyrine Peopledir']) {
      const res = await get(`/api/consumers?q=${encodeURIComponent(q)}`)
      expect(ids(res)).toContain(C.a.id)
    }
  })

  it('matches digit-normalized phone fragments (≥4 digits)', async () => {
    const res = await get(`/api/consumers?q=${encodeURIComponent('8111 001')}`)
    expect(ids(res)).toContain(C.a.id)
  })

  it('a <4-digit fragment never falls through to the phone match', async () => {
    const res = await get('/api/consumers?q=001')
    expect(ids(res)).not.toContain(C.a.id)
  })

  it('escapes % — a literal-percent query only matches the literal name', async () => {
    const res = await get(`/api/consumers?q=${encodeURIComponent('%card')}`)
    expect(ids(res)).toContain(C.pct.id)
    expect(ids(res)).not.toContain(C.pctCtl.id)
  })

  it('escapes _ — a_b does not match axb', async () => {
    const res = await get(`/api/consumers?q=${encodeURIComponent('a_b')}`)
    expect(ids(res)).toContain(C.und.id)
    expect(ids(res)).not.toContain(C.undCtl.id)
  })

  it('escapes backslash — back\\slash matches the literal, not "backslash"', async () => {
    const res = await get(`/api/consumers?q=${encodeURIComponent('back\\slash')}`)
    expect(ids(res)).toContain(C.bs.id)
    expect(ids(res)).not.toContain(C.bsCtl.id)
  })
})

describe('GET /api/consumers — sort and pagination', () => {
  it('default sort is lastSeenAt DESC; unknown sorts fall back to it', async () => {
    for (const extra of ['', '&sort=junk']) {
      const res = await get(scoped(extra))
      expect(ids(res)[0]).toBe(C.a.id) // A has the most recent lastSeenAt in scope
    }
  })

  it('-signupCount puts the repeat person first', async () => {
    const res = await get(scoped('&sort=-signupCount'))
    expect(ids(res)[0]).toBe(C.a.id)
  })

  it('-name keeps null-named (erased) rows LAST', async () => {
    const rows = []
    for (let page = 1; page <= 3; page += 1) {
      const res = await get(`/api/consumers?limit=100&page=${page}&sort=-name`)
      rows.push(...res.body.data.rows)
      if (res.body.data.rows.length < 100) break
    }
    const idx = rows.findIndex((r) => r.id === C.erased.id)
    expect(idx).toBeGreaterThan(-1)
    expect(rows.slice(0, idx).every((r) => r.lastName !== null)).toBe(true)
  })

  it('clamps limit to 100 and rejects junk page/limit strictly', async () => {
    const big = await get(scoped('&limit=999'))
    expect(big.body.data.limit).toBe(100)
    const junkPage = await get(scoped('&page=2junk&limit=2.5'))
    expect(junkPage.body.data.page).toBe(1)
    expect(junkPage.body.data.limit).toBe(25)
  })

  it('pages deterministically with the id tiebreak (no dup, no gap)', async () => {
    const p1 = await get(scoped('&sort=name&limit=3&page=1'))
    const p2 = await get(scoped('&sort=name&limit=3&page=2'))
    const seen = [...ids(p1), ...ids(p2)]
    expect(new Set(seen).size).toBe(seen.length)
    expect(p1.body.data.total).toBe(p2.body.data.total)
  })
})

/**
 * MEET × BUY columns (consumer-profile-enrichment §8).
 *
 * The load-bearing contract is that the LEFT JOIN must not change WHO is
 * listed: the People directory is the person index, not the scored index, so
 * an unscored person stays on the page with null scores. And NULLS LAST has
 * to hold in BOTH sort directions — ascending by Buy should surface the
 * lowest real score, not the crowd of people we cannot score at all.
 */
describe('GET /api/consumers — scores', () => {
  let scoredId

  beforeAll(async () => {
    const { ConsumerProfile } = await import('../src/models/index.js')
    // 'a' is the ordinary linked fixture — score exactly that one so every
    // other Peopledir row stays a live example of the unscored case.
    scoredId = C.a.id
    await ConsumerProfile.upsert({
      consumerId: scoredId,
      meetScore: 71,
      buyScore: 44,
      consumerScore: 58,
      scoredConfigVersion: 1,
      scoringAlgorithmVersion: 'score/v1',
      scoreInputHash: 'x'.repeat(64),
      scoreBreakdown: { completeness: { assessed: 5, total: 7 } },
      scoreComputedAt: new Date(),
      inputVersion: 1,
      syncedInputVersion: 0,
    })
  })

  it('projects the scores onto the listed rows', async () => {
    const res = await get(scoped('&limit=100'))
    expect(res.status).toBe(200)
    const row = res.body.data.rows.find((r) => r.id === scoredId)
    expect(row).toBeTruthy()
    expect(row.meetScore).toBe(71)
    expect(row.buyScore).toBe(44)
    expect(row.scoredConfigVersion).toBe(1)
  })

  it('keeps unscored people on the page with null scores (LEFT JOIN, not INNER)', async () => {
    const res = await get(scoped('&limit=100'))
    const unscored = res.body.data.rows.filter((r) => r.id !== scoredId)
    expect(unscored.length).toBeGreaterThan(0)
    for (const r of unscored) {
      expect(r.meetScore).toBeNull()
      expect(r.scoredConfigVersion).toBeNull()
    }
  })

  it('sorts by Meet desc with the scored person first', async () => {
    const res = await get(scoped('&limit=100&sort=-meetScore'))
    expect(res.body.data.rows[0].id).toBe(scoredId)
  })

  it('ASCENDING by Buy still puts NULLs last — an unscoreable person never leads', async () => {
    const res = await get(scoped('&limit=100&sort=buyScore'))
    expect(res.body.data.rows[0].id).toBe(scoredId)
    expect(res.body.data.rows[res.body.data.rows.length - 1].buyScore).toBeNull()
  })

  it('an unknown sort still falls back rather than erroring', async () => {
    const res = await get(scoped('&sort=notAColumn'))
    expect(res.status).toBe(200)
  })
})
