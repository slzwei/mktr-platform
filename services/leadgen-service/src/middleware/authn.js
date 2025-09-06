import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:4001/.well-known/jwks.json';
const AUTH_ISSUER = process.env.AUTH_ISSUER || 'http://localhost:4001';
const AUTH_AUDIENCE = process.env.AUTH_AUDIENCE || 'mktr-api';

const jwks = createRemoteJWKSet(new URL(AUTH_JWKS_URL));

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE });
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

export function requireTenant(req, res, next) {
  const tenantId = (req.user && req.user.tid) || req.headers['x-tenant-id'];
  if (!tenantId) return res.status(403).json({ success: false, message: 'Unauthorized' });
  req.tenantId = tenantId;
  next();
}


