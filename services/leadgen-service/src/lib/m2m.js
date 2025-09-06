export async function getM2MToken() {
  const clientId = process.env.AUTH_M2M_CLIENT_ID;
  const clientSecret = process.env.AUTH_M2M_CLIENT_SECRET;
  const authUrl = (process.env.AUTH_URL || 'http://localhost:4001') + '/v1/auth/m2m/token';
  if (!clientId || !clientSecret) return null;
  try {
    const resp = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.data?.token || null;
  } catch {
    return null;
  }
}


