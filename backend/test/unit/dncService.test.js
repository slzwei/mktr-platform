import { jest } from '@jest/globals';
import crypto from 'crypto';

// Mocks BEFORE importing the SUT (Jest ESM pattern).
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  init: jest.fn(),
  setTag: jest.fn(),
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// Mock models/index.js so importing the SUT does NOT open a DB connection.
jest.unstable_mockModule('../../src/models/index.js', () => ({
  Prospect: { update: jest.fn() },
  ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
  sequelize: { transaction: jest.fn(), query: jest.fn() },
}));

let dnc;
beforeAll(async () => {
  dnc = await import('../../src/services/dncService.js');
});

function keypair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('formatDncNumber', () => {
  it.each([
    ['+65 9123 4567', '91234567'],
    ['6591234567', '91234567'],
    ['91234567', '91234567'],
    ['+6581234567', '81234567'],
    ['31234567', '31234567'],
    ['61234567', '61234567'],
  ])('%s -> %s', (input, expected) => {
    expect(dnc.formatDncNumber(input)).toBe(expected);
  });

  it.each([['21234567'], ['+14155550123'], ['1234'], [''], [null], [undefined]])(
    'rejects %s',
    (input) => {
      expect(dnc.formatDncNumber(input)).toBeNull();
    }
  );
});

describe('buildBaseString / buildAuthHeader', () => {
  it('base string is in the fixed order', () => {
    expect(
      dnc.buildBaseString({ orgCode: 'ORGF000000000071', eServiceId: 'dncmyinfo', timestamp: 1602225459377 })
    ).toBe('orgCode=ORGF000000000071&eServiceId=dncmyinfo&timestamp=1602225459377');
  });
  it('auth header appends appSignature last', () => {
    expect(dnc.buildAuthHeader({ orgCode: 'O', eServiceId: 'E', timestamp: 123, appSignature: 'SIG' })).toBe(
      'orgCode=O&eServiceId=E&timestamp=123&appSignature=SIG'
    );
  });
});

describe('signRequest', () => {
  it('produces an RSA-SHA256 signature verifiable with the public key, no line breaks', () => {
    const { privateKey, publicKey } = keypair();
    const base = dnc.buildBaseString({ orgCode: 'O', eServiceId: 'E', timestamp: 123 });
    const sig = dnc.signRequest(base, privateKey);
    expect(typeof sig).toBe('string');
    expect(sig).not.toMatch(/\n/);
    const v = crypto.createVerify('RSA-SHA256');
    v.update(base, 'utf8');
    v.end();
    expect(v.verify(publicKey, sig, 'base64')).toBe(true);
  });

  it('handles PEM stored with literal \\n', () => {
    const { privateKey, publicKey } = keypair();
    const escaped = privateKey.replace(/\n/g, '\\n');
    const base = 'orgCode=O&eServiceId=E&timestamp=1';
    const sig = dnc.signRequest(base, escaped);
    const v = crypto.createVerify('RSA-SHA256');
    v.update(base);
    v.end();
    expect(v.verify(publicKey, sig, 'base64')).toBe(true);
  });
});

describe('mapStatusCode', () => {
  it('S000 ok', () => expect(dnc.mapStatusCode('S000')).toEqual({ ok: true }));
  it('S301 insufficient credits → retriable + alert', () =>
    expect(dnc.mapStatusCode('S301')).toMatchObject({ ok: false, retriable: true, alert: true, reason: 'insufficient_credits' }));
  it('S501 retriable', () => expect(dnc.mapStatusCode('S501')).toMatchObject({ ok: false, retriable: true }));
  it.each(['S401', 'S402', 'S404'])('%s → auth, not retriable, alert', (c) =>
    expect(dnc.mapStatusCode(c)).toMatchObject({ reason: 'auth', retriable: false, alert: true }));
  it('unknown → retriable', () =>
    expect(dnc.mapStatusCode('S999')).toMatchObject({ ok: false, retriable: true, reason: 'unknown' }));
});

describe('parseValidUntil', () => {
  it('parses the PDPC msg', () => {
    const d = dnc.parseValidUntil('These results are valid until 06-Nov-2020');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2020);
    expect(d.getUTCMonth()).toBe(10); // November
  });
  it('null on no date', () => expect(dnc.parseValidUntil('no date here')).toBeNull());
});

