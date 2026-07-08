/**
 * Normalization for partner matching (docs/redeem-ops/ERD.md §5, brief §34).
 * Display values are stored as entered; these derive the SEPARATE matching keys.
 * Dependency-free on purpose (unit-tested without a DB).
 */

/** Legal suffixes stripped ONLY from the end of a name, longest first. */
const LEGAL_SUFFIXES = [
  'private limited', 'pte ltd', 'pte. ltd.', 'pte. ltd', 'pte ltd.',
  'limited', 'llp', 'llc', 'ltd', 'pl', 'inc',
];

/** Lowercase, strip punctuation, collapse whitespace, cautiously strip a trailing legal suffix. */
export function normalizeBusinessName(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation → space (keeps unicode letters/digits)
    .replace(/\s+/g, ' ')
    .trim();
  for (const suffix of LEGAL_SUFFIXES) {
    const clean = suffix.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (s.endsWith(` ${clean}`)) {
      s = s.slice(0, -clean.length - 1).trim();
      break; // strip at most one suffix — never mid-name tokens
    }
  }
  return s || null;
}

/** Host key for a website: lowercase, strip scheme/www/path/port. */
export function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    let host = new URL(s).hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Social handle key: accepts '@handle', 'handle', or a profile URL
 * ('instagram.com/nailbliss.sg' → 'nailbliss.sg'). Lowercased, no '@'.
 */
export function normalizeHandle(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('/')) {
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
    try {
      const path = new URL(s).pathname.split('/').filter(Boolean);
      s = path[0] === 'p' || path[0] === 'reel' ? '' : (path[0] || '');
    } catch {
      return null;
    }
  }
  s = s.replace(/^@/, '').replace(/[?#].*$/, '').trim();
  return s || null;
}

/** UEN: uppercase, alphanumeric only. */
export function normalizeUen(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || null;
}

/** First two digits of a 6-digit SG postal code (district-ish area key). */
export function postalDistrictOf(postalCode) {
  if (!postalCode) return null;
  const s = String(postalCode).trim();
  return /^\d{6}$/.test(s) ? s.slice(0, 2) : null;
}

/**
 * Derive all matching keys from a partner payload (used on create AND update so
 * keys can never drift from display values).
 */
export function deriveMatchingKeys(body) {
  const displayName = body.tradingName || body.brandName || body.legalName || '';
  return {
    normalizedName: normalizeBusinessName(displayName),
    uen: normalizeUen(body.uen),
    websiteDomain: normalizeDomain(body.website),
    instagramHandle: normalizeHandle(body.instagramHandle),
    tiktokHandle: normalizeHandle(body.tiktokHandle),
    facebookHandle: normalizeHandle(body.facebookUrl || body.facebookHandle),
  };
}
