import express from 'express';
import cors from 'cors';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;
const ISS = process.env.AUTH_ISSUER || `http://auth:${PORT}`;
const AUD = process.env.AUTH_AUDIENCE || 'mktr-platform';

// Generate an RSA keypair on boot (fine for CI/dev)
const { publicKey, privateKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
publicJwk.use = 'sig';
publicJwk.alg = 'RS256';
publicJwk.kid = 'ci-dev-kid-1';

app.get('/.well-known/jwks.json', (req, res) => {
  res.json({ keys: [publicJwk] });
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'auth' }));

app.post('/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing creds' });

  // accept admin/admin or admin/admin123 for CI convenience
  if (email !== 'admin@example.com' || !['admin','admin123'].includes(password)) {
    return res.status(401).json({ error: 'invalid creds' });
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 15 * 60;
  const claims = {
    iss: ISS,
    aud: AUD,
    sub: 'user-1',
    tid: '00000000-0000-0000-0000-000000000000',
    roles: ['ADMIN'],
    email: 'admin@example.com',
    exp
  };

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);

  res.json({ token, user: { id: 'user-1', email: 'admin@example.com', roles: ['ADMIN'], tid: claims.tid } });
});

app.listen(PORT, '0.0.0.0', () => console.log(`auth-service on ${PORT}`));

import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4001;
const ISSUER = process.env.AUTH_ISSUER || 'http://localhost:4001';
const AUDIENCE = process.env.AUTH_AUDIENCE || 'mktr-api';
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const AUTH_M2M_CLIENT_ID = process.env.AUTH_M2M_CLIENT_ID || '';
const AUTH_M2M_CLIENT_SECRET = process.env.AUTH_M2M_CLIENT_SECRET || '';

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
const googleIdentities = new Map(); // provider_subject -> userId
const oauthStates = new Map(); // state -> { codeVerifier, createdAt }

function base64url(input) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generatePkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(64));
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64url(hash);
  return { codeVerifier, codeChallenge };
}

setInterval(() => {
  const now = Date.now();
  for (const [state, meta] of oauthStates.entries()) {
    if (now - meta.createdAt > 10 * 60 * 1000) oauthStates.delete(state);
  }
}, 60 * 1000).unref();

function seedAdmin() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin';
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
  // Return token at top-level for simpler clients, while keeping data.token for backward compatibility
  res.json({ success: true, token, data: { token } });
});

app.post('/v1/auth/google', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented' });
});

// Google OAuth start (web)
app.get('/v1/auth/google/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return res.status(500).json({ success: false, message: 'Google OAuth not configured' });
  }
  const state = base64url(crypto.randomBytes(16));
  const { codeVerifier, codeChallenge } = generatePkcePair();
  oauthStates.set(state, { codeVerifier, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true'
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return res.redirect(302, url);
});

// Google OAuth callback
app.get('/v1/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query || {};
    if (!code || !state) return res.status(400).json({ success: false, message: 'Missing code/state' });
    const record = oauthStates.get(state);
    oauthStates.delete(state);
    if (!record) return res.status(400).json({ success: false, message: 'Invalid state' });
    const params = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: record.codeVerifier
    });
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      return res.status(401).json({ success: false, message: 'Token exchange failed', detail: text });
    }
    const tokenJson = await tokenResp.json();
    const { id_token: idToken, access_token: accessToken } = tokenJson;
    if (!idToken) return res.status(401).json({ success: false, message: 'Missing id_token' });

    // Verify Google ID token
    const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: GOOGLE_CLIENT_ID
    });
    if (payload.azp && payload.azp !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ success: false, message: 'Invalid azp' });
    }
    if (payload.email_verified === false) {
      return res.status(401).json({ success: false, message: 'Email not verified' });
    }

    // Fetch userinfo (optional, enrich)
    let userinfo = {};
    if (accessToken) {
      try {
        const uiResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (uiResp.ok) userinfo = await uiResp.json();
      } catch {}
    }

    // Identity linking / user upsert (in-memory for dev)
    const providerSubject = String(payload.sub);
    let userId = googleIdentities.get(providerSubject);
    const email = String(payload.email || userinfo.email || '');
    if (!userId) {
      // try existing by email
      const existing = Array.from(users.values()).find(u => u.email === email);
      if (existing) {
        userId = existing.id;
      } else {
        // create
        userId = randomUUID();
        users.set(email || providerSubject, {
          id: userId,
          email: email || `${providerSubject}@google.local`,
          passwordHash: '',
          roleKeys: ['customer'],
          tenantId: DEFAULT_TENANT_ID
        });
      }
      googleIdentities.set(providerSubject, userId);
    }

    const user = Array.from(users.values()).find(u => u.id === userId);
    const token = await signJwt({ sub: user.id, tid: user.tenantId, roles: user.roleKeys, email: user.email });
    return res.status(200).json({
      success: true,
      token,
      user: { id: user.id, email: user.email, roles: user.roleKeys, tid: user.tenantId }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'OAuth failed' });
  }
});

// M2M token issuance
app.post('/v1/auth/m2m/token', async (req, res) => {
  try {
    const { client_id, client_secret } = req.body || {};
    if (!client_id || !client_secret) return res.status(400).json({ success: false, message: 'Invalid payload' });
    if (client_id !== AUTH_M2M_CLIENT_ID || client_secret !== AUTH_M2M_CLIENT_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const token = await new SignJWT({ tid: DEFAULT_TENANT_ID, roles: ['service'] })
      .setProtectedHeader({ alg: 'RS256', kid: currentKid })
      .setIssuer(ISSUER)
      .setAudience('services')
      .setSubject(client_id)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(currentPrivateKey);
    return res.json({ token, expires_in: 300 });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
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

export { app };

if (process.env.JEST_WORKER_ID === undefined) {
  start();
}


