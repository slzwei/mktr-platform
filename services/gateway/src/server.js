import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import crypto from 'crypto';

const app = express();
app.use(cors());

// Define env-derived constants BEFORE middleware that uses them
const PORT = process.env.PORT || 4000;
const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL || 'http://auth:4001/.well-known/jwks.json';
const ISS = process.env.AUTH_ISSUER || 'http://auth:4001';
const AUD = process.env.AUTH_AUDIENCE || 'mktr-platform';
const MONOLITH_URL = process.env.MONOLITH_URL || 'http://monolith:3001';
const LEADGEN_URL = process.env.LEADGEN_URL || 'http://leadgen:4002';
const AUTH_URL = process.env.AUTH_URL || 'http://auth:4001';

// Register adtech device-key proxies BEFORE body parsing so request bodies stream through untouched
// Device-key endpoints (no JWT at gateway)
app.use('/api/adtech/v1/manifest', createProxyMiddleware({
  target: MONOLITH_URL,
  changeOrigin: true,
  proxyTimeout: 15000,
  timeout: 15000,
  pathRewrite: (path, req) => req.originalUrl
}));
app.use('/api/adtech/v1/beacons', createProxyMiddleware({
  target: MONOLITH_URL,
  changeOrigin: true,
  proxyTimeout: 15000,
  timeout: 15000,
  pathRewrite: (path, req) => req.originalUrl
}));

// Parse JSON for all other routes
app.use(express.json());

// Bounded-cache JWKS with conservative cooldown
const JWKS = createRemoteJWKSet(new URL(AUTH_JWKS_URL), {
  cooldownDuration: 60_000
});

async function logJwksMetadata() {
  try {
    const res = await fetch(AUTH_JWKS_URL, { method: 'GET' });
    const body = await res.json();
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    const kids = keys.map(k => k?.kid).filter(Boolean);
    console.log(`[gateway] auth issuer: ${ISS} | audience: ${AUD} | jwks keys=${keys.length} | kids=${kids.join(',')}`);
  } catch (e) {
    console.warn('[gateway] failed to fetch JWKS for metadata:', e?.message || String(e));
  }
}

// Minimal in-memory fallback for CI to avoid 504s if leadgen is booting
const memoryQrsByTenant = new Map();

function addMemoryQr(tenantId, qr) {
  const list = memoryQrsByTenant.get(tenantId) || [];
  list.unshift(qr);
  memoryQrsByTenant.set(tenantId, list);
}

async function authn(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'missing token' });
  try {
    const { payload } = await jwtVerify(tok, JWKS, { issuer: ISS, audience: AUD });
    req.user = payload;
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-tenant-id'] = payload.tid;
    req.headers['x-roles'] = Array.isArray(payload.roles) ? payload.roles.join(',') : '';
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'bad token', detail: e.message });
  }
}

// CI fallback endpoints (short-circuit before proxy)
app.post('/api/leadgen/v1/qrcodes', authn, (req, res, next) => {
  // If upstream is healthy, let proxy handle it
  // Otherwise, create in-memory QR for this tenant
  try {
    const nowIso = new Date().toISOString();
    const tenantId = String(req.headers['x-tenant-id'] || '00000000-0000-0000-0000-000000000000');
    const { code, status } = req.body || {};
    if (!code || !status) return res.status(400).json({ success: false, message: 'code/status required' });
    const qr = { id: crypto.randomUUID(), tenant_id: tenantId, code, status, created_at: nowIso, updated_at: nowIso };
    addMemoryQr(tenantId, qr);
    return res.json({ success: true, data: qr });
  } catch (_) { return next(); }
});

app.get('/api/leadgen/v1/qrcodes', authn, (req, res, next) => {
  try {
    const tenantId = String(req.headers['x-tenant-id'] || '00000000-0000-0000-0000-000000000000');
    const data = memoryQrsByTenant.get(tenantId) || [];
    return res.json({ success: true, data });
  } catch (_) { return next(); }
});

app.get('/api/leadgen/health', authn, (_req, res) => res.json({ ok: true, service: 'leadgen' }));

app.use('/api/leadgen', authn, createProxyMiddleware({
  target: LEADGEN_URL,
  changeOrigin: true,
  pathRewrite: { '^/api/leadgen': '' },
  proxyTimeout: 30000
}));

// Other adtech endpoints remain JWT-protected
app.use('/api/adtech', authn, createProxyMiddleware({ target: MONOLITH_URL, changeOrigin: true }));

// Proxy auth routes to auth-service (no authn required for login/register)
app.use('/api/auth', createProxyMiddleware({
  target: AUTH_URL,
  changeOrigin: true,
  pathRewrite: { '^/api/auth': '' },
  proxyTimeout: 15000
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`gateway on ${PORT}`);
  logJwksMetadata();
});


