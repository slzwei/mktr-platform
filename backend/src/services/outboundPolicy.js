import { logger as defaultLogger } from '../utils/logger.js';
import { deployEnv, isSandbox, flagOn } from '../utils/deployEnv.js';
import {
  bump,
  unbump,
  blindIdentifier,
  sgtDayKey,
  nextSgtMidnight,
  sgtMonthKey,
  nextSgtMonthStart,
} from './rateCounter.js';

/**
 * outboundPolicy — the single chokepoint every live provider rail passes through
 * in the sandbox deployment (docs/plans/mktr-production-sandbox.md §6.2).
 *
 * Why a shared module rather than a check per caller: OTP has four entry points
 * (form send, WhatsApp fallback, resend, campaign preview) and DNC has five
 * (form check, create-time check, Retell, backfill, gateway). A per-caller check
 * is a per-caller bug. This module sits at the LOWEST boundary — immediately
 * before the provider adapter — so a new caller inherits the guard for free.
 *
 * Contract:
 *   - In `production` / `development` / `test` deployments every call returns
 *     `{ allowed: true, enforced: false }`. Production behaviour is UNCHANGED;
 *     its own ceilings (smsQuota, DNC hourly budget) still apply above this.
 *   - In `sandbox` the rail is DENIED unless, in order:
 *       1. the rail's kill switch is explicitly on,
 *       2. the destination parses to an exact E.164 / lowercase address,
 *       3. the destination is not on the hard deny list,
 *       4. the destination is on the exact allowlist,
 *       5. per-destination daily, global daily and global monthly budgets all
 *          have room (durable counters — a restart cannot reset spend).
 *     Steps 1–4 touch no database and no provider, so a non-allowlisted
 *     destination is refused before any request is built.
 *
 * Never logs a raw destination — only a keyed blind hash, the same primitive the
 * SMS quota counters use, so this table stays outside the PDPA erasure matrix.
 */

export const RAILS = /** @type {const} */ (['otp', 'dnc', 'email']);

const RAIL_SWITCH = {
  otp: 'SANDBOX_LIVE_OTP_ENABLED',
  dnc: 'SANDBOX_LIVE_DNC_ENABLED',
  email: 'SANDBOX_LIVE_EMAIL_ENABLED',
};

/** Starting caps from the plan §6.2 — deliberately tiny, raise only with ops sign-off. */
const DEFAULT_CAPS = { perDestDaily: 3, globalDaily: 10, globalMonthly: 50 };

const num = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function railCaps(rail) {
  const R = rail.toUpperCase();
  return {
    perDestDaily: num(process.env[`SANDBOX_${R}_PER_DEST_DAILY_CAP`], DEFAULT_CAPS.perDestDaily),
    globalDaily: num(process.env[`SANDBOX_${R}_DAILY_CAP`], DEFAULT_CAPS.globalDaily),
    globalMonthly: num(process.env[`SANDBOX_${R}_MONTHLY_CAP`], DEFAULT_CAPS.globalMonthly),
  };
}

// ── Destination normalisation ────────────────────────────────────────────────

/**
 * Exact E.164 for Singapore-shaped inputs; `null` when the value cannot be
 * resolved to one unambiguous number. Matching is on the NORMALISED form only —
 * "91234567", "+6591234567" and "65 9123 4567" are the same destination, and a
 * value we cannot normalise is never allowlisted.
 */
export function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Local 8-digit SG number (3/6/8/9 prefix).
  if (digits.length === 8 && /^[3689]/.test(digits)) return `+65${digits}`;
  // 65XXXXXXXX with or without a leading '+'.
  if (digits.length === 10 && digits.startsWith('65') && /^[3689]/.test(digits.slice(2))) {
    return `+65${digits.slice(2)}`;
  }
  // Any other international number: keep it only when it was written in E.164.
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Conservative email normalisation — trim + lowercase, exact match only, no wildcards. */
export function normalizeEmail(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  return raw;
}

function parseList(name, normalize) {
  const raw = process.env[name];
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((entry) => normalize(entry))
    .filter(Boolean);
}

// ── Hard deny list ───────────────────────────────────────────────────────────

/**
 * Numbers configured in Supabase with the FIXED test OTP `555555`
 * (docs/plans/mktr-production-sandbox.md §7.1). Sandbox logins for these
 * identities are satisfied by Supabase's fixed code, so MKTR must never spend a
 * real SMS or a real DNC credit on one. This list wins over the allowlist: a
 * mistaken allowlist entry cannot unblock them.
 */
