/**
 * @file mktrLeadsClient — low-level mktr-leads Supabase REST + breaker + cache.
 *
 * mktr-leads is a second agent source alongside Lyfe (separate Supabase
 * project). Its agents are lead-workers stored in a public `agents` table keyed
 * by `mktr_user_id` (the id its receive-mktr-lead edge function matches on).
 *
 * Owns:
 *   - MKTR_LEADS_SUPABASE_URL / MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY env reading
 *   - Per-platform circuit breaker (failure threshold 5, reset 60s)
 *   - 5-minute TTL cache on listAgents and getAgentById results
 *   - mktr-leads `agents` row → ExternalAgent normalisation
 *
 * Mirrors lyfeClient.js. Higher-level orchestration (User upserts, deactivation,
 * one-source-per-user safety) lives in agentSyncService.js — kept platform-
 * agnostic via the generic runSync.
 */

import { CircuitBreaker } from '../../../utils/circuitBreaker.js';
import { AppError } from '../../../middleware/errorHandler.js';
import { logger } from '../../../utils/logger.js';

// Per-platform breaker. Failures here don't trip Lyfe's breaker.
const breaker = new CircuitBreaker(
  async (url, headers) => {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`mktr-leads Supabase error: ${response.status} ${body}`);
    }
    return response.json();
  },
  { name: 'mktr-leads-supabase', failureThreshold: 5, resetTimeoutMs: 60_000 }
);

// Per-platform TTL cache.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

export function invalidateCache() {
  cache.clear();
}

