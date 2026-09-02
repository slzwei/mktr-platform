import crypto from 'crypto';
import { query, withTransaction } from './db.js';

/**
 * The durable, ordered work queue.
 *
 * Ordering contract:
 *   - `priority` 0 = production, 1 = sandbox. The lease scan sorts by priority
 *     then enqueue time, so a production request is ALWAYS taken before any
 *     sandbox request already waiting. Sandbox traffic can never delay it.
 *   - `FOR UPDATE SKIP LOCKED` makes redundant intake instances safe: several
 *     processes may accept work, exactly one leases each item, and only the
 *     lease-holder sends.
 *   - A lease expires (`lease_until`), so an instance killed mid-send has its
 *     item re-leased rather than lost. `attempts` bounds that recovery.
 */

const LEASE_SECONDS = Number(process.env.DNC_GATEWAY_LEASE_SECONDS) || 45;
const MAX_ATTEMPTS = Number(process.env.DNC_GATEWAY_MAX_ATTEMPTS) || 3;

export async function enqueue({ source, numbers, checkOnBehalf, idempotencyKey }) {
  const id = crypto.randomUUID();
  const priority = source === 'production' ? 0 : 1;
  const { rows } = await query(
    `INSERT INTO dnc_queue_items (id, source, priority, numbers, check_on_behalf, idempotency_key)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (source, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET enqueued_at = dnc_queue_items.enqueued_at
     RETURNING *`,
    [id, source, priority, JSON.stringify(numbers), checkOnBehalf, idempotencyKey || null],
  );
  return rows[0];
}

/** Lease the next item — production first, then oldest. Null when the queue is idle. */
export async function leaseNext() {
  const { rows } = await query(
    `WITH next AS (
       SELECT id FROM dnc_queue_items
        WHERE status = 'queued'
           OR (status = 'leased' AND lease_until < now() AND attempts < $2)
        ORDER BY priority ASC, enqueued_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE dnc_queue_items q
        SET status      = 'leased',
            lease_until = now() + ($1 || ' seconds')::interval,
            attempts    = q.attempts + 1,
            started_at  = COALESCE(q.started_at, now())
       FROM next
      WHERE q.id = next.id
      RETURNING q.*`,
    [String(LEASE_SECONDS), MAX_ATTEMPTS],
  );
  return rows[0] || null;
}

export async function complete(id, { httpStatus, result, pdpcTimestamp }) {
  await query(
    `UPDATE dnc_queue_items
        SET status = 'done', completed_at = now(), http_status = $2,
            result = $3::jsonb, pdpc_timestamp = $4, error = NULL
      WHERE id = $1`,
    [id, httpStatus ?? null, JSON.stringify(result ?? null), pdpcTimestamp ?? null],
  );
}

export async function fail(id, error, { terminal = false } = {}) {
  await query(
    `UPDATE dnc_queue_items
        SET status = CASE WHEN $3 OR attempts >= $4 THEN 'failed' ELSE 'queued' END,
            completed_at = CASE WHEN $3 OR attempts >= $4 THEN now() ELSE NULL END,
            lease_until = NULL,
            error = $2
      WHERE id = $1`,
    [id, String(error).slice(0, 500), terminal, MAX_ATTEMPTS],
  );
}

export async function block(id, reason) {
  await query(
    `UPDATE dnc_queue_items
        SET status = 'blocked', completed_at = now(), error = $2,
            result = $3::jsonb
      WHERE id = $1`,
    [id, reason, JSON.stringify({ blocked: true, blockedReason: reason })],
  );
}

export async function getItem(id) {
  const { rows } = await query('SELECT * FROM dnc_queue_items WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function findByIdempotency(source, key) {
  if (!key) return null;
  const { rows } = await query(
    'SELECT * FROM dnc_queue_items WHERE source = $1 AND idempotency_key = $2',
    [source, key],
  );
  return rows[0] || null;
}

/**
 * Allocate the next PDPC timestamp. Persisted and strictly increasing across
 * restarts and instances — the single most important ordering guarantee here,
 * because PDPC rejects a repeated or regressed timestamp with S403.
 */
export async function nextPdpcTimestamp(now = Date.now()) {
  const { rows } = await query(
    `UPDATE dnc_gateway_clock
        SET last_timestamp = GREATEST(last_timestamp + 1, $1::bigint),
            updated_at = now()
      WHERE id = 1
      RETURNING last_timestamp`,
    [String(now)],
  );
  return Number(rows[0].last_timestamp);
}

/**
 * Hold the one global send lock for the duration of `fn`. Only the lock-holder
 * may talk to PDPC, so calls are strictly serialised no matter how many gateway
 * instances are running.
 */
export async function withSendLock(fn) {
  return withTransaction(async (client) => {
    await client.query(`SET LOCAL lock_timeout = '30s'`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('dnc_gateway_send'))`);
    return fn(client);
  });
}

export async function stats() {
  const { rows } = await query(
    `SELECT source, status, count(*)::int AS count
       FROM dnc_queue_items
      WHERE enqueued_at > now() - interval '7 days'
      GROUP BY source, status`,
  );
  const { rows: depth } = await query(
    `SELECT source, count(*)::int AS count FROM dnc_queue_items
      WHERE status IN ('queued','leased') GROUP BY source`,
  );
  const { rows: clock } = await query('SELECT last_timestamp FROM dnc_gateway_clock WHERE id = 1');
  return {
    last7Days: rows,
    pendingDepth: Object.fromEntries(depth.map((r) => [r.source, r.count])),
    lastPdpcTimestamp: clock[0] ? Number(clock[0].last_timestamp) : null,
  };
}

export const constants = { LEASE_SECONDS, MAX_ATTEMPTS };

export default { enqueue, leaseNext, complete, fail, block, getItem, findByIdempotency, nextPdpcTimestamp, withSendLock, stats, constants };