describe('parseResponse', () => {
  it('maps R/NR to booleans and extracts metadata', () => {
    const json = {
      msg: 'These results are valid until 06-Nov-2020',
      numbers: [
        { number: '90000001', no_voice_call: 'R', no_text_message: 'NR', no_fax: 'NR' },
        { number: '90000002', no_voice_call: 'NR', no_text_message: 'NR', no_fax: 'NR' },
      ],
      transactionid: '5506778',
      created_time: '2020-10-07 17:34:53',
      status_code: 'S000',
    };
    const r = dnc.parseResponse(json);
    expect(r.statusCode).toBe('S000');
    expect(r.transactionId).toBe('5506778');
    expect(r.results[0]).toEqual({ number: '90000001', noVoiceCall: true, noTextMessage: false, noFax: false });
    expect(r.results[1].noVoiceCall).toBe(false);
    expect(r.validUntil).toBeInstanceOf(Date);
  });
});

describe('nextTimestamp', () => {
  it('is strictly monotonic even when the clock regresses', () => {
    const a = dnc.nextTimestamp(1000);
    const b = dnc.nextTimestamp(1000);
    const c = dnc.nextTimestamp(500);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe('hasFreshDnc', () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);
  it('clear + future = fresh', () => expect(dnc.hasFreshDnc({ dncStatus: 'clear', dncValidUntil: future })).toBe(true));
  it('registered + future = fresh', () =>
    expect(dnc.hasFreshDnc({ dncStatus: 'registered', dncValidUntil: future })).toBe(true));
  it('expired = stale', () => expect(dnc.hasFreshDnc({ dncStatus: 'clear', dncValidUntil: past })).toBe(false));
  it('pending = stale', () => expect(dnc.hasFreshDnc({ dncStatus: 'pending', dncValidUntil: future })).toBe(false));
});

describe('checkNumbers (mock fetch, skipLock)', () => {
  it('posts a signed request to the endpoint and parses the response', async () => {
    const { privateKey } = keypair();
    const cfg = {
      enabled: true, baseUrl: 'https://uat.dnc.gov.sg/realtime', orgCode: 'ORG', eServiceId: 'ESVC',
      privateKey, checkOnBehalf: 'N', proxy: null, timeoutMs: 5000,
    };
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        msg: 'valid until 06-Nov-2020',
        numbers: [{ number: '90000001', no_voice_call: 'NR', no_text_message: 'NR', no_fax: 'NR' }],
        transactionid: 'T1',
        status_code: 'S000',
      }),
    });
    const res = await dnc.checkNumbers(['90000001'], { cfg }, { fetch: fetchMock, skipLock: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://uat.dnc.gov.sg/realtime/check/registry');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toMatch(/^orgCode=ORG&eServiceId=ESVC&timestamp=\d+&appSignature=.+/);
    expect(JSON.parse(opts.body)).toEqual({ numbers: ['90000001'], total: 1, checkOnBehalf: 'N' });
    expect(res.statusCode).toBe('S000');
    expect(res.results[0].noVoiceCall).toBe(false);
  });
});

