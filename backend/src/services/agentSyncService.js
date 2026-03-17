import { Op } from 'sequelize';
import User from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';

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

  const response = await fetch(
    `${url}/rest/v1/users?${roleFilter}&is_active=eq.true&select=id,full_name,email,phone,role,avatar_url,date_of_birth,created_at&order=full_name`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Lyfe Supabase error: ${response.status} ${body}`);
  }

  const agents = await response.json();

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

  const response = await fetch(
    `${url}/rest/v1/users?id=eq.${id}&select=id,full_name,email,phone,role,avatar_url,date_of_birth,created_at`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(`Lyfe Supabase error: ${response.status}`);
  }

  const rows = await response.json();
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
  invalidateCache();
  const lyfeAgents = await fetchAgents();

  // Pre-fetch all local agents into maps for O(1) lookups instead of per-agent findOne queries
  const allAgents = await User.findAll({
    where: { role: 'agent' },
    attributes: ['id', 'lyfeId', 'phone', 'email', 'firstName', 'lastName', 'fullName', 'isActive']
  });
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

  return { created, updated, deactivated, skipped, total: lyfeAgents.length };
}
