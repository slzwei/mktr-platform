/**
 * P2-13 regression: the keyspace the code reasons about is the one the
 * database enforces.
 *
 * `key` alone was the primary key while `scope` was a plain column — and every
 * lookup in idempotencyProtocol filters by {key, scope}. Two consequences:
 *
 *  (a) the same client idempotency key sent to two DIFFERENT scopes collided
 *      on insert while the scoped replay lookup found nothing to replay, so the
 *      second operation errored instead of running;
 *  (b) claimOrReplay never looked at expiresAt, so a crash between the
 *      null-body claim and recordClaimed left that row for the full 24h TTL and
 *      every retry got `in_progress` — a key poisoned by a dead process.
 */
import { IdempotencyKey, sequelize } from '../src/models/index.js';
import { makeIdempotencyOps, IDEMP_TTL_MS, CLAIM_STALE_MS } from '../src/services/idempotencyProtocol.js';
import { getApp, closeDb } from './helpers.js';

const ops = makeIdempotencyOps(IdempotencyKey);
const KEY = 'client-supplied-key-p2-13';
const SCOPE_A = 'held:release';
const SCOPE_B = 'held:reassign';

/** Write a claim as a PREVIOUS process would have — `agoMs` in the past. */
const plantClaim = (scope, key, { agoMs, responseBody = null }) => IdempotencyKey.create({
  scope, key, responseBody, responseCode: responseBody ? 200 : null,
  expiresAt: new Date(Date.now() - agoMs + IDEMP_TTL_MS),
});

beforeAll(async () => { await getApp(); });

beforeEach(async () => {
  await IdempotencyKey.destroy({ where: { key: KEY } });
});

afterAll(async () => {
  await IdempotencyKey.destroy({ where: { key: KEY } });
  await closeDb();
});

describe('the same key in two scopes', () => {
  it('claims independently — one does not block the other', async () => {
    const first = await ops.claimOrReplay(SCOPE_A, KEY);
    const second = await ops.claimOrReplay(SCOPE_B, KEY);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(true);
  });

  it('records and replays per scope, never crossing', async () => {
    await ops.claimOrReplay(SCOPE_A, KEY);
    await ops.recordClaimed(SCOPE_A, KEY, { status: 'ok', from: 'A' });
    await ops.claimOrReplay(SCOPE_B, KEY);
    await ops.recordClaimed(SCOPE_B, KEY, { status: 'ok', from: 'B' });

    expect(await ops.replayIfDone(SCOPE_A, KEY)).toEqual({ status: 'ok', from: 'A' });
    expect(await ops.replayIfDone(SCOPE_B, KEY)).toEqual({ status: 'ok', from: 'B' });
  });

  it('stores one row per scope', async () => {
    await ops.claimOrReplay(SCOPE_A, KEY);
    await ops.claimOrReplay(SCOPE_B, KEY);

    const rows = await IdempotencyKey.findAll({ where: { key: KEY } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.scope).sort()).toEqual([SCOPE_B, SCOPE_A].sort());
  });

  it('enforces uniqueness WITHIN a scope — a replay is still a replay', async () => {
    const first = await ops.claimOrReplay(SCOPE_A, KEY);
    const second = await ops.claimOrReplay(SCOPE_A, KEY);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.replay).toEqual({ status: 'error', error: 'in_progress' });
  });
});

describe('an abandoned claim does not poison the key', () => {
  it('is reclaimable once it is older than the stale window', async () => {
    await plantClaim(SCOPE_A, KEY, { agoMs: CLAIM_STALE_MS + 60_000 });

    const retry = await ops.claimOrReplay(SCOPE_A, KEY);

    expect(retry.claimed).toBe(true);
  });

  it('leaves a RECENT claim alone — that operation may still be running', async () => {
    await plantClaim(SCOPE_A, KEY, { agoMs: 1_000 });

    const retry = await ops.claimOrReplay(SCOPE_A, KEY);

    expect(retry.claimed).toBe(false);
    expect(retry.replay).toEqual({ status: 'error', error: 'in_progress' });
  });

  it('re-arms the TTL when it reclaims, so the next crash gets the same grace', async () => {
    await plantClaim(SCOPE_A, KEY, { agoMs: CLAIM_STALE_MS + 60_000 });

    await ops.claimOrReplay(SCOPE_A, KEY);

    const row = await IdempotencyKey.findOne({ where: { key: KEY, scope: SCOPE_A } });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + IDEMP_TTL_MS - 60_000);
    expect(row.responseBody).toBeNull();
  });

  it('reclaims an EXPIRED completed record rather than replaying a dead answer', async () => {
    await plantClaim(SCOPE_A, KEY, { agoMs: IDEMP_TTL_MS + 60_000, responseBody: { status: 'ok', stale: true } });

    const retry = await ops.claimOrReplay(SCOPE_A, KEY);

    expect(retry.claimed).toBe(true);
  });

  it('still replays an UNEXPIRED completed record', async () => {
    await plantClaim(SCOPE_A, KEY, { agoMs: 1_000, responseBody: { status: 'ok', fresh: true } });

    const retry = await ops.claimOrReplay(SCOPE_A, KEY);

    expect(retry.claimed).toBe(false);
    expect(retry.replay).toEqual({ status: 'ok', fresh: true });
  });

  it('only ONE of two concurrent reclaimers wins', async () => {
    await plantClaim(SCOPE_A, KEY, { agoMs: CLAIM_STALE_MS + 60_000 });

    const [a, b] = await Promise.all([
      ops.claimOrReplay(SCOPE_A, KEY),
      ops.claimOrReplay(SCOPE_A, KEY),
    ]);

    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
  });
});

describe('schema', () => {
  it('the primary key is (scope, key)', async () => {
    const [[pk]] = await sequelize.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'p'
    `);
    expect(pk.def.replace(/"/g, '')).toBe('PRIMARY KEY (scope, key)');
  });
});
