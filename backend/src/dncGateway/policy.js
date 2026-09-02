import crypto from 'crypto';
import { query } from './db.js';
import { formatDncNumber } from '../services/dncProtocol.js';

/**
 * The gateway's OWN sandbox policy — the second, independent enforcement the
 * plan requires (§6.6: "Enforce the sandbox phone allowlist and daily/monthly
 * cap twice: once in the sandbox API and again in the shared gateway").
 *
 * It shares no code path and no database with the sandbox API's guard, so a
 * compromised or misconfigured sandbox cannot spend a production DNC credit on
 * an un-approved number.
 *
 * Production requests are never rate-limited here: production priority and
 * reserved capacity are the point of the queue. Its own hourly budget still
 * applies upstream in dncService.
 */

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

const dayKey = (now) => new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
const monthKey = (now) => new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 7);

function nextMidnight(now) {
  const shifted = new Date(now.getTime() + SGT_OFFSET_MS);
  shifted.setUTCHours(24, 0, 0, 0);
  return new Date(shifted.getTime() - SGT_OFFSET_MS);
}

function nextMonthStart(now) {
  const shifted = new Date(now.getTime() + SGT_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCMonth(shifted.getUTCMonth() + 1);
  return new Date(shifted.getTime() - SGT_OFFSET_MS);
}

const num = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function sandboxCaps() {
  return {
    perNumberDaily: num(process.env.DNC_GATEWAY_SANDBOX_PER_NUMBER_DAILY_CAP, 3),
    daily: num(process.env.DNC_GATEWAY_SANDBOX_DAILY_CAP, 10),
    monthly: num(process.env.DNC_GATEWAY_SANDBOX_MONTHLY_CAP, 50),
  };
}

/** Exact 8-digit local numbers the sandbox may check. Empty ⇒ nothing is allowed. */
export function sandboxAllowlist() {
  return String(process.env.DNC_GATEWAY_SANDBOX_ALLOWED_NUMBERS || '')
    .split(',')
    .map((entry) => formatDncNumber(entry.trim()))
    .filter(Boolean);
}

function blind(value) {
  const secret = process.env.DNC_GATEWAY_HASH_SALT || 'dnc-gateway-salt';
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 32);
}

const BUMP_SQL = `
  INSERT INTO dnc_gateway_usage (key, count, expires_at, updated_at)
  VALUES ($1, 1, $2, now())
  ON CONFLICT (key) DO UPDATE SET
    count      = CASE WHEN dnc_gateway_usage.expires_at <= now() THEN 1
                      ELSE dnc_gateway_usage.count + 1 END,
    expires_at = CASE WHEN dnc_gateway_usage.expires_at <= now() THEN EXCLUDED.expires_at
                      ELSE dnc_gateway_usage.expires_at END,
    updated_at = now()
  RETURNING count`;

async function bump(key, expiresAt) {
  const { rows } = await query(BUMP_SQL, [key, expiresAt]);
  return Number(rows[0].count);
}

async function unbump(key) {
  await query(
    `UPDATE dnc_gateway_usage SET count = GREATEST(count - 1, 0), updated_at = now()
      WHERE key = $1 AND expires_at > now()`,
    [key],
  );
}

/**
 * Admit or refuse one batch. Returns `{ allowed }` or `{ allowed: false, reason }`.
 * Budget claimed on success; `releaseSandboxBudget` hands it back when the PDPC
 * call never happened.
 */
export async function admit({ source, numbers }, now = new Date()) {
  if (source === 'production') return { allowed: true, keys: [] };

  const allowlist = sandboxAllowlist();
  if (allowlist.length === 0) return { allowed: false, reason: 'gateway_empty_allowlist' };
  for (const number of numbers) {
    if (!allowlist.includes(number)) return { allowed: false, reason: 'gateway_not_allowlisted' };
  }

  const caps = sandboxCaps();
  const day = dayKey(now);
  const month = monthKey(now);
  const midnight = nextMidnight(now);
  const monthStart = nextMonthStart(now);
  const taken = [];

  const claim = async (key, expiresAt, cap, reason) => {
    const count = await bump(key, expiresAt);
    taken.push(key);
    return count > cap ? reason : null;
  };

  for (const number of numbers) {
    const failure = await claim(
      `sbx:num:${blind(number)}:${day}`, midnight, caps.perNumberDaily, 'gateway_per_number_daily_cap',
    );
    if (failure) {
      for (const key of taken) await unbump(key).catch(() => {});
      return { allowed: false, reason: failure };
    }
  }

  const dailyFail = await claim(`sbx:day:${day}`, midnight, caps.daily, 'gateway_daily_cap');
  const monthlyFail = dailyFail ? null : await claim(`sbx:month:${month}`, monthStart, caps.monthly, 'gateway_monthly_cap');
  const failure = dailyFail || monthlyFail;
  if (failure) {
    for (const key of taken) await unbump(key).catch(() => {});
    return { allowed: false, reason: failure };
  }

  return { allowed: true, keys: taken };
}

export async function releaseSandboxBudget(keys = []) {
  for (const key of keys) await unbump(key).catch(() => {});
}

export default { admit, releaseSandboxBudget, sandboxCaps, sandboxAllowlist };
