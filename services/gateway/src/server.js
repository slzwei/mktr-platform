import express from 'express';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createRemoteJWKSet, jwtVerify } from 'jose';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:4001/.well-known/jwks.json';
const AUTH_ISSUER = process.env.AUTH_ISSUER || 'http://localhost:4001';
const AUTH_AUDIENCE = process.env.AUTH_AUDIENCE || 'mktr-api';

const MONOLITH_TARGET = process.env.MONOLITH_URL || 'http://localhost:3001';
const AUTH_TARGET = process.env.AUTH_URL || 'http://localhost:4001';
const LEADGEN_TARGET = process.env.LEADGEN_URL || 'http://localhost:4002';

const jwks = createRemoteJWKSet(new URL(AUTH_JWKS_URL));

async function authn(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Missing token' });
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE });
    req.headers['x-user-id'] = payload.sub || '';
    req.headers['x-tenant-id'] = payload.tid || '00000000-0000-0000-0000-000000000000';
    if (Array.isArray(payload.roles)) {
      req.headers['x-roles'] = payload.roles.join(',');
    }
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Public route to auth-service
app.use('/api/auth', createProxyMiddleware({ target: AUTH_TARGET, changeOrigin: true, proxyTimeout: 30000, timeout: 30000 }));

// Protected routes to monolith
const proxyOpts = { changeOrigin: true, proxyTimeout: 30000, timeout: 30000 };
app.use('/api/adtech', authn, createProxyMiddleware({ target: MONOLITH_TARGET, ...proxyOpts }));
app.use('/api/leadgen', authn, createProxyMiddleware({ target: LEADGEN_TARGET, ...proxyOpts }));
app.use('/api/fleet', authn, createProxyMiddleware({ target: MONOLITH_TARGET, ...proxyOpts }));
app.use('/api/admin', authn, createProxyMiddleware({ target: MONOLITH_TARGET, ...proxyOpts }));

app.listen(PORT, () => {
  console.log(`Gateway listening on ${PORT}`);
});


