/**
 * The one-jest-per-database guard (testRunLock.js). Test boot drops every
 * table via sync({force:true}); overlapping runs used to wedge each other
 * into the local "suite hangs forever / Parse Error" flake family. This
 * process acquired the advisory lock during getApp() bootstrap — these tests
 * prove the lock is genuinely held, contended, and idempotent.
 */
import pg from 'pg'
import { getApp, closeDb } from './helpers.js'
import { sequelize } from '../src/models/index.js'
import { acquireTestRunLock } from '../src/database/testRunLock.js'

beforeAll(async () => {
  await getApp()
})

afterAll(async () => {
  await closeDb()
})

test('this run holds the lock: a rival connection cannot take it', async () => {
  const { database, username, password, host, port } = sequelize.config
  const rival = new pg.Client({ host, port, database, user: username, password })
  await rival.connect()
  try {
    const { rows } = await rival.query(
      "SELECT pg_try_advisory_lock(hashtext('mktr_test_run')) AS locked"
    )
    // A second jest process would see exactly this false and fail fast at
    // boot instead of dropping our tables mid-run.
    expect(rows[0].locked).toBe(false)

    // The holder identifies itself as THIS process — the basis for
    // same-run re-entry across jest's per-file vm contexts.
    const { rows: holders } = await rival.query(
      `SELECT a.application_name
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND a.application_name LIKE 'mktr-test-lock:%'`
    )
    expect(holders.map((h) => h.application_name)).toContain(`mktr-test-lock:${process.pid}`)
  } finally {
    await rival.end()
  }
})

test('re-acquiring from the same process resolves (later suites of one run)', async () => {
  await expect(acquireTestRunLock()).resolves.toBeUndefined()
  await expect(acquireTestRunLock()).resolves.toBeUndefined()
})
