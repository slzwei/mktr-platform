const createRps = parseInt(process.env.LEADGEN_RPS_CREATE || '5', 10);
const listRps = parseInt(process.env.LEADGEN_RPS_LIST || '10', 10);

const buckets = new Map(); // key -> { ts, count }

function evaluateRequest(key, rps) {
  const now = Date.now();
  const second = Math.floor(now / 1000);
  const b = buckets.get(key) || { ts: second, count: 0 };
  if (b.ts !== second) {
    b.ts = second;
    b.count = 0;
  }
  b.count += 1;
  buckets.set(key, b);
  const allowed = b.count <= rps;
  const remaining = Math.max(0, rps - b.count);
  const reset = 1; // per-second buckets
  return { allowed, remaining, limit: rps, reset };
}

export function limitCreate(req, res, next) {
  const tid = req.tenantId || req.headers['x-tenant-id'] || 'unknown';
  const key = `create:${tid}`;
  const verdict = evaluateRequest(key, createRps);
  res.setHeader('RateLimit-Limit', String(verdict.limit));
  res.setHeader('RateLimit-Remaining', String(verdict.remaining));
  res.setHeader('RateLimit-Reset', String(verdict.reset));
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.reset));
    return res.status(429).json({ code: 429, status: 'error', error: 'rate_limit' });
  }
  return next();
}

export function limitList(req, res, next) {
  const tid = req.tenantId || req.headers['x-tenant-id'] || 'unknown';
  const key = `list:${tid}`;
  const verdict = evaluateRequest(key, listRps);
  res.setHeader('RateLimit-Limit', String(verdict.limit));
  res.setHeader('RateLimit-Remaining', String(verdict.remaining));
  res.setHeader('RateLimit-Reset', String(verdict.reset));
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.reset));
    return res.status(429).json({ code: 429, status: 'error', error: 'rate_limit' });
  }
  return next();
}