function getConfig() {
  const url = process.env.MKTR_LEADS_SUPABASE_URL;
  const key = process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AppError(
      'MKTR_LEADS_SUPABASE_URL and MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY must be configured',
      500
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

function authHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Normalise an mktr-leads `agents` row into the platform-agnostic ExternalAgent
 * shape defined by PlatformAdapter.
 *
 * externalId = `mktr_user_id` (NOT the auth `id`): that is the key the
 * mktr-leads receiver matches `routing.agentExternalId` against.
 */
function toExternalAgent(row) {
  return {
    externalId: row.mktr_user_id,
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    externalRole: row.role,
    isActive: row.is_active !== false,
    agency: row.agency ?? null,
    avatarUrl: null,
    dateOfBirth: null,
    createdAt: row.created_at ?? null,
    raw: row,
  };
}

const SELECT_COLUMNS = 'mktr_user_id,full_name,email,phone,role,is_active,agency,created_at';

/**
 * Fetch ALL mktr-leads agents — active AND inactive.
 *
 * `role=in.(agent,manager)` is filtered AT THE SOURCE and is mandatory: mktr-leads
 * has an `admin` role that must never become an assignable MKTR agent (a promotion
 * to admin drops the row from this list → the sync retires it locally). Managers
 * ARE lead buyers — they hold their own leads — so an agent→manager promotion keeps
 * the row IN this feed and must never trip the two-phase retirement (FMEA F09);
 * the upstream role rides `externalRole` while the local users row stays role=agent.
 *
 * `is_active` is intentionally NOT filtered (unlike Lyfe): the adapter declares
 * `mirrorsIsActive`, so runSync mirrors each row's is_active directly. Fetching
 * active-only would make a deactivated agent look DELETED upstream — the sync's
 * two-phase deletion would then hard-delete the local row after the grace
 * window, cascading away its lead-package assignments. Only rows truly absent
 * from this list (account deleted / promoted to admin) may be retired.
 */
export async function fetchAgents() {
  const cacheKey = 'agents';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getConfig();

  let rows;
  try {
    rows = await breaker.fire(
      `${url}/rest/v1/agents?role=in.(agent,manager)&select=${SELECT_COLUMNS}&order=full_name`,
      authHeaders(key)
    );
  } catch (err) {
    logger.error({ err, breaker: breaker.getState() }, '[MktrLeadsAdapter] fetchAgents failed');
    throw err;
  }

  const normalized = rows.map(toExternalAgent);
  setCache(cacheKey, normalized);
  return normalized;
}

/**
 * Fetch one agent by externalId (mktr_user_id). Throws if not found. Uses cache.
 *
 * @param {string} externalId
 */
export async function fetchAgentById(externalId) {
  const cacheKey = `agent:${externalId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getConfig();

  let rows;
  try {
    rows = await breaker.fire(
      `${url}/rest/v1/agents?mktr_user_id=eq.${encodeURIComponent(externalId)}&select=${SELECT_COLUMNS}`,
      authHeaders(key)
    );
  } catch (err) {
    logger.error({ err, breaker: breaker.getState() }, '[MktrLeadsAdapter] fetchAgentById failed');
    throw err;
  }

  if (!rows.length) throw new Error(`Agent not found in mktr-leads: ${externalId}`);
  const normalized = toExternalAgent(rows[0]);
  setCache(cacheKey, normalized);
  return normalized;
}

// ── Management write-backs (mktr-leads is the source of truth) ──────────────
// Plain fetch, NOT the read breaker: a tripped sync breaker must not block an
// admin action, and a failed admin action must not trip the sync breaker.

const WRITE_TIMEOUT_MS = 10_000;

/**
 * Create a pending invitation by calling mktr-leads' own create-ext-agent-invite
 * edge function — the EF is the single owner of invitation semantics (canonical
 * SG phone normalization, agent-exists guard, revoke-then-insert re-invite,
 * optional email). Returns { status, body } for the caller to map; non-2xx is
 * NOT thrown (409/400 carry meaning).
 *
 * Auth is two-part: the service-role bearer passes the platform verify_jwt
 * gate, and the dedicated `x-service-secret` (MKTR_LEADS_INVITE_SECRET, equal
 * to the EF's MKTR_PLATFORM_INVITE_SECRET) is what the EF actually trusts —
 * the runtime-injected SUPABASE_SERVICE_ROLE_KEY is not string-comparable
 * across Supabase key formats, so a dedicated rotatable secret is used instead.
 */
export async function createInvitation({ phone, fullName, email, agency }) {
  const { url, key } = getConfig();
  const inviteSecret = process.env.MKTR_LEADS_INVITE_SECRET;
  if (!inviteSecret) {
    throw new AppError('MKTR_LEADS_INVITE_SECRET must be configured for mktr-leads invites', 500);
  }
  const response = await fetch(`${url}/functions/v1/create-ext-agent-invite`, {
    method: 'POST',
    headers: { ...authHeaders(key), 'x-service-secret': inviteSecret },
    body: JSON.stringify({
      phone,
      full_name: fullName || null,
      email: email || null,
      agency: agency || null,
    }),
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

/**
 * PATCH one mktr-leads agent row. The `role=in.(agent,manager)` filter is a hard
 * guard: admin rows can never be touched from here, whatever the caller passes.
 * Returns the updated row, or null when nothing matched (unknown id / admin).
 */
async function patchAgent(mktrUserId, payload) {
  const { url, key } = getConfig();
  const response = await fetch(
    `${url}/rest/v1/agents?mktr_user_id=eq.${encodeURIComponent(mktrUserId)}&role=in.(agent,manager)`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(key), Prefer: 'return=representation' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`mktr-leads agents PATCH failed: ${response.status} ${text}`);
  }
  const rows = await response.json();
  invalidateCache(); // the follow-up sync must see the fresh state
  return rows[0] ?? null;
}

/** Flip is_active. NOTE: false also locks the agent out of the mktr-leads app (OTP gate). */
export async function setAgentActive(mktrUserId, isActive) {
  return patchAgent(mktrUserId, { is_active: isActive === true });
}

/**
 * Update profile fields. `fields` may contain full_name / email / agency —
 * only provided keys are sent (controller validates shape).
 */
export async function updateAgentFields(mktrUserId, fields) {
  const payload = {};
  if ('full_name' in fields) payload.full_name = fields.full_name || null;
  if ('email' in fields) payload.email = fields.email || null;
  if ('agency' in fields) payload.agency = fields.agency || null;
  return patchAgent(mktrUserId, payload);
}

/** Exposed for tests + observability. */
export function _getBreakerState() {
  return breaker.getState();
}
