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

export function hashExternalId(id) {
  if (id === null || id === undefined || id === '') return undefined;
  return sha256Hex(String(id));
}