describe('checkAndRecord (mock fetch + models)', () => {
  const { privateKey } = keypair();
  const cfg = {
    enabled: true, baseUrl: 'https://x/realtime', orgCode: 'O', eServiceId: 'E',
    privateKey, checkOnBehalf: 'N', proxy: null, timeoutMs: 5000,
  };
  const mkDeps = (json) => {
    const Prospect = { update: jest.fn().mockResolvedValue([1]) };
    const ProspectActivity = { create: jest.fn().mockResolvedValue({}) };
    const fetch = jest.fn().mockResolvedValue({ status: 200, json: async () => json });
    return { fetch, skipLock: true, Prospect, ProspectActivity, cfg, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
  };

  it('records a clear number', async () => {
    const deps = mkDeps({
      msg: 'valid until 06-Nov-2030',
      numbers: [{ number: '90000001', no_voice_call: 'NR', no_text_message: 'NR', no_fax: 'NR' }],
      transactionid: 'T1', status_code: 'S000',
    });
    const out = await dnc.checkAndRecord({ id: 'p1', phone: '+6590000001' }, deps);
    expect(out.status).toBe('clear');
    const [fields] = deps.Prospect.update.mock.calls[0];
    expect(fields.dncStatus).toBe('clear');
    expect(fields.dncNoVoiceCall).toBe(false);
    expect(deps.ProspectActivity.create).toHaveBeenCalledTimes(1);
  });

  it('records a registered number (voice)', async () => {
    const deps = mkDeps({
      msg: 'valid until 06-Nov-2030',
      numbers: [{ number: '90000001', no_voice_call: 'R', no_text_message: 'NR', no_fax: 'NR' }],
      transactionid: 'T2', status_code: 'S000',
    });
    const out = await dnc.checkAndRecord({ id: 'p2', phone: '90000001' }, deps);
    expect(out.status).toBe('registered');
    expect(out.noVoiceCall).toBe(true);
    const [fields] = deps.Prospect.update.mock.calls[0];
    expect(fields.dncStatus).toBe('registered');
    expect(fields.dncNoVoiceCall).toBe(true);
  });

  it('skips a non-SG number without calling the API', async () => {
    const deps = mkDeps({});
    const out = await dnc.checkAndRecord({ id: 'p3', phone: '+14155550123' }, deps);
    expect(out.status).toBe('skipped');
    expect(deps.fetch).not.toHaveBeenCalled();
    const [fields] = deps.Prospect.update.mock.calls[0];
    expect(fields.dncStatus).toBe('skipped');
  });

  it('uses the cache (no API call) when a fresh result exists', async () => {
    const deps = mkDeps({});
    const future = new Date(Date.now() + 86400000);
    const out = await dnc.checkAndRecord({ id: 'p4', phone: '90000001', dncStatus: 'clear', dncValidUntil: future }, deps);
    expect(out).toEqual({ status: 'clear', noVoiceCall: false, noTextMessage: false, noFax: false, cached: true });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('marks pending on S301 (insufficient credits)', async () => {
    const deps = mkDeps({ status_code: 'S301', numbers: [] });
    const out = await dnc.checkAndRecord({ id: 'p5', phone: '90000001' }, deps);
    expect(out.status).toBe('pending');
    const [fields] = deps.Prospect.update.mock.calls[0];
    expect(fields.dncStatus).toBe('pending');
    expect(deps.ProspectActivity.create).not.toHaveBeenCalled();
  });

  it('returns disabled when not configured', async () => {
    const deps = mkDeps({});
    deps.cfg = { ...cfg, enabled: false };
    const out = await dnc.checkAndRecord({ id: 'p6', phone: '90000001' }, deps);
    expect(out.status).toBe('disabled');
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('budget guard (checkNumbers)', () => {
  const { privateKey } = keypair();
  const cfg = {
    enabled: true, baseUrl: 'https://x/realtime', orgCode: 'O', eServiceId: 'E',
    privateKey, checkOnBehalf: 'N', proxy: null, timeoutMs: 5000,
  };
  const okFetch = () => jest.fn().mockResolvedValue({ status: 200, json: async () => ({ status_code: 'S000', numbers: [] }) });

  beforeEach(() => dnc._resetDncBudget());

  it('refuses (budgetExceeded, no network) once over the hourly cap', async () => {
    const prev = process.env.DNC_HOURLY_BUDGET;
    process.env.DNC_HOURLY_BUDGET = '2';
    const fetch = okFetch();
    const r1 = await dnc.checkNumbers(['90000001', '90000002'], { cfg }, { fetch, skipLock: true });
    expect(r1.budgetExceeded).toBeFalsy();
    const r2 = await dnc.checkNumbers(['90000003'], { cfg }, { fetch, skipLock: true });
    expect(r2.budgetExceeded).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1); // the over-budget call never hit the network
    process.env.DNC_HOURLY_BUDGET = prev;
  });

  it('skipBudget bypasses the cap', async () => {
    const prev = process.env.DNC_HOURLY_BUDGET;
    process.env.DNC_HOURLY_BUDGET = '0';
    const fetch = okFetch();
    const r = await dnc.checkNumbers(['90000001'], { cfg }, { fetch, skipLock: true, skipBudget: true });
    expect(r.budgetExceeded).toBeFalsy();
    expect(fetch).toHaveBeenCalledTimes(1);
    process.env.DNC_HOURLY_BUDGET = prev;
  });
});

describe('checkAndRecord cache hit returns channel flags', () => {
  const { privateKey } = keypair();
  const cfg = {
    enabled: true, baseUrl: 'https://x/realtime', orgCode: 'O', eServiceId: 'E',
    privateKey, checkOnBehalf: 'N', proxy: null, timeoutMs: 5000,
  };
  it('reuses stored channel flags without calling the API', async () => {
    const fetch = jest.fn();
    const future = new Date(Date.now() + 86400000);
    const out = await dnc.checkAndRecord(
      { id: 'p', phone: '90000001', dncStatus: 'registered', dncValidUntil: future, dncNoVoiceCall: true, dncNoTextMessage: false, dncNoFax: false },
      { fetch, skipLock: true, cfg, Prospect: { update: jest.fn() }, ProspectActivity: { create: jest.fn() } }
    );
    expect(out).toEqual({ status: 'registered', noVoiceCall: true, noTextMessage: false, noFax: false, cached: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
