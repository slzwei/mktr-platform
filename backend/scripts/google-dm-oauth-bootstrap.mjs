#!/usr/bin/env node
/**
 * One-off local OAuth bootstrap for the Data Manager API (never deployed —
 * backend/scripts is .dockerignored out of the image).
 *
 * Prereqs (docs/plans/google-ads-signal-levers.md §2): a Google Cloud project
 * on the mktr.sg Workspace org with the Data Manager API enabled, an INTERNAL
 * OAuth consent screen, and a DESKTOP OAuth client (loopback redirects only
 * work for Desktop clients).
 *
 * Usage:
 *   GOOGLE_DM_OAUTH_CLIENT_ID=... GOOGLE_DM_OAUTH_CLIENT_SECRET=... \
 *     node scripts/google-dm-oauth-bootstrap.mjs
 *
 * Prints the consent URL, waits for the loopback redirect on 127.0.0.1:8765,
 * exchanges the code, and prints the REFRESH TOKEN to copy into Render env
 * (GOOGLE_DM_REFRESH_TOKEN). access_type=offline + prompt=consent force a
 * refresh token even on re-consent.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const CLIENT_ID = process.env.GOOGLE_DM_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET;
const PORT = Number(process.env.GOOGLE_DM_OAUTH_PORT || 8765);
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/datamanager';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_DM_OAUTH_CLIENT_ID and GOOGLE_DM_OAUTH_CLIENT_SECRET first.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();

console.log('\nOpen this URL as admin@mktr.sg and approve:\n');
console.log(authUrl + '\n');

// A denied consent must not leave the script listening forever.
const deadline = setTimeout(() => {
  console.error('Timed out waiting for the OAuth redirect (10 min).');
  process.exit(1);
}, 10 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`OAuth error: ${oauthError}`);
    console.error(`OAuth error from Google: ${oauthError}`);
    process.exit(1);
  }
  const code = url.searchParams.get('code');
  const gotState = url.searchParams.get('state');
  if (!code) {
    res.writeHead(404).end();
    return;
  }
  if (gotState !== state) {
    res.writeHead(400).end('state mismatch');
    console.error('State mismatch — aborting.');
    process.exit(1);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Token minted — you can close this tab.');
  server.close();
  clearTimeout(deadline);

  try {
  const form = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  // The exchange gets its own bound — a stalled token endpoint must not
  // hang the script after the redirect deadline was cleared.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await tokenRes.json();
  if (!tokenRes.ok || !body.refresh_token) {
    console.error('Token exchange failed:', tokenRes.status, body.error_description || body.error);
    process.exit(1);
  }
  console.log('\nGOOGLE_DM_REFRESH_TOKEN (copy into Render env, never commit):\n');
  console.log(body.refresh_token + '\n');
  process.exit(0);
  } catch (err) {
    console.error('Token exchange threw:', err?.message || err);
    process.exit(1);
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Listening on ${REDIRECT_URI} for the OAuth redirect…`);
});
