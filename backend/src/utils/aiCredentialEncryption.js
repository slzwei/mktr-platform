import crypto from 'crypto';
import { AppError } from '../middleware/errorHandler.js';

function encryptionKey() {
  const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY || '';
  if (secret.length < 32) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function isAiCredentialEncryptionReady() {
  return Boolean(encryptionKey());
}

export function encryptApiKey(value) {
  const key = encryptionKey();
  if (!key) throw new AppError('AI credential encryption is not configured on the server.', 503);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptApiKey(payload) {
  if (!payload) return null;
  const key = encryptionKey();
  if (!key) throw new AppError('AI credential encryption is not configured on the server.', 503);
  const [version, iv, tag, ciphertext] = String(payload).split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new AppError('Stored AI credential cannot be read.', 500);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError('Stored AI credential cannot be decrypted. Check the server encryption key.', 503);
  }
}
