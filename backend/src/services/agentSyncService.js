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
  const url = process.env.LYFE_API_URL;
  const key = process.env.LYFE_API_KEY;
  if (!url || !key) {
    throw new Error('LYFE_API_URL and LYFE_API_KEY must be configured');
  }
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Fetch agents from Lyfe API.
 */
export async function fetchAgents(filters = {}) {
  const cacheKey = `agents:${JSON.stringify(filters)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getLyfeConfig();

  const params = new URLSearchParams();
  if (filters.roles) {
    for (const role of filters.roles) {
      params.append('role', role);
    }
  } else {
    params.append('role', 'agent');
    params.append('role', 'pa');
  }

  const response = await fetch(`${url}/agents?${params.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Lyfe API error: ${response.status}`);
  }

  const data = await response.json();
  const agents = data.data || data;
  setCache(cacheKey, agents);
  return agents;
}

/**
 * Fetch agent groups from Lyfe API.
 */
export async function fetchAgentGroups() {
  const cached = getCached('agentGroups');
  if (cached) return cached;

  const { url, key } = getLyfeConfig();

  const response = await fetch(`${url}/agent-groups`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Lyfe API error: ${response.status}`);
  }

  const data = await response.json();
  const groups = data.data || data;
  setCache('agentGroups', groups);
  return groups;
}

/**
 * Fetch a single agent by ID from Lyfe API.
 */
export async function fetchAgentById(id) {
  const cacheKey = `agent:${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { url, key } = getLyfeConfig();

  const response = await fetch(`${url}/agents/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Lyfe API error: ${response.status}`);
  }

  const data = await response.json();
  const agent = data.data || data;
  setCache(cacheKey, agent);
  return agent;
}
