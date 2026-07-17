import { jest } from '@jest/globals';

// Mocks BEFORE importing the SUT (Jest ESM pattern) — importing dncCheckService transitively
// loads dncService → models/index.js; mock it so no DB connection is opened.
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  init: jest.fn(),
  setTag: jest.fn(),
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../src/models/index.js', () => ({
  Prospect: { update: jest.fn() },
  ProspectActivity: { create: jest.fn() },
  Campaign: { findByPk: jest.fn() },
  sequelize: { transaction: jest.fn(), query: jest.fn() },
}));

let svc;
beforeAll(async () => {
  svc = await import('../../src/services/dncCheckService.js');
});

const baseLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// Sensible all-pass deps; each test overrides exactly what it exercises.
function mkDeps(over = {}) {
  return {
    Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', design_config: { dncCheckAtSubmit: true } }) },
    dncReady: jest.fn().mockReturnValue(true),
    formatDncNumber: jest.fn().mockReturnValue('91234567'),
    checkNumbers: jest.fn().mockResolvedValue({
      statusCode: 'S000',
      results: [{ noVoiceCall: false, noTextMessage: false, noFax: false }],
    }),
    isPhoneRecentlyVerified: jest.fn().mockReturnValue(true),
    cfg: { enabled: true, orgCode: 'O', eServiceId: 'E', privateKey: 'K' },
    logger: baseLogger,
    ...over,
  };
}

const input = { phone: '91234567', countryCode: '+65', campaignId: 'c1' };

beforeEach(() => svc._resetDncCheckCache());

describe('checkDncForForm — gates (no spend when a gate fails)', () => {
  it('Gate 1: DNC not ready → registered:false, no campaign lookup, no API call', async () => {
    const deps = mkDeps({ dncReady: jest.fn().mockReturnValue(false) });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.Campaign.findByPk).not.toHaveBeenCalled();
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });

  it('Gate 2a: missing campaignId → registered:false, no API call', async () => {
    const deps = mkDeps();
    const out = await svc.checkDncForForm({ phone: '91234567', countryCode: '+65' }, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });

  it('Gate 2b: campaign has NOT opted in (dncCheckAtSubmit !== true) → registered:false, no API call', async () => {
    const deps = mkDeps({
      Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', design_config: { dncCheckAtSubmit: false } }) },
    });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });

  it('Gate 2c: unknown campaign → registered:false', async () => {
    const deps = mkDeps({ Campaign: { findByPk: jest.fn().mockResolvedValue(null) } });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });

  it('Gate 3: non-SG number → registered:false, no API call', async () => {
    const deps = mkDeps({ formatDncNumber: jest.fn().mockReturnValue(null) });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });

  it('Gate 4: phone NOT recently OTP-verified → registered:false, no API call (oracle fix)', async () => {
    const deps = mkDeps({ isPhoneRecentlyVerified: jest.fn().mockReturnValue(false) });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });
});

describe('checkDncForForm — happy path', () => {
  it('all gates pass + registered (voice) → registered:true', async () => {
    const deps = mkDeps({
      checkNumbers: jest.fn().mockResolvedValue({ statusCode: 'S000', results: [{ noVoiceCall: true, noTextMessage: false, noFax: false }] }),
    });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: true });
    expect(deps.checkNumbers).toHaveBeenCalledTimes(1);
    expect(deps.checkNumbers.mock.calls[0][0]).toEqual(['91234567']);
  });

  it('all gates pass + clear → registered:false', async () => {
    const deps = mkDeps();
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).toHaveBeenCalledTimes(1);
  });

  it('registered on text only (voice clear) still counts as registered for the gate', async () => {
    const deps = mkDeps({
      checkNumbers: jest.fn().mockResolvedValue({ statusCode: 'S000', results: [{ noVoiceCall: false, noTextMessage: true, noFax: false }] }),
    });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: true });
  });
});

describe('checkDncForForm — per-number cache (no re-bill)', () => {
  it('a repeat check for the same number reuses the cached result (one API call total)', async () => {
    const deps = mkDeps({
      checkNumbers: jest.fn().mockResolvedValue({ statusCode: 'S000', results: [{ noVoiceCall: true, noTextMessage: false, noFax: false }] }),
    });
    const first = await svc.checkDncForForm(input, deps);
    const second = await svc.checkDncForForm(input, deps);
    expect(first).toEqual({ registered: true });
    expect(second).toEqual({ registered: true });
    expect(deps.checkNumbers).toHaveBeenCalledTimes(1); // second served from cache
  });

  it('a fail-open (non-S000) result is NOT cached → a later check retries', async () => {
    const fail = jest.fn().mockResolvedValue({ statusCode: 'S301', results: [] });
    const ok = jest.fn().mockResolvedValue({ statusCode: 'S000', results: [{ noVoiceCall: true }] });
    expect(await svc.checkDncForForm(input, mkDeps({ checkNumbers: fail }))).toEqual({ registered: false });
    // second call (different deps, same number) hits the API again because nothing was cached
    expect(await svc.checkDncForForm(input, mkDeps({ checkNumbers: ok }))).toEqual({ registered: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('checkDncForForm — fail-open', () => {
  it('over budget → registered:false', async () => {
    const deps = mkDeps({ checkNumbers: jest.fn().mockResolvedValue({ budgetExceeded: true, statusCode: null, results: [] }) });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
  });

  it('non-S000 status → registered:false', async () => {
    const deps = mkDeps({ checkNumbers: jest.fn().mockResolvedValue({ statusCode: 'S401', results: [] }) });
    expect(await svc.checkDncForForm(input, deps)).toEqual({ registered: false });
  });

  it('checkNumbers throws → registered:false', async () => {
    const deps = mkDeps({ checkNumbers: jest.fn().mockRejectedValue(new Error('proxy down')) });
    expect(await svc.checkDncForForm(input, deps)).toEqual({ registered: false });
  });

  it('Campaign lookup throws → registered:false (caught)', async () => {
    const deps = mkDeps({ Campaign: { findByPk: jest.fn().mockRejectedValue(new Error('db down')) } });
    expect(await svc.checkDncForForm(input, deps)).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });
});

describe('design_config v2 (Campaign Studio) — form.gates.dncCheck drives the opt-in', () => {
  const v2Doc = (dncCheck) => ({
    version: 2,
    form: { gates: { dncCheck }, fields: [] },
    distribution: { host: 'redeem' },
  });

  it('v2 doc with gates.dncCheck=true reaches the DNC API', async () => {
    const deps = mkDeps({
      Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', design_config: v2Doc(true) }) },
    });
    await svc.checkDncForForm(input, deps);
    expect(deps.checkNumbers).toHaveBeenCalled();
  });

  it('v2 doc with gates.dncCheck=false stays inert (no spend)', async () => {
    const deps = mkDeps({
      Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', design_config: v2Doc(false) }) },
    });
    const out = await svc.checkDncForForm(input, deps);
    expect(out).toEqual({ registered: false });
    expect(deps.checkNumbers).not.toHaveBeenCalled();
  });
});
