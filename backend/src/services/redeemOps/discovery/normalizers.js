import { normalizeDomain, normalizeHandle } from '../normalizers.js';
import { normalizePhone } from '../../prospectHelpers.js';

/**
 * Map raw Apify actor items → our candidate/enrichment shapes. Kept dependency-light
 * and pure so tests can feed fixture items without any network. Column-length-safe
 * (truncates to the discovery_candidates limits).
 */
const trunc = (v, n) => (v == null ? null : String(v).slice(0, n));

/** First Instagram URL/handle out of the actor's various social shapes → handle. */
function extractInstagram(raw) {
  const candidates = [];
  if (Array.isArray(raw.instagrams)) candidates.push(...raw.instagrams);
  if (raw.socialMedia?.instagram) candidates.push(raw.socialMedia.instagram);
  if (raw.instagram) candidates.push(raw.instagram);
  for (const c of candidates) {
    const handle = normalizeHandle(c);
    if (handle) return handle;
  }
  return null;
}

/**
 * Belt-and-braces geo guard: locationQuery anchors the crawl, but Maps can still
 * surface stray global brand matches (live: Sephora New York/Oshawa/Edmonton,
 * 2026-07-12). Drop anything the actor labels as another country; an item with
 * NO countryCode is kept — absence ≠ foreign, and false negatives cost paid rows.
 */
export function isSingaporeMapsItem(raw) {
  const cc = raw?.countryCode;
  return !cc || String(cc).toUpperCase() === 'SG';
}

/** Apify Google Maps place → discovery_candidates fields. */
export function normalizeMapsItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const website = raw.website || null;
  return {
    externalPlaceId: trunc(raw.placeId || raw.fid || null, 128),
    name: trunc(raw.title || raw.name || null, 200),
    primaryPhone: trunc(normalizePhone(raw.phoneUnformatted || raw.phone || null) || null, 32),
    website: trunc(website, 255),
    websiteDomain: trunc(normalizeDomain(website), 160),
    instagramHandle: trunc(extractInstagram(raw), 64),
    address: trunc(raw.address || raw.street || null, 255),
    area: trunc(raw.city || raw.neighborhood || raw.state || null, 64),
    rating: typeof raw.totalScore === 'number' ? raw.totalScore : null,
    reviewsCount: Number.isInteger(raw.reviewsCount) ? raw.reviewsCount : null,
    sourceUrl: trunc(raw.url || raw.searchPageUrl || null, 500),
    // Trim heavy arrays (reviews/images) out of the stored payload — keep it light.
    rawPayload: pruneMapsRaw(raw),
  };
}

function pruneMapsRaw(raw) {
  const rest = { ...(raw || {}) };
  // Drop the heavy arrays — keep the stored payload light.
  for (const k of ['reviews', 'images', 'imageUrls', 'reviewsDistribution', 'popularTimesHistogram']) {
    delete rest[k];
  }
  return rest;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Pull an email out of an IG bio (best-effort, low confidence — not a structured field). */
export function parseEmailFromBio(bio) {
  if (!bio || typeof bio !== 'string') return null;
  const m = bio.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

/** Apify Instagram profile → enrichment fields (fill-blanks/upgrade only, never blind overwrite). */
export function normalizeInstagramItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const handle = normalizeHandle(raw.username || raw.url || null);
  const bio = raw.biography || raw.bio || null;
  return {
    instagramHandle: trunc(handle, 64),
    followersCount: Number.isInteger(raw.followersCount) ? raw.followersCount
      : (Number.isInteger(raw.followers) ? raw.followers : null),
    bio: bio || null,
    email: trunc(raw.publicEmail || parseEmailFromBio(bio), 160),
    isVerified: !!raw.verified,
  };
}
