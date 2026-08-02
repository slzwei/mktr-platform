/**
 * P2-1 regression: every external call is bounded and retried the same way.
 *
 * Both clients called bare `fetch` with NO timeout. Apify's startRun is awaited
 * INLINE on the operator's request (discoveryService), so a hung TCP connection
 * hung the request until the platform killed it. And the retry posture was
 * backwards: WhatsApp retried 3×, Apify — the dependency that costs money per
 * run — retried 0×.
 */
import { jest } from '@jest/globals';
import '../setup.js';
import { fetchWithTimeout, retryingFetch, DEFAULT_TIMEOUT_MS } from '../../src/utils/externalFetch.js';
import { makeApifyClient } from '../../src/services/redeemOps/discovery/apifyClient.js';
import { makeWaGraphClient } from '../../src/services/waGraphClient.js';

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const boom = (status) => ({ ok: false, status, json: async () => ({}), text: async () => 'upstream said no' });

/** A fetch that never settles until its signal aborts — the hang this bounds. */
const hangingFetch = jest.fn((_url, opts) => new Promise((_resolve, reject) => {
  opts.signal.addEventListener('abort', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    reject(err);
  });
}));

const silent = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
const noSleep = () => Promise.resolve();

beforeEach(() => jest.clearAllMocks());

describe('fetchWithTimeout', () => {
  it('aborts a request that never resolves', async () => {
    await expect(
      fetchWithTimeout(hangingFetch, 'https://example.test', {}, { timeoutMs: 20, label: 'probe' })
    ).rejects.toMatchObject({ name: 'AbortError', timeout: true });
  });

  it('names the caller and the budget in the error', async () => {
    await expect(
      fetchWithTimeout(hangingFetch, 'https://example.test', {}, { timeoutMs: 20, label: 'apify POST /runs' })
    ).rejects.toThrow(/apify POST \/runs timed out after 20ms/);
  });

  it('passes a signal through so the socket is actually released', async () => {
    const spy = jest.fn(async () => ok());
    await fetchWithTimeout(spy, 'https://example.test', { method: 'POST' });
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(spy.mock.calls[0][1].method).toBe('POST');
  });

  it('does not disturb a response that arrives in time', async () => {
    const res = await fetchWithTimeout(async () => ok({ hi: true }), 'https://example.test', {}, { timeoutMs: 500 });
    expect(res.status).toBe(200);
  });

  it('defaults to a bounded budget rather than none', () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});

describe('retryingFetch', () => {
  it('retries a 5xx and returns the eventual success', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(boom(500))
      .mockResolvedValueOnce(ok({ recovered: true }));

    const res = await retryingFetch(fetchImpl, 'https://example.test', {}, { sleep: noSleep, logger: silent });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it('returns a 4xx as-is — retrying a deterministic answer just spends quota', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(boom(400));

    const res = await retryingFetch(fetchImpl, 'https://example.test', {}, { sleep: noSleep, logger: silent });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
  });

  it('retries a network throw, then gives up with the last error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('socket hang up'));

    await expect(
      retryingFetch(fetchImpl, 'https://example.test', {}, { attempts: 3, sleep: noSleep, logger: silent })
    ).rejects.toThrow('socket hang up');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('treats a timeout as transient and retries it', async () => {
    const fetchImpl = jest.fn()
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValueOnce(ok({ second: true }));

    const res = await retryingFetch(fetchImpl, 'https://example.test', {}, {
      attempts: 2, timeoutMs: 20, sleep: noSleep, logger: silent,
    });

    expect(res.status).toBe(200);
    expect(silent.warn).toHaveBeenCalledWith(
      expect.stringContaining('retry_network'),
      expect.objectContaining({ timeout: true })
    );
  });
});

describe('apifyClient transport', () => {
  const client = (fetchImpl, over = {}) => makeApifyClient({
    token: 'test-token', fetchImpl, logger: silent, ...over,
  });

  it('retries a 500 once and succeeds — it used to have no retry at all', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(boom(500))
      .mockResolvedValueOnce(ok({ data: { id: 'run-1', defaultDatasetId: 'ds-1', status: 'RUNNING' } }));

    const run = await client(fetchImpl).startRun('actor~id', { q: 'spa' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(run).toMatchObject({ runId: 'run-1', datasetId: 'ds-1' });
  });

  it('bounds a hung run-start instead of hanging the operator request', async () => {
    await expect(
      client(hangingFetch, { timeoutMs: 20, attempts: 1 }).startRun('actor~id', {})
    ).rejects.toMatchObject({ name: 'AbortError', timeout: true });
  });

  it('surfaces a 4xx without burning retries', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(boom(404));

    await expect(client(fetchImpl).startRun('missing~actor', {})).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('waGraphClient transport', () => {
  it('keeps its 3-attempt 5xx retry and now bounds each attempt', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(boom(500))
      .mockResolvedValueOnce(ok({ messages: [{ id: 'wamid.1' }] }));

    const res = await makeWaGraphClient({ fetch: fetchImpl, sleep: noSleep, logger: silent })
      .sendTemplate({ phoneId: '1', token: 't', to: '6591234567', name: 'tpl', language: 'en', components: [] });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('still returns a 4xx for the caller to receipt', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(boom(400));

    const res = await makeWaGraphClient({ fetch: fetchImpl, sleep: noSleep, logger: silent })
      .sendTemplate({ phoneId: '1', token: 't', to: '6591234567', name: 'tpl', language: 'en', components: [] });

    expect(res.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
