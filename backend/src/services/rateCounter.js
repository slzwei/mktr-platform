import crypto from 'crypto';
import { sequelize as defaultSequelize } from '../database/connection.js';

/**
 * Durable, atomic counters (table from migration 083).
 *
 * Every mutation is a single statement so concurrent Render instances cannot
 * race: the previous in-memory limiter reset on every redeploy and counted
 * per-process, which is exactly the weakness the SSIR advisory's "cap the
 * volume" bullet asks us to close.
 *
 * Windows are self-healing — a bump that lands after `expiresAt` resets the
 * counter and re-arms the window inside the same UPSERT, so an expired row is
 * never mistaken for a hot one and no sweeper is required for correctness.
 */

// Singapore is UTC+8 year-round (no DST), so day boundaries are pure arithmetic.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for the current Singapore calendar day. */
export function sgtDayKey(now = new Date()) {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next Singapore midnight, as a UTC Date — when a daily window rolls over. */
export function nextSgtMidnight(now = new Date()) {
  const shifted = new Date(now.getTime() + SGT_OFFSET_MS);
  shifted.setUTCHours(24, 0, 0, 0);
  return new Date(shifted.getTime() - SGT_OFFSET_MS);
}

/**
 * Blind a phone number before it becomes part of a counter key.
 *
 * SG mobile numbers are an 8-digit space, so a bare SHA-256 would be trivially
 * reversible — this is keyed. Keeping the table PII-free means person-level
 * erasure (PR C) has nothing to rebuild here.
 */
export function blindPhone(phone) {
  const secret = process.env.SMS_QUOTA_SALT || process.env.JWT_SECRET || 'mktr-dev-salt';
  return crypto.createHmac('sha256', secret).update(String(phone)).digest('hex').slice(0, 32);
}

const BUMP_SQL = `
  INSERT INTO rate_counters (key, count, "expiresAt", "createdAt", "updatedAt")
  VALUES (:key, 1, :expiresAt, now(), now())
  ON CONFLICT (key) DO UPDATE SET
    count       = CASE WHEN rate_counters."expiresAt" <= now() THEN 1
                       ELSE rate_counters.count + 1 END,
    "expiresAt" = CASE WHEN rate_counters."expiresAt" <= now() THEN EXCLUDED."expiresAt"
                       ELSE rate_counters."expiresAt" END,
    "updatedAt" = now()
  RETURNING count, "expiresAt";
`;

/**
 * Increment `key`, arming/re-arming its window to `expiresAt`.
 * @returns {Promise<{count: number, expiresAt: Date}>} the post-increment count.
 */
export async function bump(key, expiresAt, sequelize = defaultSequelize) {
  const [rows] = await sequelize.query(BUMP_SQL, {
    replacements: { key, expiresAt },
  });
  const row = rows?.[0] || {};
  return { count: Number(row.count), expiresAt: new Date(row.expiresAt) };
}

/**
 * Give a hit back — used when a send fails downstream, so an SNS outage doesn't
 * silently eat a real user's daily allowance. Never drops below zero, and never
 * resurrects an expired window.
 */
export async function unbump(key, sequelize = defaultSequelize) {
  await sequelize.query(
    `UPDATE rate_counters
        SET count = GREATEST(count - 1, 0), "updatedAt" = now()
      WHERE key = :key AND "expiresAt" > now()`,
    { replacements: { key } },
  );
}

/** Current count for `key`, or 0 when absent/expired. Does not mutate. */
export async function peek(key, sequelize = defaultSequelize) {
  const [rows] = await sequelize.query(
    `SELECT count, "expiresAt" FROM rate_counters
      WHERE key = :key AND "expiresAt" > now()`,
    { replacements: { key } },
  );
  const row = rows?.[0];
  return row ? { count: Number(row.count), expiresAt: new Date(row.expiresAt) } : { count: 0, expiresAt: null };
}

/** Drop a key outright (express-rate-limit `resetKey`). */
export async function reset(key, sequelize = defaultSequelize) {
  await sequelize.query(`DELETE FROM rate_counters WHERE key = :key`, {
    replacements: { key },
  });
}

/**
 * Hygiene only — expired rows are already inert (bump resets them, peek ignores
 * them). Keeps the table from accumulating a row per phone per day forever.
 */
export async function purgeExpired(sequelize = defaultSequelize) {
  const [, meta] = await sequelize.query(
    `DELETE FROM rate_counters WHERE "expiresAt" <= now() - interval '2 days'`,
  );
  return meta?.rowCount ?? 0;
}
