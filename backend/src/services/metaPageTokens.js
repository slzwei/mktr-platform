import crypto from 'crypto';
import { MetaPage } from '../models/index.js';
import { logger } from '../utils/logger.js';

/**
 * Page-access-token custody for Meta Lead Ads ingestion
 * (docs/plans/meta-lead-ads-native-pipe.md §3.1).
 *
 * Tokens live sealed at rest: AES-256-GCM, envelope
 * `v1:<keyId>:<iv b64>:<ct b64>:<tag b64>`, with the PAGE ID as AAD — an
 * envelope copied onto another page row fails to open. Write-only via the
 * admin API; nothing ever echoes a token back or logs one.
 *
 * Resolution order (allowlist semantics — the env fallback must never bypass
 * an explicit row):
 *   active meta_pages row  → its sealed token
 *   inactive row           → DENY (permanent skip, no fall-through)
 *   no row                 → env META_PAGE_ACCESS_TOKEN, ONLY when
 *                            META_PAGE_ID matches the webhook's page id
 *   otherwise              → unknown page (permanent skip)
 */

const ENVELOPE_VERSION = 'v1';

function activeKeyId() {
  return process.env.META_PAGE_TOKEN_KEY_ID || 'k1';
}

/** 32-byte key from META_PAGE_TOKEN_ENC_KEY — 64-char hex or exactly-32-byte utf8. */
export function loadTokenKey(raw = process.env.META_PAGE_TOKEN_ENC_KEY) {
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'utf8');
  if (buf.length !== 32) {
    throw new Error('META_PAGE_TOKEN_ENC_KEY must be 32 bytes (64-char hex or 32-char string)');
  }
  return buf;
}

export function sealPageToken(token, pageId, key = loadTokenKey()) {
  if (!key) throw new Error('META_PAGE_TOKEN_ENC_KEY is not configured');
  if (!token || !pageId) throw new Error('token and pageId are required');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(pageId), 'utf8'));
  const ct = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, activeKeyId(), iv.toString('base64'), ct.toString('base64'), tag.toString('base64')].join(':');
}

export function openPageToken(envelope, pageId, key = loadTokenKey()) {
  if (!key) throw new Error('META_PAGE_TOKEN_ENC_KEY is not configured');
  const parts = String(envelope || '').split(':');
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Unrecognized token envelope');
  }
  const [, keyId, ivB64, ctB64, tagB64] = parts;
  if (keyId !== activeKeyId()) {
    // Single active key by design: after a rotation, stored tokens must be
    // re-saved through the admin API (the old key is gone on purpose).
    throw new Error(`Token sealed with key '${keyId}' but active key is '${activeKeyId()}' — re-save the page token`);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(String(pageId), 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * @returns {{ token: string|null, reason?: string, retryable?: boolean }}
 * Non-null token ⇒ proceed. Null token: `retryable:true` keeps the inbox row
 * alive (config being fixed), `retryable:false` is a permanent skip.
 */
export function makeMetaPageTokens(overrides = {}) {
  const d = { MetaPage, logger, ...overrides };

  async function resolvePageAccessToken(pageId) {
    const row = await d.MetaPage.findOne({ where: { pageId: String(pageId) } });
    if (row) {
      if (!row.isActive) return { token: null, reason: 'inactive_page', retryable: false };
      try {
        return { token: openPageToken(row.accessTokenEnc, row.pageId) };
      } catch (err) {
        d.logger.error('[Meta] page token unreadable — re-save it via the admin API', {
          pageId: row.pageId, error: err.message,
        });
        return { token: null, reason: 'token_unreadable', retryable: true };
      }
    }
    if (process.env.META_PAGE_ID && process.env.META_PAGE_ID === String(pageId) && process.env.META_PAGE_ACCESS_TOKEN) {
      return { token: process.env.META_PAGE_ACCESS_TOKEN };
    }
    return { token: null, reason: 'unknown_page', retryable: false };
  }

  return { resolvePageAccessToken };
}

const _default = makeMetaPageTokens();
export const resolvePageAccessToken = _default.resolvePageAccessToken;
