import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL || 'http://auth:4001/.well-known/jwks.json';
const ISS = process.env.AUTH_ISSUER || 'http://auth:4001';
const AUD = process.env.AUTH_AUDIENCE || 'mktr-platform';
const MONOLITH_URL = process.env.MONOLITH_URL || 'http://monolith:3001';
const LEADGEN_URL = process.env.LEADGEN_URL || 'http://leadgen:4002';

const JWKS = createRemoteJWKSet(new URL(AUTH_JWKS_URL));

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

app.get('/api/leadgen/health', authn, (_req, res) => res.json({ ok: true, service: 'leadgen' }));

app.use('/api/leadgen', authn, createProxyMiddleware({
  target: LEADGEN_URL,
  changeOrigin: true,
  pathRewrite: { '^/api/leadgen': '' },
  proxyTimeout: 30000
}));

app.use('/api/adtech', authn, createProxyMiddleware({ target: MONOLITH_URL, changeOrigin: true }));

app.listen(PORT, '0.0.0.0', () => console.log(`gateway on ${PORT}`));


