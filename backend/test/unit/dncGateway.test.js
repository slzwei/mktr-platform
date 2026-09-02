import { jest } from '@jest/globals';

/**
 * The shared DNC queue: token→source resolution, the second policy enforcement,
 * the worker's fail-closed behaviour, and the client's fail-closed contract.
 * Deterministic DNC branch coverage uses INJECTED provider fixtures — no live
 * spend, no UAT endpoint (plan §5, §6.6).
 */

const ORIGINAL_ENV = { ...process.env };

async function load(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return {
    server: await import('../../src/dncGateway/server.js'),
    worker: await import('../../src/dncGateway/worker.js'),
    client: await import('../../src/services/dncGatewayClient.js'),
    protocol: await import('../../src/services/dncProtocol.js'),
  };
}

afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('source authentication', () => {
  test('the source comes from the token, never from the caller', async () => {
    const { server } = await load({
      DNC_GATEWAY_TOKEN_PRODUCTION: 'prod-token-value',
      DNC_GATEWAY_TOKEN_SANDBOX: 'sandbox-token-value',
    });
    expect(server.resolveSource('Bearer prod-token-value')).toBe('production');
    expect(server.resolveSource('Bearer sandbox-token-value')).toBe('sandbox');
    expect(server.resolveSource('Bearer wrong')).toBeNull();
    expect(server.resolveSource('prod-token-value')).toBeNull();
    expect(server.resolveSource(undefined)).toBeNull();
  });

  test('an unconfigured source can never authenticate', async () => {
    const { server } = await load({ DNC_GATEWAY_TOKEN_PRODUCTION: 'prod', DNC_GATEWAY_TOKEN_SANDBOX: '' });
    expect(server.resolveSource('Bearer prod')).toBe('production');
    expect(server.resolveSource('Bearer ')).toBeNull();
  });
});

describe('worker', () => {
  const item = (over = {}) => ({
    id: 'item-1', source: 'production', numbers: ['62773210'], check_on_behalf: 'N', attempts: 1, ...over,
  });

  test('an uncredentialed gateway fails the item terminally rather than sending', async () => {
    const { worker } = await load({ DNC_BASE_URL: '', DNC_ORG_CODE: '', DNC_ESERVICE_ID: '', DNC_PRIVATE_KEY: '' });
    const calls = [];
    let sent = false;
    await worker.drainOnce({
      leaseNext: async () => item(),
      admit: async () => ({ allowed: true, keys: [] }),
      fail: async (...args) => { calls.push(args); },
      releaseSandboxBudget: async () => {},
      logger: { warn: () => {}, error: () => {}, info: () => {} },
      sendToPdpc: async () => { sent = true; return {}; },
    });
    expect(sent).toBe(false);
    expect(calls[0][1]).toBe('gateway_not_credentialed');
    expect(calls[0][2]).toEqual({ terminal: true });
  });

  test('a refused sandbox item is blocked and never reaches PDPC', async () => {
    const { worker } = await load({});
    const blocked = [];
    let sent = false;
    await worker.drainOnce({
      leaseNext: async () => item({ source: 'sandbox', numbers: ['91234567'] }),
      admit: async () => ({ allowed: false, reason: 'gateway_not_allowlisted' }),
      block: async (id, reason) => { blocked.push(reason); },
      sendToPdpc: async () => { sent = true; return {}; },
      logger: { warn: () => {}, error: () => {}, info: () => {} },
    });
    expect(blocked).toEqual(['gateway_not_allowlisted']);
    expect(sent).toBe(false);
  });

  test('a credentialed send records the registry verdict and its PDPC timestamp', async () => {
    const { worker } = await load({
      DNC_BASE_URL: 'https://www.dnc.gov.sg/realtime',
      DNC_ORG_CODE: 'ORG', DNC_ESERVICE_ID: 'SVC', DNC_PRIVATE_KEY: 'pem',
    });
    const completed = [];
    await worker.drainOnce({
      leaseNext: async () => item(),
      admit: async () => ({ allowed: true, keys: [] }),
      complete: async (...args) => { completed.push(args); },
      logger: { warn: () => {}, error: () => {}, info: () => {} },
      sendToPdpc: async () => ({
        httpStatus: 200,
        timestamp: 1756800000123,
        statusCode: 'S000',
        results: [{ number: '62773210', noVoiceCall: false, noTextMessage: false, noFax: false }],
        validUntil: new Date('2026-11-06T15:59:59.000Z'),
        transactionId: '105965540',
        createdTime: null,
        rawMsg: 'valid until 06-Nov-2026',
      }),
    });
    expect(completed).toHaveLength(1);
    expect(completed[0][1].pdpcTimestamp).toBe(1756800000123);
    expect(completed[0][1].result.statusCode).toBe('S000');
    expect(completed[0][1].result.results[0].noVoiceCall).toBe(false);
  });

  test('an idle queue is a no-op', async () => {
    const { worker } = await load({});
    await expect(worker.drainOnce({ leaseNext: async () => null })).resolves.toBeNull();
  });
});

