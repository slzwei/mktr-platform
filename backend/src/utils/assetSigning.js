// Placeholder for asset URL signing; no external CDN dependency.
// API: signAssetUrl(url, ttlSeconds) -> { url, expiresAt }

export function signAssetUrl(url, ttlSeconds) {
  const now = Date.now();
  const ttl = Math.max(ttlSeconds || 300, parseInt(process.env.MANIFEST_REFRESH_SECONDS || '300'));
  const expiresAt = new Date(now + ttl * 1000).toISOString();
  // For now, return the same URL; future: append signature query string
  return { url, expiresAt };
}


