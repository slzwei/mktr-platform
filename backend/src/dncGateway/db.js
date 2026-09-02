import pg from 'pg';

/**
 * The shared DNC queue's OWN database pool.
 *
 * Deliberately not Sequelize and deliberately not the application database:
 *   - production and sandbox each keep their own application database, and the
 *     queue must belong to neither (a sandbox row must never be written into the
 *     production database, and production must never depend on a sandbox one);
 *   - the queue's ordered PDPC timestamp is the one piece of state that must be
 *     globally monotonic, so it needs a single home.
 *
 * Schema is created idempotently at boot (schema.js) — this service has no
 * migration chain of its own to drift from.
 */

const { Pool } = pg;

let pool = null;

export function gatewayPool() {
  if (pool) return pool;
  const connectionString = process.env.DNC_GATEWAY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('FATAL: DNC_GATEWAY_DATABASE_URL (or DATABASE_URL) is required for the DNC gateway.');
  }
  pool = new Pool({
    connectionString,
    max: Number(process.env.DNC_GATEWAY_POOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: /(^|\.)render\.com|sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function query(text, params) {
  return gatewayPool().query(text, params);
}

/** Run `fn` inside one transaction on a dedicated connection. */
export async function withTransaction(fn) {
  const client = await gatewayPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

export default { gatewayPool, query, withTransaction, closePool };
