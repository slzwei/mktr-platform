import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';
import { makeMetaGraphClient, GraphError, appsecretProof, redactGraphError } from '../../src/services/metaGraphClient.js';

process.env.META_APP_SECRET = 'proof-secret';
process.env.META_APP_ID = '1957';

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, json: async () => body, text: async () => JSON.stringify(body),
});

describe('metaGraphClient (unit)', () => {
  it('tokens ride the Authorization header (never the URL); only the proof is a query param', async () => {
    const expected = crypto.createHmac('sha256', 'proof-secret').update('TOK').digest('hex');
    expect(appsecretProof('TOK')).toBe(expected);

    const fetch = jest.fn().mockResolvedValue(jsonResponse({ id: '1' }));
    const client = makeMetaGraphClient({ fetch });
    await client.call('me', { token: 'TOK' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain(`appsecret_proof=${expected}`);
    expect(url).not.toContain('TOK');
    expect(init.headers.Authorization).toBe('Bearer TOK');
  });

  it('error taxonomy: 404 + OAuth 100/190/102/10 permanent; 429/5xx/network retryable', async () => {
    const cases = [
      [{ ok: false, status: 404, body: {} }, false],
      [{ ok: false, status: 400, body: { error: { type: 'OAuthException', code: 190, message: 'expired' } } }, false],
      [{ ok: false, status: 403, body: { error: { type: 'OAuthException', code: 10, message: 'perm' } } }, false],
      [{ ok: false, status: 429, body: { error: { code: 4 } } }, true],
      [{ ok: false, status: 500, body: { error: { code: 2 } } }, true],
    ];
    for (const [{ ok, status, body }, retryable] of cases) {
      const client = makeMetaGraphClient({ fetch: jest.fn().mockResolvedValue(jsonResponse(body, { ok, status })) });
      await expect(client.call('x', { token: 'T' })).rejects.toMatchObject({ retryable });
    }
    const network = makeMetaGraphClient({ fetch: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });
    await expect(network.call('x', {})).rejects.toMatchObject({ retryable: true });
  });

  it('errors never carry tokens/codes/proofs', () => {
    const msg = redactGraphError('failed access_token=EAAB123 appsecret_proof=beef code=SECRET Bearer EAAB.99');
    expect(msg).not.toMatch(/EAAB|beef|SECRET/);
  });

  it('callAllPages re-issues cursors through the client (token+proof re-applied), never follows foreign hosts, throws on overflow', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }], paging: { next: 'https://graph.facebook.com/v23.0/x?after=c1', cursors: { after: 'c1' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 2 }], paging: { next: 'https://graph.facebook.com/v23.0/x?after=c2', cursors: { after: 'c2' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 3 }] }));
    const client = makeMetaGraphClient({ fetch });
    const all = await client.callAllPages('me/accounts', { token: 'T' });
    expect(all.map((x) => x.id)).toEqual([1, 2, 3]);
    // Every continuation went through the client: token stays in the header.
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toContain('graph.facebook.com');
      expect(init.headers.Authorization).toBe('Bearer T');
    }
    expect(fetch.mock.calls[1][0]).toContain('after=c1');

    const foreign = makeMetaGraphClient({
      fetch: jest.fn().mockResolvedValue(jsonResponse({ data: [], paging: { next: 'https://evil.example.com/x', cursors: { after: 'c' } } })),
    });
    await expect(foreign.callAllPages('me/accounts', { token: 'T' })).rejects.toMatchObject({ kind: 'pagination_host' });

    const endless = makeMetaGraphClient({
      fetch: jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: 9 }], paging: { next: 'https://graph.facebook.com/v23.0/x?after=c', cursors: { after: 'c' } } })),
    });
    await expect(endless.callAllPages('me/accounts', { token: 'T' }, { maxPages: 3 })).rejects.toMatchObject({ kind: 'pagination_overflow' });
  });

  it('exchangeCodeForLongLivedToken uses POST form bodies — credentials never in URLs', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'SHORT' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'LONG', expires_in: 5184000 }));
    const client = makeMetaGraphClient({ fetch });
    const r = await client.exchangeCodeForLongLivedToken('CODE', 'https://api.mktr.sg/api/meta/oauth/callback');
    expect(r).toEqual({ token: 'LONG', expiresIn: 5184000 });
    const [url1, init1] = fetch.mock.calls[0];
    const [url2, init2] = fetch.mock.calls[1];
    expect(url1).not.toContain('CODE');
    expect(url1).not.toContain('client_secret');
    expect(init1.method).toBe('POST');
    expect(init1.body).toContain('code=CODE');
    expect(url2).not.toContain('SHORT');
    expect(init2.body).toContain('fb_exchange_token=SHORT');
  });

  it('a GraphError message is pre-redacted at construction', () => {
    const err = new GraphError('boom access_token=EAABxyz', { retryable: false });
    expect(err.message).not.toContain('EAABxyz');
    expect(err.retryable).toBe(false);
  });
});