const FIXED_CODE_RANGES = [
  ['+6580000001', '+6580000007'],
  ['+6580000101', '+6580000102'],
  ['+6580000110', '+6580000114'],
  ['+6580000201', '+6580000230'],
  ['+6590000001', '+6590000009'],
  ['+6599999999', '+6599999999'],
];

function inFixedCodeInventory(e164) {
  if (!e164 || !e164.startsWith('+65') || e164.length !== 11) return false;
  const n = Number(e164.slice(1));
  return FIXED_CODE_RANGES.some(([lo, hi]) => n >= Number(lo.slice(1)) && n <= Number(hi.slice(1)));
}

/** Extra operator-supplied denials, always applied on top of the fixed-code inventory. */
function extraDeniedPhones() {
  return parseList('SANDBOX_BLOCKED_PHONES', normalizePhone);
}

export function isDeniedPhone(e164) {
  if (!e164) return false;
  if (flagOn('SANDBOX_ALLOW_FIXED_CODE_NUMBERS')) {
    // Escape hatch for a future deliberate test; still subject to the allowlist
    // and every budget below. Off by default and never set in the sandbox.
    return extraDeniedPhones().includes(e164);
  }
  return inFixedCodeInventory(e164) || extraDeniedPhones().includes(e164);
}

// ── Decisions ────────────────────────────────────────────────────────────────

/** @typedef {{allowed: boolean, enforced: boolean, reason?: string, destination?: string, counters?: object}} RailDecision */

const ALLOW_UNENFORCED = { allowed: true, enforced: false };

function deny(reason, extra = {}) {
  return { allowed: false, enforced: true, reason, ...extra };
}

function auditKeys(rail, blind, now) {
  const day = sgtDayKey(now);
  const month = sgtMonthKey(now);
  return {
    day,
    month,
    perDest: `sbx:${rail}:dest:${blind}:${day}`,
    globalDay: `sbx:${rail}:day:${day}`,
    globalMonth: `sbx:${rail}:month:${month}`,
  };
}

/**
 * Guard one outbound attempt on a phone rail ('otp' | 'dnc').
 *
 * Reserves budget on success — call {@link releasePhoneRail} when the provider
 * call did not happen (our own outage), so a failure on our side does not eat
 * the day's tiny allowance.
 *
 * @returns {Promise<RailDecision>}
 */
export async function guardPhoneRail(rail, phone, deps = {}) {
  const log = deps.logger || defaultLogger;
  if (!RAILS.includes(rail)) throw new Error(`outboundPolicy: unknown rail "${rail}"`);
  if (!isSandbox()) return ALLOW_UNENFORCED;

  const decision = await evaluatePhoneRail(rail, phone, deps);
  log[decision.allowed ? 'info' : 'warn'](
    {
      deploy_env: deployEnv(),
      rail,
      decision: decision.allowed ? 'allowed' : 'blocked',
      reason: decision.reason || null,
      destination_hash: decision.destinationHash || null,
      counters: decision.counters || null,
    },
    `outbound_policy.${rail}.${decision.allowed ? 'allowed' : 'blocked'}`,
  );
  return decision;
}

async function evaluatePhoneRail(rail, phone, deps) {
  // 1. Kill switch — no database, no provider, no normalisation needed.
  if (!flagOn(RAIL_SWITCH[rail])) return deny('rail_disabled');

  // 2. Destination must resolve to exactly one E.164 number.
  const e164 = normalizePhone(phone);
  if (!e164) return deny('bad_destination');
  const blind = blindIdentifier(e164);

  // 3. Hard deny list beats everything below it.
  if (isDeniedPhone(e164)) return deny('blocked_destination', { destinationHash: blind });

  // 4. Exact allowlist.
  const allowlist = parseList('SANDBOX_ALLOWED_PHONES', normalizePhone);
  if (allowlist.length === 0) return deny('empty_allowlist', { destinationHash: blind });
  if (!allowlist.includes(e164)) return deny('not_allowlisted', { destinationHash: blind });

  // 5. Durable budgets. Only now do we touch the database.
  return reserveBudgets(rail, e164, blind, deps);
}

