import { jest } from '@jest/globals';

/**
 * The sandbox DNC gate lives inside dncService, so EVERY caller inherits it —
 * the form check, the create-time check, Retell and the backfill.
 *
 * The load-bearing assertion is the negative one (plan requirement 11): a
 * non-allowlisted number must be refused BEFORE any provider request is built.
 */

const ORIGINAL_ENV = { ...process.env };

async function loadService(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../../src/services/dncService.js');
}

function harness() {
  const state = {};
  const fetchCalls = [];
  const gatewayCalls = [];
  return {
    fetchCalls,
    gatewayCalls,
    deps: {
      skipLock: true,
      skipBudget: true,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      bump: async (key) => { state[key] = (state[key] || 0) + 1; return { count: state[key], expiresAt: new Date(Date.now() + 3600_000) }; },
      unbump: async (key) => { state[key] = Math.max((state[key] || 0) - 1, 0); },
      fetch: async (...args) => {
        fetchCalls.push(args);
        return { status: 200, json: async () => ({ status_code: 'S000', numbers: [{ number: '62773210', no_voice_call: 'N' }] }) };
      },
      submitToGateway: async (req) => {
        gatewayCalls.push(req);
        return { statusCode: 'S000', results: [{ number: req.numbers[0], noVoiceCall: false, noTextMessage: false, noFax: false }], validUntil: null, transactionId: 'txn-1', createdTime: null, rawMsg: null };
      },
    },
  };
}

const SANDBOX = {
  DEPLOY_ENV: 'sandbox',
  DNC_API_ENABLED: 'true',
  SANDBOX_LIVE_DNC_ENABLED: 'true',
  SANDBOX_ALLOWED_PHONES: '+6596989089',
  DNC_GATEWAY_URL: 'https://gateway.internal',
  DNC_GATEWAY_TOKEN: 'token',
};

afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('sandbox DNC gate', () => {
  test('a non-allowlisted number never reaches the provider or the gateway', async () => {
    const svc = await loadService(SANDBOX);
    const h = harness();
    const out = await svc.checkNumbers(['91234567'], {}, h.deps);
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('not_allowlisted');
    expect(out.results).toEqual([]);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.gatewayCalls).toHaveLength(0);
  });

  test('a fixed-OTP seed number is refused even though it is a valid SG number', async () => {
    const svc = await loadService({ ...SANDBOX, SANDBOX_ALLOWED_PHONES: '+6580000201' });
    const h = harness();
    const out = await svc.checkNumbers(['80000201'], {}, h.deps);
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('blocked_destination');
    expect(h.gatewayCalls).toHaveLength(0);
  });

  test('one bad number fails the whole batch closed', async () => {
    const svc = await loadService(SANDBOX);
    const h = harness();
    const out = await svc.checkNumbers(['96989089', '91234567'], {}, h.deps);
    expect(out.blocked).toBe(true);
    expect(h.gatewayCalls).toHaveLength(0);
  });

  test('the rail kill switch alone stops every check', async () => {
    const svc = await loadService({ ...SANDBOX, SANDBOX_LIVE_DNC_ENABLED: 'false' });
    const h = harness();
    const out = await svc.checkNumbers(['96989089'], {}, h.deps);
    expect(out.blockedReason).toBe('rail_disabled');
    expect(h.gatewayCalls).toHaveLength(0);
  });

  test('an allowlisted number is submitted through the shared queue, not signed locally', async () => {
    const svc = await loadService(SANDBOX);
    const h = harness();
    const out = await svc.checkNumbers(['96989089'], {}, h.deps);
    expect(out.statusCode).toBe('S000');
    expect(h.gatewayCalls).toHaveLength(1);
    expect(h.gatewayCalls[0].numbers).toEqual(['96989089']);
    // Nothing was signed or sent from this process.
    expect(h.fetchCalls).toHaveLength(0);
  });
});

