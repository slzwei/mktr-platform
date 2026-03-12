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
  const key = process.env.LYFE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('LYFE_SUPABASE_URL and LYFE_SUPABASE_ANON_KEY must be configured');
  }
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Fetch agents from Lyfe Supabase (users table with role in agent, pa).
 */
export async function fetchAgents(filters = {}) {
  const cacheKey = `agents:${JSON.stringify(filters)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getLyfeConfig();

  const roles = filters.roles || ['agent', 'pa'];
  const roleFilter = `role=in.(${roles.join(',')})`;

  const response = await fetch(
    `${url}/rest/v1/users?${roleFilter}&is_active=eq.true&select=id,full_name,email,phone,role,avatar_url,date_of_birth,created_at`,
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
