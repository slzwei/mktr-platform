/**
 * @file lyfeClient — low-level Lyfe Supabase REST + breaker + cache.
 *
 * Owns:
 *   - LYFE_SUPABASE_URL / LYFE_SUPABASE_SERVICE_ROLE_KEY env reading
 *   - Per-platform circuit breaker (failure threshold 5, reset 60s)
 *   - 5-minute TTL cache on listAgents and getAgentById results
 *   - Lyfe → ExternalAgent normalisation
 *
 * Higher-level orchestration (User table upserts, deactivation, drift
 * detection, Sentry) lives in agentSyncService.js → kept platform-agnostic.
 */

import { CircuitBreaker } from '../../../utils/circuitBreaker.js';
import { AppError } from '../../../middleware/errorHandler.js';
import { logger } from '../../../utils/logger.js';

// Per-platform breaker. Multiple platforms = multiple breakers; failures on
// HubSpot don't trip Lyfe's breaker.
const breaker = new CircuitBreaker(
  async (url, headers) => {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Lyfe Supabase error: ${response.status} ${body}`);
    }
    return response.json();
  },
  { name: 'lyfe-supabase', failureThreshold: 5, resetTimeoutMs: 60_000 }
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
  const url = process.env.LYFE_SUPABASE_URL;
  const key = process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AppError('LYFE_SUPABASE_URL and LYFE_SUPABASE_SERVICE_ROLE_KEY must be configured', 500);
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
 * Normalise a Lyfe `users` row into the platform-agnostic ExternalAgent
 * shape defined by PlatformAdapter.
 */
function toExternalAgent(row) {
  return {
    externalId: row.id,
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    externalRole: row.role,
    isActive: row.is_active !== false,
    avatarUrl: row.avatar_url ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    createdAt: row.created_at ?? null,
    raw: row,
  };
}

const SELECT_COLUMNS = 'id,full_name,email,phone,role,is_active,avatar_url,date_of_birth,created_at';

/**
 * Fetch all assignable agents (agent/manager/director, active, non-test).
 *
 * Filters to `is_active=true` and `is_test_data=false` at the source so we
 * don't ship inactive or test rows over the wire. The orchestrator
 * separately handles deactivation of locally-stored agents that are no
 * longer in the upstream set.
 *
 * @param {{ roles?: ('agent'|'manager'|'director')[] }} [filters]
 */
export async function fetchAgents(filters = {}) {
  const cacheKey = `agents:${JSON.stringify(filters)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getConfig();
  const roles = filters.roles || ['agent', 'director', 'manager'];
  const roleFilter = `role=in.(${roles.join(',')})`;

  let rows;
  try {
    rows = await breaker.fire(
      `${url}/rest/v1/users?${roleFilter}&is_active=eq.true&is_test_data=eq.false&select=${SELECT_COLUMNS}&order=full_name`,
      authHeaders(key)
    );
  } catch (err) {
    logger.error({ err, breaker: breaker.getState() }, '[LyfeAdapter] fetchAgents failed');
    throw err;
  }

  const normalized = rows.map(toExternalAgent);
  setCache(cacheKey, normalized);
  return normalized;
}

/**
 * Fetch one agent by externalId. Throws if not found. Uses cache.
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
      `${url}/rest/v1/users?id=eq.${externalId}&is_test_data=eq.false&select=${SELECT_COLUMNS}`,
      authHeaders(key)
    );
  } catch (err) {
    logger.error({ err, breaker: breaker.getState() }, '[LyfeAdapter] fetchAgentById failed');
    throw err;
  }

  if (!rows.length) throw new Error(`Agent not found in Lyfe: ${externalId}`);
  const normalized = toExternalAgent(rows[0]);
  setCache(cacheKey, normalized);
  return normalized;
}

/** Exposed for tests + observability. */
export function _getBreakerState() {
  return breaker.getState();
}