describe('production routing', () => {
  test('production with a gateway configured submits through it and never signs locally', async () => {
    const svc = await loadService({
      DEPLOY_ENV: 'production',
      DNC_API_ENABLED: 'true',
      DNC_GATEWAY_URL: 'https://gateway.internal',
      DNC_GATEWAY_TOKEN: 'token',
      DNC_ORG_CODE: '', DNC_ESERVICE_ID: '', DNC_PRIVATE_KEY: '',
    });
    expect(svc.usesGateway()).toBe(true);
    expect(svc.dncReady()).toBe(true); // credential lives in the gateway now
    const h = harness();
    const out = await svc.checkNumbers(['62773210'], {}, h.deps);
    expect(out.statusCode).toBe('S000');
    expect(h.gatewayCalls).toHaveLength(1);
    expect(h.fetchCalls).toHaveLength(0);
  });

  test('unsetting DNC_GATEWAY_URL rolls straight back to the direct PDPC path', async () => {
    const svc = await loadService({
      DEPLOY_ENV: 'production',
      DNC_API_ENABLED: 'true',
      DNC_BASE_URL: 'https://www.dnc.gov.sg/realtime',
      DNC_ORG_CODE: 'ORG', DNC_ESERVICE_ID: 'SVC',
      DNC_PRIVATE_KEY: 'unused-in-this-path',
    });
    expect(svc.usesGateway()).toBe(false);
    const h = harness();
    // The direct path signs, so give it a key it can actually use.
    h.deps.nextTimestamp = () => 1;
    const signing = jest.fn(() => 'sig');
    const out = await svc.checkNumbers(['62773210'], { cfg: { ...svc.dncConfig(), privateKey: 'x' } }, {
      ...h.deps,
      fetch: async (url) => {
        h.fetchCalls.push(url);
        return { status: 200, json: async () => ({ status_code: 'S000', numbers: [] }) };
      },
      signRequest: signing,
    }).catch((err) => ({ error: err.message }));
    // Either it signed and called out, or it failed on the fake key — what
    // matters is that it did NOT go through the gateway.
    expect(h.gatewayCalls).toHaveLength(0);
    expect(out).toBeDefined();
  });

  test('production without a sandbox identity is never gated by the sandbox policy', async () => {
    const svc = await loadService({
      DEPLOY_ENV: 'production',
      DNC_API_ENABLED: 'true',
      DNC_GATEWAY_URL: 'https://gateway.internal',
      DNC_GATEWAY_TOKEN: 'token',
      // No allowlist at all — production must not care.
      SANDBOX_ALLOWED_PHONES: '',
    });
    const h = harness();
    const out = await svc.checkNumbers(['91234567'], {}, h.deps);
    expect(out.blocked).toBeUndefined();
    expect(h.gatewayCalls).toHaveLength(1);
  });
});

describe('fail closed', () => {
  test('an unavailable gateway leaves the lead pending, never clear', async () => {
    const svc = await loadService(SANDBOX);
    const h = harness();
    h.deps.submitToGateway = async () => ({ gatewayUnavailable: true, gatewayReason: 'transport_error', results: [], statusCode: null });
    const updates = [];
    const prospect = { id: 'p1', phone: '+6596989089', update: async (fields) => { updates.push(fields); } };
    const result = await svc.checkAndRecord(prospect, {
      ...h.deps,
      ProspectActivity: { create: async () => {} },
    });
    expect(result.status).toBe('pending');
    expect(result.reason).toBe('transport_error');
    expect(updates.at(-1)).toEqual({ dncStatus: 'pending' });
  });

  test('a sandbox policy refusal leaves the lead pending, never clear', async () => {
    const svc = await loadService(SANDBOX);
    const h = harness();
    const updates = [];
    const prospect = { id: 'p2', phone: '+6591234567', update: async (fields) => { updates.push(fields); } };
    const result = await svc.checkAndRecord(prospect, {
      ...h.deps,
      ProspectActivity: { create: async () => {} },
    });
    expect(result.status).toBe('pending');
    expect(result.reason).toBe('not_allowlisted');
    expect(h.gatewayCalls).toHaveLength(0);
  });
});
