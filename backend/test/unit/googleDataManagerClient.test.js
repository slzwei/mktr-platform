import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let client;
beforeAll(async () => {
  client = await import('../../src/utils/googleDataManagerClient.js');
});

const ENV_KEYS = [
  'GOOGLE_DM_OAUTH_CLIENT_ID',
  'GOOGLE_DM_OAUTH_CLIENT_SECRET',
  'GOOGLE_DM_REFRESH_TOKEN',
  'GOOGLE_DM_API_VERSION',
];
const saved = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_DM_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET = 'sec';
  process.env.GOOGLE_DM_REFRESH_TOKEN = 'rt';
  delete process.env.GOOGLE_DM_API_VERSION;
  client.__resetTokenCacheForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const tokenOk = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'at-1', expires_in: 3600 }),
  });

describe('getAccessToken', () => {
  it('mints via the refresh grant and caches until expiry', async () => {
    const fetch = jest.fn().mockImplementation(tokenOk);
    const now = jest.fn().mockReturnValue(1_000_000);
    expect(await client.getAccessToken({ fetch, now })).toBe('at-1');
    expect(await client.getAccessToken({ fetch, now })).toBe('at-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.body).toContain('grant_type=refresh_token');
  });

  it('re-mints once the cached token nears expiry', async () => {
    const fetch = jest.fn().mockImplementation(tokenOk);
    let t = 1_000_000;
    const now = jest.fn(() => t);
    await client.getAccessToken({ fetch, now });
    t += 3600_000 - 30_000; // inside the 60s slack window
    await client.getAccessToken({ fetch, now });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on incomplete OAuth env without calling out', async () => {
    delete process.env.GOOGLE_DM_REFRESH_TOKEN;
    const fetch = jest.fn();
    await expect(client.getAccessToken({ fetch })).rejects.toThrow(/OAuth env incomplete/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a sanitized error on a refresh failure', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Token has been revoked.' }),
    });
    await expect(client.getAccessToken({ fetch })).rejects.toThrow(
      /token refresh failed: HTTP 400 Token has been revoked\./
    );
  });
});

describe('dmRequest', () => {
  it('POSTs the method under the versioned base with a bearer token', async () => {
    const fetch = jest
      .fn()
      .mockImplementationOnce(tokenOk)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ requestId: 'r1' }) });
    const res = await client.dmRequest('audienceMembers:ingest', { a: 1 }, { fetch });
    expect(res).toEqual({ requestId: 'r1' });
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:ingest');
    expect(init.headers.Authorization).toBe('Bearer at-1');
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it('honours GOOGLE_DM_API_VERSION', async () => {
    process.env.GOOGLE_DM_API_VERSION = 'v2beta';
    const fetch = jest
      .fn()
      .mockImplementationOnce(tokenOk)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await client.dmRequest('events:ingest', {}, { fetch });
    expect(fetch.mock.calls[1][0]).toBe('https://datamanager.googleapis.com/v2beta/events:ingest');
  });

  it('throws a sanitized error carrying status + google message, never the request body', async () => {
    const fetch = jest
      .fn()
      .mockImplementationOnce(tokenOk)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Customer Match not allowed' } }),
      });
    const err = await client
      .dmRequest('audienceMembers:ingest', { secretHash: 'abc123' }, { fetch })
      .catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/HTTP 403 Customer Match not allowed/);
    expect(err.message).not.toMatch(/abc123/);
  });
});
