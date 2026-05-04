import { Op } from 'sequelize';
import * as Sentry from '@sentry/node';
import User from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { logger } from '../utils/logger.js';

// Threshold above which a sync run is treated as suspicious (likely upstream
// data wipe or misconfiguration). Triggers a Sentry warning, does not block.
// Tuned to ~20% per FMEA F12.
const SYNC_DRIFT_DEACTIVATION_RATIO = 0.2;

// Circuit breaker for Lyfe Supabase API calls (agent sync)
const lyfeSupabaseBreaker = new CircuitBreaker(
  async (url, headers) => {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Lyfe Supabase error: ${response.status} ${body}`);
    }
    return response.json();
  },
  { name: 'lyfe-supabase', failureThreshold: 5, resetTimeoutMs: 60_000 }
);

// Simple TTL cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

export function invalidateCache() {
  cache.clear();
}

function getLyfeConfig() {
  const url = process.env.LYFE_SUPABASE_URL;
  const key = process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AppError('LYFE_SUPABASE_URL and LYFE_SUPABASE_SERVICE_ROLE_KEY must be configured', 500);
  }
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Fetch agents from Lyfe Supabase (users table with role in agent, pa, director, manager).
 * Uses service_role key to bypass RLS.
 */
export async function fetchAgents(filters = {}) {
  const cacheKey = `agents:${JSON.stringify(filters)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getLyfeConfig();

  const roles = filters.roles || ['agent', 'director', 'manager'];
  const roleFilter = `role=in.(${roles.join(',')})`;

  let agents;
  try {
    agents = await lyfeSupabaseBreaker.fire(
      `${url}/rest/v1/users?${roleFilter}&is_active=eq.true&is_test_data=eq.false&select=id,full_name,email,phone,role,avatar_url,date_of_birth,created_at&order=full_name`,
      {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    );
  } catch (err) {
    logger.error({ err, breaker: lyfeSupabaseBreaker.getState() }, '[AgentSync] fetchAgents failed');
    throw err;
  }

  // Normalize to the shape the rest of the codebase expects
  const normalized = agents.map(a => ({
    id: a.id,
    name: a.full_name,
    email: a.email,
    phone: a.phone,
    role: a.role,
    avatarUrl: a.avatar_url,
    dateOfBirth: a.date_of_birth,
    createdAt: a.created_at
  }));

  setCache(cacheKey, normalized);
  return normalized;
}

/**
 * Fetch a single agent by ID from Lyfe Supabase.
 */
export async function fetchAgentById(id) {
  const cacheKey = `agent:${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getLyfeConfig();

  let rows;
  try {
    rows = await lyfeSupabaseBreaker.fire(
      `${url}/rest/v1/users?id=eq.${id}&is_test_data=eq.false&select=id,full_name,email,phone,role,avatar_url,date_of_birth,created_at`,
      {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    );
  } catch (err) {
    logger.error({ err, breaker: lyfeSupabaseBreaker.getState() }, '[AgentSync] fetchAgentById failed');
    throw err;
  }
  if (!rows.length) throw new Error('Agent not found in Lyfe');

  const a = rows[0];
  const agent = {
    id: a.id,
    name: a.full_name,
    email: a.email,
    phone: a.phone,
    role: a.role,
    avatarUrl: a.avatar_url,
    dateOfBirth: a.date_of_birth,
    createdAt: a.created_at
  };

  setCache(cacheKey, agent);
  return agent;
}

/**
 * Fetch agent groups is not applicable for Supabase-based Lyfe.
 * Returns empty array for backward compatibility.
 */
export async function fetchAgentGroups() {
  return [];
}

/**
 * Sync agents from Lyfe into the local User table.
 * Find-or-creates local users, updates stale records, deactivates agents
 * no longer present in Lyfe.
 *
 * @returns {{ created: number, updated: number, deactivated: number, skipped: number, total: number }}
 */
export async function syncAgentsFromLyfe() {
  const startedAt = Date.now();
  let lyfeAgents;
  let allAgents;
  try {
    invalidateCache();
    lyfeAgents = await fetchAgents();

    // Pre-fetch all local agents into maps for O(1) lookups instead of per-agent findOne queries
    allAgents = await User.findAll({
      where: { role: 'agent' },
      attributes: ['id', 'lyfeId', 'phone', 'email', 'firstName', 'lastName', 'fullName', 'isActive']
    });
  } catch (err) {
    logger.error({ event: 'agent_sync_failed', stage: 'fetch', err }, '[AgentSync] failed before sync loop');
    Sentry.captureMessage('agent_sync_failed', {
      level: 'error',
      tags: { component: 'agent_sync', stage: 'fetch' },
      extra: { error: err?.message, durationMs: Date.now() - startedAt }
    });
    throw err;
  }
  const byLyfeId = new Map(allAgents.filter(a => a.lyfeId).map(a => [a.lyfeId, a]));
  const byPhone = new Map(allAgents.filter(a => a.phone).map(a => [a.phone, a]));
  const byEmail = new Map(allAgents.filter(a => a.email).map(a => [a.email.toLowerCase(), a]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const agent of lyfeAgents) {
    if (!agent.phone && !agent.email) {
      skipped++;
      continue;
    }

    // Try to find existing user by lyfeId, then by phone, then by email (map lookups)
    const normalizedPhone = agent.phone ? String(agent.phone).replace(/\D/g, '') : null;
    let existing = (agent.id ? byLyfeId.get(String(agent.id)) : null)
      || (normalizedPhone ? byPhone.get(normalizedPhone) : null)
      || (agent.email ? byEmail.get(agent.email.toLowerCase()) : null);

    if (existing) {
      // Update with Lyfe data if not already linked
      const updateData = {};
      if (agent.id && !existing.lyfeId) updateData.lyfeId = String(agent.id);
      if (agent.name && !existing.fullName) updateData.fullName = agent.name;
      if (agent.email && (!existing.email || existing.email.endsWith('@placeholder.local'))) {
        updateData.email = agent.email;
      }
      if (agent.phone && !existing.phone) {
        updateData.phone = normalizedPhone;
      }

      if (Object.keys(updateData).length > 0) {
        await existing.update(updateData);
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Create new agent user
      const nameParts = (agent.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || null;
      const lastName = nameParts.slice(1).join(' ') || null;

      await User.create({
        lyfeId: agent.id ? String(agent.id) : null,
        email: agent.email || `lyfe_${agent.id || normalizedPhone}@placeholder.local`,
        firstName,
        lastName,
        fullName: agent.name || null,
        phone: normalizedPhone,
        role: 'agent',
        isActive: true,
        emailVerified: false,
        approvalStatus: 'approved'
      });
      created++;
    }
  }

  // Deactivate local agents that are no longer in Lyfe — bulk update instead of per-agent loop
  const activeLyfeIds = lyfeAgents.map(a => String(a.id)).filter(Boolean);
  let deactivated = 0;

  try {
    if (activeLyfeIds.length > 0) {
      const [deactivatedCount] = await User.update(
        { isActive: false },
        {
          where: {
            role: 'agent',
            isActive: true,
            lyfeId: { [Op.notIn]: activeLyfeIds, [Op.ne]: null }
          }
        }
      );
      deactivated = deactivatedCount;
    }
  } catch (err) {
    logger.error({ event: 'agent_sync_failed', stage: 'deactivate', err }, '[AgentSync] failed during deactivation');
    Sentry.captureMessage('agent_sync_failed', {
      level: 'error',
      tags: { component: 'agent_sync', stage: 'deactivate' },
      extra: { error: err?.message, created, updated, durationMs: Date.now() - startedAt }
    });
    throw err;
  }

  const result = { created, updated, deactivated, skipped, total: lyfeAgents.length };
  const durationMs = Date.now() - startedAt;

  // Successful sync — emit structured log for observability dashboards.
  // Field shape (event + last_sync_at + counts) is the contract relied on by
  // any downstream alert configured to track sync freshness.
  logger.info(
    { event: 'agent_sync_complete', last_sync_at: Date.now(), durationMs, ...result },
    `[AgentSync] complete in ${durationMs}ms: ${created} created, ${updated} updated, ${deactivated} deactivated, ${skipped} skipped`
  );

  // Drift detection (FMEA F12): if a single sync run deactivates a large
  // proportion of agents, something is wrong upstream (mass-wipe, schema
  // change, env-var rotation pointing at wrong project). Warn, don't block.
  const baseline = allAgents.filter(a => a.isActive && a.lyfeId).length;
  if (baseline > 0 && deactivated / baseline > SYNC_DRIFT_DEACTIVATION_RATIO) {
    const ratio = (deactivated / baseline).toFixed(2);
    logger.warn(
      { event: 'agent_sync_drift_warning', deactivated, baseline, ratio },
      `[AgentSync] drift: ${deactivated}/${baseline} (${ratio}) agents deactivated this run`
    );
    Sentry.captureMessage('agent_sync_drift_warning', {
      level: 'warning',
      tags: { component: 'agent_sync' },
      extra: { deactivated, baseline, ratio, ...result }
    });
  }

  return result;
}
