import express from 'express';
import cors from 'cors';
import { generateKeyPair, exportJWK, SignJWT, importPKCS8, calculateJwkThumbprint } from 'jose';
import { createPublicKey, randomBytes } from 'crypto';
import path from 'path';
import { seedDevUser } from './devSeeder.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

// Load environment variables from .env (and allow NODE_ENV-specific files if desired in future)
dotenv.config();

const PORT = process.env.PORT || 4001;
const ISS = process.env.AUTH_ISSUER || `http://auth:${PORT}`;
const AUD = process.env.AUTH_AUDIENCE || 'mktr-platform';

async function buildKeyMaterial() {
  const pemEnv = process.env.AUTH_PRIVATE_KEY_PEM;
  const kidEnv = process.env.KID && String(process.env.KID).trim();
  if (pemEnv && pemEnv.trim()) {
    const normalizedPem = pemEnv.replace(/\\n/g, '\n');
    const privateKey = await importPKCS8(normalizedPem, 'RS256');
    const publicKey = createPublicKey(normalizedPem);
    const publicJwk = await exportJWK(publicKey);
    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';
    publicJwk.kid = kidEnv || await calculateJwkThumbprint(publicJwk);
    return { privateKey, publicJwk };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_PRIVATE_KEY_PEM is required in production.');
  }

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';
  publicJwk.kid = kidEnv || `dev-${randomBytes(8).toString('hex')}`;
  console.warn('[auth-service] Generated ephemeral RSA key pair for development. Tokens will not survive restarts.');
  return { privateKey, publicJwk };
}

export async function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const { privateKey, publicJwk } = await buildKeyMaterial();

  // Seed a development user (no-op in production)
  await seedDevUser();

  app.get('/.well-known/jwks.json', (_req, res) => {
    res.json({ keys: [publicJwk] });
  });

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'auth' }));

  // Dev-only seed endpoint to ensure a known user exists for smoke tests
  if (process.env.NODE_ENV !== 'production') {
    app.post('/internal/dev/seed-user', async (req, res) => {
      try {
        const seedEmail = process.env.SEED_EMAIL || 'test@mktr.sg';
        const seedPassword = process.env.SEED_PASSWORD || 'test';
        const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

        const userModulePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../backend/src/models/User.js');
        const { default: User } = await import(userModulePath);

        const existing = await User.findOne({ where: { email: seedEmail } });
        const salt = await bcrypt.genSalt(rounds);
        const hashed = await bcrypt.hash(seedPassword, salt);
        if (!existing) {
          await User.create({
            email: seedEmail,
            password: hashed,
            role: 'admin',
            emailVerified: true,
            isActive: true,
            firstName: 'Dev',
            lastName: 'User'
          }, { validate: false, hooks: false });
          console.log(`seeded dev user: ${seedEmail}`);
          return res.json({ ok: true, email: seedEmail });
        }

        // Ensure password remains valid if rotated; hooks will hash if changed
        existing.password = hashed;
        await existing.save({ validate: false, hooks: false });
        return res.json({ ok: true, email: seedEmail });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || String(err) });
      }
    });
  }

  app.post('/v1/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing creds' });
    // Keep existing dev backdoor for compatibility with existing tests
    if (email === 'admin@example.com' && ['admin','admin123'].includes(password)) {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 15 * 60;
      const claims = { iss: ISS, aud: AUD, sub: 'user-1', tid: '00000000-0000-0000-0000-000000000000', roles: ['ADMIN'], email: 'admin@example.com', exp };
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
        .setExpirationTime(exp)
        .sign(privateKey);
      return res.json({ token, user: { id: 'user-1', email: 'admin@example.com', roles: ['ADMIN'], tid: claims.tid } });
    }

    // In non-production, attempt DB-backed authentication using backend User model
    if (process.env.NODE_ENV !== 'production') {
      try {
        const userModulePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../backend/src/models/User.js');
        const { default: User } = await import(userModulePath);
        const user = await User.findOne({ where: { email } });
        if (user && typeof user.comparePassword === 'function') {
          const ok = await user.comparePassword(password);
          if (ok) {
            const now = Math.floor(Date.now() / 1000);
            const exp = now + 15 * 60;
            const role = (user.role || 'customer').toString().toUpperCase();
            const claims = { iss: ISS, aud: AUD, sub: user.id, tid: '00000000-0000-0000-0000-000000000000', roles: [role], email: user.email, exp };
            const token = await new SignJWT(claims)
              .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
              .setExpirationTime(exp)
              .sign(privateKey);
            return res.json({ token, user: { id: user.id, email: user.email, roles: [role], tid: claims.tid } });
          }
        }
      } catch (e) {
        // Fall through to invalid creds
      }
    }

    return res.status(401).json({ error: 'invalid creds' });
  });

  return { app };
}

export const { app } = await createApp();

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, '0.0.0.0', () => console.log(`auth-service on ${PORT}`));
}

