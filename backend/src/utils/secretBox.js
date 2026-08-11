import crypto from 'crypto';
import { AppError } from '../middleware/appError.js';

/**
 * Parameterized twin of aiCredentialEncryption.js (which hardwires its env
 * var — plan m8): AES-256-GCM `v1:iv:tag:ct` with a sha256-derived key from a
 * named env secret. Each credential family gets its OWN env key so rotating
 * one can never brick another.
 */
export function makeSecretBox(envVar, label) {
  const key = () => {
    const secret = process.env[envVar] || '';
    if (secret.length < 32) return null;
    return crypto.createHash('sha256').update(secret, 'utf8').digest();
  };

  return {
    isReady: () => Boolean(key()),
    encrypt(value) {
      const k = key();
      if (!k) throw new AppError(`${label} encryption is not configured on the server (${envVar}).`, 503);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
    },
    decrypt(payload) {
      if (!payload) return null;
      const k = key();
      if (!k) throw new AppError(`${label} encryption is not configured on the server (${envVar}).`, 503);
      const [version, iv, tag, ciphertext] = String(payload).split(':');
      if (version !== 'v1' || !iv || !tag || !ciphertext) throw new AppError(`Stored ${label} credential cannot be read.`, 500);
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        throw new AppError(`Stored ${label} credential cannot be decrypted. Check the server encryption key.`, 503);
      }
    },
  };
}
