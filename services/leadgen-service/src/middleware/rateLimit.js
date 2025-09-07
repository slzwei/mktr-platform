const createRps = parseInt(process.env.LEADGEN_RPS_CREATE || '5', 10);
const listRps = parseInt(process.env.LEADGEN_RPS_LIST || '10', 10);

const buckets = new Map(); // key -> { ts, count }

function shouldAllow(key, rps) {
  const now = Date.now();
  const second = Math.floor(now / 1000);
  const b = buckets.get(key) || { ts: second, count: 0 };
  if (b.ts !== second) {
    b.ts = second;
    b.count = 0;
  }
  b.count += 1;
  buckets.set(key, b);
  return b.count <= rps;
}

export function limitCreate(req, res, next) {
  const tid = req.tenantId || req.headers['x-tenant-id'] || 'unknown';
  const key = `create:${tid}`;
  if (!shouldAllow(key, createRps)) {
    res.setHeader('Retry-After', '1');
    return res.status(429).json({ code: 429, status: 'error', error: 'rate_limit' });
  }
  return next();
}

export function limitList(req, res, next) {
  const tid = req.tenantId || req.headers['x-tenant-id'] || 'unknown';
  const key = `list:${tid}`;
  if (!shouldAllow(key, listRps)) {
    res.setHeader('Retry-After', '1');
    return res.status(429).json({ code: 429, status: 'error', error: 'rate_limit' });
  }
  return next();
}


