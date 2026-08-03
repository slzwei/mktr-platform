/**
 * M6 (review round 3): the screening-alert throttle holds under concurrency,
 * on real Postgres.
 *
 * Pre-fix, the throttle was select-then-insert/update: concurrent sweep calls
 * for the same campaign both observed no live row; one insert won, the
 * loser's caught unique error was DISCARDED and both continued to
 * sendEmail(). An EXPIRED row was update-raced the same way, and the
 * per-lead activity's select-then-create could double-write the alert.
 *
 * Post-fix both windows are ONE atomic claim (INSERT … ON CONFLICT
 * (scope,key) DO UPDATE … WHERE expired … RETURNING) — exactly one concurrent
 * caller wins; the revive path after expiry has exactly one winner too.
 */
import { jest } from '@jest/globals'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { sequelize } from '../src/models/index.js'
import { notifyUndeliverableHold } from '../src/services/screeningAlerts.js'

let campaign, prospect

const envBackup = {}
beforeAll(async () => {
  envBackup.SCREENING_ALERT_EMAIL = process.env.SCREENING_ALERT_EMAIL
  process.env.SCREENING_ALERT_EMAIL = 'ops@throttle.test'
  await getApp()
  const admin = await createTestUser({ role: 'admin' })
  campaign = await createTestCampaign(admin.user.id, { name: 'Throttle Race Campaign' })
  prospect = await createTestProspect(campaign.id, {
    quarantinedAt: new Date(Date.now() - 45 * 60 * 1000), // stale enough to alarm
  })
})

afterAll(async () => {
  if (envBackup.SCREENING_ALERT_EMAIL === undefined) delete process.env.SCREENING_ALERT_EMAIL
  else process.env.SCREENING_ALERT_EMAIL = envBackup.SCREENING_ALERT_EMAIL
  await closeDb()
})

const activityCount = async () => {
  const [rows] = await sequelize.query(
    `SELECT count(*)::int AS n FROM prospect_activities
      WHERE "prospectId" = :id AND metadata->>'alert' = 'screening_undeliverable'`,
    { replacements: { id: prospect.id } }
  )
  return rows[0].n
}

test('4 concurrent sweep calls → exactly ONE email and ONE activity; expiry revives for ONE winner', async () => {
  const sendEmail = jest.fn().mockResolvedValue({})

  const wave1 = await Promise.all(
    Array.from({ length: 4 }, () =>
      notifyUndeliverableHold(
        { prospect, reason: 'no_intended_agent', campaign },
        { sendEmail }
      )
    )
  )

  // Pre-fix: every loser fell through its caught unique error and sent too.
  expect(sendEmail).toHaveBeenCalledTimes(1)
  expect(wave1.filter((r) => r.email === 'sent')).toHaveLength(1)
  expect(wave1.filter((r) => r.email === 'throttled')).toHaveLength(3)
  expect(await activityCount()).toBe(1)

  // A second wave inside the 24h window stays silent.
  const inside = await notifyUndeliverableHold(
    { prospect, reason: 'no_intended_agent', campaign },
    { sendEmail }
  )
  expect(inside.email).toBe('throttled')
  expect(sendEmail).toHaveBeenCalledTimes(1)

  // Expire the throttle row, then race again: the conditional DO UPDATE
  // revive has exactly ONE winner (pre-fix both callers updated and sent).
  await sequelize.query(
    `UPDATE idempotency_keys SET "expiresAt" = now() - interval '1 hour'
      WHERE scope = 'screening:undeliverable-alert'
        AND key = 'screening:undeliverable-alert:' || :campaignId`,
    { replacements: { campaignId: campaign.id } }
  )
  const wave2 = await Promise.all(
    Array.from({ length: 3 }, () =>
      notifyUndeliverableHold(
        { prospect, reason: 'no_intended_agent', campaign },
        { sendEmail }
      )
    )
  )
  expect(sendEmail).toHaveBeenCalledTimes(2)
  expect(wave2.filter((r) => r.email === 'sent')).toHaveLength(1)
  expect(await activityCount()).toBe(1) // the once-per-lead claim held throughout
})
