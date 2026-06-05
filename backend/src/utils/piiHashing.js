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
