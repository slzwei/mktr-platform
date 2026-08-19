import { sequelize } from '../models/index.js';
import { logger } from './logger.js';

/**
 * Shared advisory-lock helpers (ads-centralisation §7.6) — every new singleton
 * background job runs under one of these instead of hand-rolling lock SQL.
 *
 * withAdvisoryLock: SESSION-scoped lock keyed by a STRING (hashed server-side
 * with hashtext). Held on a DEDICATED connection for the duration of `fn` —
 * pooled connections get recycled between queries, which would silently
 * release a session lock mid-job (precedents: testRunLock.js:15-48,
 * enrichmentSweepService.js withAdvisoryLock). Skip-if-held: a second caller
 * gets { acquired: false } and does no work. The unlock + connection release
 * run in `finally` — a throwing fn must never leak the lock.
 *
 * advisoryXactLock: TRANSACTION-scoped variant (pg_advisory_xact_lock) —
 * blocks until granted, releases automatically at commit/rollback. For
 * serializing short critical sections against each other inside transactions
 * (e.g. per-session touchpoint stamp-vs-sweep in P3).
 */
export async function withAdvisoryLock(key, fn) {
  if (typeof key !== 'string' || !key) throw new Error('withAdvisoryLock: key must be a non-empty string');
  const cm = sequelize.connectionManager;
  // The pg-dialect connection is the raw `pg` client; sequelize types it as a
  // bare object, so name the one method we use.
  const conn = /** @type {{ query: (q: { text: string, values: string[] }) => Promise<{ rows?: Array<{ ok?: boolean }> } & Array<{ ok?: boolean }>> }} */ (
    await cm.getConnection({ type: 'write' })
  );
  let acquired = false;
  try {
    const res = await conn.query({ text: 'SELECT pg_try_advisory_lock(hashtext($1)) AS ok', values: [key] });
    acquired = Boolean(res?.rows?.[0]?.ok ?? res?.[0]?.ok);
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await fn() };
  } finally {
    if (acquired) {
      try {
        await conn.query({ text: 'SELECT pg_advisory_unlock(hashtext($1))', values: [key] });
      } catch (err) {
        logger.warn({ key, error: err?.message || String(err) }, 'advisory_lock.unlock_failed');
      }
    }
    cm.releaseConnection(conn);
  }
}

/**
 * Take a transaction-scoped advisory lock inside `transaction`. Blocks until
 * granted; Postgres releases it at commit/rollback (nothing to unlock).
 */
export async function advisoryXactLock(transaction, key) {
  if (!transaction) throw new Error('advisoryXactLock: transaction is required');
  if (typeof key !== 'string' || !key) throw new Error('advisoryXactLock: key must be a non-empty string');
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext($1))', { bind: [key], transaction });
}
