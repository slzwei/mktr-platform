import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import bcrypt from 'bcryptjs';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4001;
const ISSUER = process.env.AUTH_ISSUER || 'http://localhost:4001';
const AUDIENCE = process.env.AUTH_AUDIENCE || 'mktr-api';
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';

let currentPrivateKey;
let currentKid;
let publicJwks;

async function initKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  currentPrivateKey = privateKey;
  currentKid = randomUUID();
  const jwk = await exportJWK(publicKey);
  jwk.kid = currentKid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  publicJwks = { keys: [jwk] };
}

// in-memory user store for dev; replace with auth schema later
const users = new Map();

function seedAdmin() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  users.set(adminEmail, {
    id,
    email: adminEmail,
    passwordHash: hash,
    roleKeys: ['admin'],
    tenantId: DEFAULT_TENANT_ID
  });
}

function signJwt({ sub, tid, roles = [], email }) {
  return new SignJWT({ tid, roles, email })
    .setProtectedHeader({ alg: 'RS256', kid: currentKid })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(currentPrivateKey);
}

app.get('/.well-known/jwks.json', (req, res) => {
  res.json(publicJwks);
});

app.post('/v1/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }
  if (users.has(email)) {
    return res.status(409).json({ success: false, message: 'User exists' });
  }
  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  users.set(email, { id, email, passwordHash: hash, roleKeys: ['customer'], tenantId: DEFAULT_TENANT_ID });
  return res.status(201).json({ success: true });
});

app.post('/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);
  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  const token = await signJwt({ sub: user.id, tid: user.tenantId, roles: user.roleKeys, email: user.email });
  res.json({ success: true, data: { token } });
});

app.post('/v1/auth/google', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented' });
});

app.post('/v1/auth/refresh', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented' });
});

app.post('/v1/auth/logout', (req, res) => {
  res.json({ success: true });
});

async function start() {
  await initKeys();
  seedAdmin();
  app.listen(PORT, () => {
    console.log(`Auth service listening on ${PORT}`);
    console.log(`JWKS: http://localhost:${PORT}/.well-known/jwks.json`);
  });
}

start();


