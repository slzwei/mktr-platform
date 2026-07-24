import crypto from 'crypto';

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function hashEmail(email) {
  if (!email || typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return sha256Hex(normalized);
}

export function hashPhone(phone) {
  if (!phone || typeof phone !== 'string') return undefined;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;
  return sha256Hex(digits);
}

/**
 * Hash a phone number in E.164 form, keeping the leading `+` (e.g.
 * SHA256('+6591234567')). TikTok's Events API expects E.164 with the `+`,
 * unlike Meta CAPI which wants digits-only (`hashPhone`). Input is assumed
 * already normalized to E.164 with a country code (prospects store `+65…`).
 */
export function hashPhoneE164(phone) {
  if (!phone || typeof phone !== 'string') return undefined;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;
  return sha256Hex(`+${digits}`);
}

export function hashExternalId(id) {
  if (id === null || id === undefined || id === '') return undefined;
  return sha256Hex(String(id));
}

/**
 * Hash a person name for Meta CAPI `fn`/`ln`. Mirrors Meta's capi-param-builder
 * `getNormalizedName`: trim → lowercase → strip whitespace, punctuation and
 * symbols. Digits and non-Latin letters are KEPT (Meta does not strip them,
 * and stripping would change the hash input away from what Meta's own
 * builder produces for the same name).
 */
export function hashName(name) {
  if (!name || typeof name !== 'string') return undefined;
  const normalized = name.trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  if (!normalized) return undefined;
  return sha256Hex(normalized);
}

/**
 * Hash a 2-letter ISO country code for Meta CAPI `country` (lowercased).
 * MKTR's funnel is Singapore-only, so callers pass the constant 'sg'.
 */
export function hashCountry(code) {
  if (!code || typeof code !== 'string') return undefined;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return undefined;
  return sha256Hex(normalized);
}
