import { jest } from '@jest/globals';
import '../setup.js';
import {
  loadTokenKey, sealPageToken, openPageToken, makeMetaPageTokens,
} from '../../src/services/metaPageTokens.js';

const HEX_KEY = 'a'.repeat(64);
const PAGE = '123456789012345';

describe('metaPageTokens (unit)', () => {
  const envBackup = {};
  beforeEach(() => {
    for (const k of ['META_PAGE_TOKEN_ENC_KEY', 'META_PAGE_TOKEN_KEY_ID', 'META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN']) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
    process.env.META_PAGE_TOKEN_ENC_KEY = HEX_KEY;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('loadTokenKey accepts 64-hex and exact-32-byte strings, rejects others', () => {
    expect(loadTokenKey(HEX_KEY)).toHaveLength(32);
    expect(loadTokenKey('x'.repeat(32))).toHaveLength(32);
    expect(loadTokenKey('')).toBeNull();
    expect(() => loadTokenKey('short')).toThrow(/32 bytes/);
  });

  it('seal → open roundtrips; envelope carries version and key id', () => {
    const envelope = sealPageToken('EAAB-token-value', PAGE);
    expect(envelope.startsWith('v1:k1:')).toBe(true);
    expect(envelope).not.toContain('EAAB');
    expect(openPageToken(envelope, PAGE)).toBe('EAAB-token-value');
  });

  it('open with a different pageId (AAD mismatch) throws', () => {
    const envelope = sealPageToken('tok', PAGE);
    expect(() => openPageToken(envelope, '999')).toThrow();
  });

  it('open after a key rotation demands a re-save, not silent garbage', () => {
    const envelope = sealPageToken('tok', PAGE);
    process.env.META_PAGE_TOKEN_KEY_ID = 'k2';
    expect(() => openPageToken(envelope, PAGE)).toThrow(/re-save/);
  });

  describe('resolvePageAccessToken', () => {
    it('active row wins and opens its sealed token', async () => {
      const envelope = sealPageToken('row-token', PAGE);
      const MetaPage = { findOne: jest.fn().mockResolvedValue({ pageId: PAGE, isActive: true, accessTokenEnc: envelope }) };
      const { resolvePageAccessToken } = makeMetaPageTokens({ MetaPage });
      await expect(resolvePageAccessToken(PAGE)).resolves.toEqual({ token: 'row-token' });
    });

    it('INACTIVE row denies permanently — never falls through to the env token', async () => {
      process.env.META_PAGE_ID = PAGE;
      process.env.META_PAGE_ACCESS_TOKEN = 'env-token';
      const MetaPage = { findOne: jest.fn().mockResolvedValue({ pageId: PAGE, isActive: false, accessTokenEnc: 'x' }) };
      const { resolvePageAccessToken } = makeMetaPageTokens({ MetaPage });
      await expect(resolvePageAccessToken(PAGE)).resolves.toEqual({ token: null, reason: 'inactive_page', retryable: false });
    });

    it('unreadable sealed token is RETRYABLE (operator re-saves it)', async () => {
      const MetaPage = { findOne: jest.fn().mockResolvedValue({ pageId: PAGE, isActive: true, accessTokenEnc: 'v1:k1:AAAA:BBBB:CCCC' }) };
      const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
      const { resolvePageAccessToken } = makeMetaPageTokens({ MetaPage, logger });
      await expect(resolvePageAccessToken(PAGE)).resolves.toEqual({ token: null, reason: 'token_unreadable', retryable: true });
    });

    it('no row: env fallback ONLY when META_PAGE_ID matches the webhook page', async () => {
      process.env.META_PAGE_ID = PAGE;
      process.env.META_PAGE_ACCESS_TOKEN = 'env-token';
      const MetaPage = { findOne: jest.fn().mockResolvedValue(null) };
      const { resolvePageAccessToken } = makeMetaPageTokens({ MetaPage });
      await expect(resolvePageAccessToken(PAGE)).resolves.toEqual({ token: 'env-token' });
      await expect(resolvePageAccessToken('42')).resolves.toEqual({ token: null, reason: 'unknown_page', retryable: false });
    });

    it('no row, no fallback configured → unknown page, permanent', async () => {
      const MetaPage = { findOne: jest.fn().mockResolvedValue(null) };
      const { resolvePageAccessToken } = makeMetaPageTokens({ MetaPage });
      await expect(resolvePageAccessToken(PAGE)).resolves.toEqual({ token: null, reason: 'unknown_page', retryable: false });
    });
  });
});
