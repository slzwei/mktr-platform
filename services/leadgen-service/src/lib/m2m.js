let cachedToken = null;
let tokenExpiresAtMs = 0;

export async function getM2MToken() {
  const clientId = process.env.AUTH_M2M_CLIENT_ID;
  const clientSecret = process.env.AUTH_M2M_CLIENT_SECRET;
  const authUrl = (process.env.AUTH_URL || 'http://localhost:4001') + '/v1/auth/m2m/token';
  if (!clientId || !clientSecret) return null;
  const now = Date.now();
  if (cachedToken && tokenExpiresAtMs - now > 30_000) {
    return cachedToken;
  }
  try {
    const resp = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const token = json?.token || json?.data?.token || null;
    const expiresIn = Number(json?.expires_in || 300);
    if (!token) return null;
    cachedToken = token;
    tokenExpiresAtMs = Date.now() + (expiresIn * 1000);
    return cachedToken;
  } catch {
    return null;
  }
}