async function reserveBudgets(rail, destination, blind, deps) {
  const now = deps.now || new Date();
  const caps = railCaps(rail);
  const keys = auditKeys(rail, blind, now);
  const bumpFn = deps.bump || bump;
  const unbumpFn = deps.unbump || unbump;
  const taken = [];

  const claim = async (key, expiresAt, cap, reason) => {
    const { count } = await bumpFn(key, expiresAt);
    taken.push(key);
    if (count > cap) return { failed: reason, count, cap };
    return { count, cap };
  };

  const midnight = nextSgtMidnight(now);
  const monthStart = nextSgtMonthStart(now);

  const perDest = await claim(keys.perDest, midnight, caps.perDestDaily, 'per_destination_daily_cap');
  const globalDay = perDest.failed ? null : await claim(keys.globalDay, midnight, caps.globalDaily, 'global_daily_cap');
  const globalMonth = perDest.failed || globalDay.failed
    ? null
    : await claim(keys.globalMonth, monthStart, caps.globalMonthly, 'global_monthly_cap');

  const failure = perDest.failed || globalDay?.failed || globalMonth?.failed;
  const counters = {
    perDestination: `${perDest.count}/${caps.perDestDaily}`,
    globalDaily: globalDay ? `${globalDay.count}/${caps.globalDaily}` : null,
    globalMonthly: globalMonth ? `${globalMonth.count}/${caps.globalMonthly}` : null,
  };

  if (failure) {
    // Hand every claim back: a refused attempt must not consume budget.
    for (const key of taken) await unbumpFn(key).catch(() => {});
    return deny(failure, { destinationHash: blind, counters });
  }

  return { allowed: true, enforced: true, destination, destinationHash: blind, counters, keys };
}

/**
 * Return the budget claimed by a successful {@link guardPhoneRail} when the
 * provider call did not actually happen. No-op outside sandbox.
 */
export async function releasePhoneRail(decision, deps = {}) {
  if (!decision?.enforced || !decision?.keys) return;
  const unbumpFn = deps.unbump || unbump;
  for (const key of [decision.keys.perDest, decision.keys.globalDay, decision.keys.globalMonth]) {
    await unbumpFn(key).catch(() => {});
  }
}

/**
 * Guard one outbound email. Same shape as the phone rails; the allowlist is
 * exact addresses only (no wildcard domains) per the plan §6.2.
 * @returns {Promise<RailDecision>}
 */
export async function guardEmailRail(address, deps = {}) {
  const log = deps.logger || defaultLogger;
  if (!isSandbox()) return ALLOW_UNENFORCED;

  const decision = await evaluateEmailRail(address, deps);
  log[decision.allowed ? 'info' : 'warn'](
    {
      deploy_env: deployEnv(),
      rail: 'email',
      decision: decision.allowed ? 'allowed' : 'blocked',
      reason: decision.reason || null,
      destination_hash: decision.destinationHash || null,
    },
    `outbound_policy.email.${decision.allowed ? 'allowed' : 'blocked'}`,
  );
  return decision;
}

async function evaluateEmailRail(address, deps) {
  if (!flagOn(RAIL_SWITCH.email)) return deny('rail_disabled');
  const email = normalizeEmail(address);
  if (!email) return deny('bad_destination');
  const blind = blindIdentifier(email);
  // Synthetic seed addresses can never be delivered to a real mailbox. Both the
  // reserved `.invalid` TLD and the reserved `example.com`/`example.*` documentation
  // domains are denied outright, so a seeded fixture can never become a live send.
  if (/(^|[.@])(example\.(com|net|org)|test|invalid|localhost)$/.test(email.split('@')[1] || '')) {
    return deny('blocked_destination', { destinationHash: blind });
  }
  if (email.endsWith('.invalid')) return deny('blocked_destination', { destinationHash: blind });
  const allowlist = parseList('SANDBOX_ALLOWED_EMAILS', normalizeEmail);
  if (allowlist.length === 0) return deny('empty_allowlist', { destinationHash: blind });
  if (!allowlist.includes(email)) return deny('not_allowlisted', { destinationHash: blind });
  return reserveBudgets('email', email, blind, deps);
}

/** Snapshot of the effective sandbox policy — for the health endpoint and the runbook. */
export function policySnapshot() {
  const enforced = isSandbox();
  return {
    deployEnv: deployEnv(),
    enforced,
    rails: Object.fromEntries(
      RAILS.map((rail) => [
        rail,
        {
          liveEnabled: flagOn(RAIL_SWITCH[rail]),
          switchVar: RAIL_SWITCH[rail],
          caps: railCaps(rail),
        },
      ]),
    ),
    allowlistedPhoneCount: parseList('SANDBOX_ALLOWED_PHONES', normalizePhone).length,
    allowlistedEmailCount: parseList('SANDBOX_ALLOWED_EMAILS', normalizeEmail).length,
  };
}

export default {
  RAILS,
  normalizePhone,
  normalizeEmail,
  isDeniedPhone,
  guardPhoneRail,
  releasePhoneRail,
  guardEmailRail,
  policySnapshot,
};
