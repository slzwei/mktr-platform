/**
 * M2 (review round 3): QR scan dedup is per-scanner and atomic.
 *
 * Pre-fix, recordScan fetched only the tag's single MOST RECENT scan and
 * compared client fields against it — for client A, then B, then A again
 * within the 2-minute window, A's second scan was compared with B's and
 * counted unique again. And nothing serialized concurrent requests: two
 * simultaneous same-client scans both read the same prior state, both wrote
 * isDuplicate=false, and both incremented uniqueScanCount.
 *
 * Post-fix the window query is scoped to (qrTagId, ipHash, ua), the claim is
 * serialized by a per-(tag, scanner) advisory xact lock, and the scan row +
 * counters commit in one transaction — only the winning request counts.
 */
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag } from './helpers.js'
import { QrTag, sequelize } from '../src/models/index.js'
import { recordScan } from '../src/services/trackerService.js'

let adminUser, campaign

const CLIENT_A = { userAgent: 'Mozilla/5.0 (iPhone; client A)', referer: null, ip: '10.0.0.1' }
const CLIENT_B = { userAgent: 'Mozilla/5.0 (Macintosh; client B)', referer: null, ip: '10.0.0.2' }

beforeAll(async () => {
  await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user
  campaign = await createTestCampaign(adminUser.id, { name: 'Scan Dedup Campaign' })
})

afterAll(async () => {
  await closeDb()
})

const freshTag = () => createTestQrTag(campaign.id, adminUser.id)
const tagRow = async (id) => QrTag.findByPk(id, { raw: true })

describe('M2 — per-scanner dedup window', () => {
  it('A, then B, then A again: the third scan is a DUPLICATE', async () => {
    const tag = await freshTag()

    const first = await recordScan(tag, CLIENT_A)
    const second = await recordScan(tag, CLIENT_B)
    const third = await recordScan(tag, CLIENT_A)

    expect(first.isDuplicate).toBe(false)
    expect(second.isDuplicate).toBe(false)
    // Pre-fix: compared only with B (the tag's latest scan) → counted unique.
    expect(third.isDuplicate).toBe(true)

    const row = await tagRow(tag.id)
    expect(row.scanCount).toBe(3)
    expect(row.uniqueScanCount).toBe(2)
  })

  it('a re-scan OUTSIDE the 2-minute window is unique again', async () => {
    const tag = await freshTag()
    const first = await recordScan(tag, CLIENT_A)
    await sequelize.query('UPDATE qr_scans SET ts = :ts WHERE id = :id', {
      replacements: { ts: new Date(Date.now() - 3 * 60 * 1000), id: first.id },
    })

    const again = await recordScan(tag, CLIENT_A)
    expect(again.isDuplicate).toBe(false)
    expect((await tagRow(tag.id)).uniqueScanCount).toBe(2)
  })
})

describe('M2 — the unique claim is atomic under concurrency', () => {
  it('4 simultaneous same-client scans → exactly ONE unique', async () => {
    const tag = await freshTag()

    const scans = await Promise.all(
      Array.from({ length: 4 }, () => recordScan(tag, CLIENT_A))
    )

    const uniques = scans.filter((s) => !s.isDuplicate)
    // Pre-fix: every request read "no prior duplicate" and all counted unique.
    expect(uniques).toHaveLength(1)

    const row = await tagRow(tag.id)
    expect(row.scanCount).toBe(4)
    expect(row.uniqueScanCount).toBe(1)
  })

  it('distinct clients scanning concurrently all stay unique (no over-dedup)', async () => {
    const tag = await freshTag()
    const clients = [
      CLIENT_A,
      CLIENT_B,
      { userAgent: 'Mozilla/5.0 (Linux; client C)', referer: null, ip: '10.0.0.3' },
    ]

    const scans = await Promise.all(clients.map((c) => recordScan(tag, c)))
    expect(scans.every((s) => !s.isDuplicate)).toBe(true)

    const row = await tagRow(tag.id)
    expect(row.scanCount).toBe(3)
    expect(row.uniqueScanCount).toBe(3)
  })
})
