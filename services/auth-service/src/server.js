import express from 'express';
import cors from 'cors';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;
const ISS = process.env.AUTH_ISSUER || `http://auth:${PORT}`;
const AUD = process.env.AUTH_AUDIENCE || 'mktr-platform';

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
  if (email !== 'admin@example.com' || !['admin','admin123'].includes(password)) {
    return res.status(401).json({ error: 'invalid creds' });
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 15 * 60;
  const claims = { iss: ISS, aud: AUD, sub: 'user-1', tid: '00000000-0000-0000-0000-000000000000', roles: ['ADMIN'], email: 'admin@example.com', exp };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);
  res.json({ token, user: { id: 'user-1', email: 'admin@example.com', roles: ['ADMIN'], tid: claims.tid } });
});

app.listen(PORT, '0.0.0.0', () => console.log(`auth-service on ${PORT}`));