describe('gateway client — fail closed', () => {
  const cfg = { url: 'https://gateway.internal', token: 't', waitMs: 100, timeoutMs: 200 };
  const silent = { logger: { info: () => {}, warn: () => {}, error: () => {} } };

  test('an unconfigured gateway reports unavailable, never "clear"', async () => {
    const { client } = await load({});
    const out = await client.submitToGateway({ numbers: ['62773210'], checkOnBehalf: 'N' }, {
      ...silent, gatewayConfig: { url: '', token: '' },
    });
    expect(out.gatewayUnavailable).toBe(true);
    expect(out.results).toEqual([]);
  });

  test('a transport failure reports unavailable', async () => {
    const { client } = await load({});
    const out = await client.submitToGateway({ numbers: ['62773210'], checkOnBehalf: 'N' }, {
      ...silent, gatewayConfig: cfg, fetch: async () => { throw new Error('ECONNREFUSED'); },
    });
    expect(out).toMatchObject({ gatewayUnavailable: true, gatewayReason: 'transport_error' });
  });

  test('a 202 (queued but unanswered) is unavailable, not a verdict', async () => {
    const { client } = await load({});
    const out = await client.submitToGateway({ numbers: ['62773210'], checkOnBehalf: 'N' }, {
      ...silent, gatewayConfig: cfg, fetch: async () => ({ status: 202, ok: false }),
    });
    expect(out).toMatchObject({ gatewayUnavailable: true, gatewayReason: 'still_queued' });
  });

  test('a 401 is reported as unauthorized', async () => {
    const { client } = await load({});
    const out = await client.submitToGateway({ numbers: ['62773210'], checkOnBehalf: 'N' }, {
      ...silent, gatewayConfig: cfg, fetch: async () => ({ status: 401, ok: false, text: async () => 'no' }),
    });
    expect(out).toMatchObject({ gatewayUnavailable: true, gatewayReason: 'unauthorized' });
  });

  test('a successful answer is passed through with the registry verdict intact', async () => {
    const { client } = await load({});
    const out = await client.submitToGateway({ numbers: ['62773210'], checkOnBehalf: 'N' }, {
      ...silent,
      gatewayConfig: cfg,
      fetch: async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          id: 'q1',
          result: {
            httpStatus: 200,
            statusCode: 'S000',
            results: [{ number: '62773210', noVoiceCall: true, noTextMessage: false, noFax: false }],
            validUntil: '2026-11-06T15:59:59.000Z',
            transactionId: '105965540',
            rawMsg: 'valid until 06-Nov-2026',
          },
        }),
      }),
    });
    expect(out.statusCode).toBe('S000');
    expect(out.results[0].noVoiceCall).toBe(true);
    expect(out.transactionId).toBe('105965540');
    expect(out.validUntil).toBeInstanceOf(Date);
  });

  test('a gateway policy refusal is surfaced as blocked, not as a clear result', async () => {
    const { client } = await load({});
    const out = await client.submitToGateway({ numbers: ['91234567'], checkOnBehalf: 'N' }, {
      ...silent,
      gatewayConfig: cfg,
      fetch: async () => ({ status: 200, ok: true, json: async () => ({ id: 'q2', result: { blocked: true, blockedReason: 'gateway_not_allowlisted' } }) }),
    });
    expect(out).toMatchObject({ blocked: true, blockedReason: 'gateway_not_allowlisted' });
    expect(out.results).toEqual([]);
  });
});

describe('protocol parity', () => {
  test('the gateway and the app share one wire format', async () => {
    const { protocol } = await load({});
    const service = await import('../../src/services/dncService.js');
    expect(service.buildBaseString({ orgCode: 'A', eServiceId: 'B', timestamp: 1 }))
      .toBe(protocol.buildBaseString({ orgCode: 'A', eServiceId: 'B', timestamp: 1 }));
    expect(service.formatDncNumber('+6562773210')).toBe(protocol.formatDncNumber('62773210'));
    expect(service.mapStatusCode('S301')).toEqual(protocol.mapStatusCode('S301'));
  });
});
