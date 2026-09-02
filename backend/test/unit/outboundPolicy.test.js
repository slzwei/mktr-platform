import { jest } from '@jest/globals';

/**
 * Outbound policy — the negative paths are the point (plan Gate G1: "CI proves
 * non-allowlisted destinations cannot reach provider adapters").
 */

const ORIGINAL_ENV = { ...process.env };

let policy;
let bumped;
let unbumped;

async function loadPolicy(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  bumped = [];
  unbumped = [];
  policy = await import('../../src/services/outboundPolicy.js');
  return policy;
}

/** Counter stub so the unit test needs no database. */
function counterDeps(counts = {}) {
  const state = { ...counts };
  return {
    logger: { info: () => {}, warn: () => {} },
    bump: async (key) => {
      bumped.push(key);
      state[key] = (state[key] || 0) + 1;
      return { count: state[key], expiresAt: new Date(Date.now() + 3600_000) };
    },
    unbump: async (key) => {
      unbumped.push(key);
      state[key] = Math.max((state[key] || 0) - 1, 0);
    },
    _state: state,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('normalizePhone', () => {
  test('resolves every Singapore shape to one E.164 value', async () => {
    const { normalizePhone } = await loadPolicy();
    expect(normalizePhone('96989089')).toBe('+6596989089');
    expect(normalizePhone('+6596989089')).toBe('+6596989089');
    expect(normalizePhone('65 9698 9089')).toBe('+6596989089');
    expect(normalizePhone('+65-9698-9089')).toBe('+6596989089');
  });

  test('refuses anything it cannot resolve unambiguously', async () => {
    const { normalizePhone } = await loadPolicy();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('11234567')).toBeNull(); // not a 3/6/8/9 SG prefix
    expect(normalizePhone('2025550143')).toBeNull(); // bare US number, no '+'
  });
});

describe('production is untouched', () => {
  test('every rail is allowed and unenforced outside a sandbox', async () => {
    const { guardPhoneRail, guardEmailRail } = await loadPolicy({ DEPLOY_ENV: 'production' });
    const otp = await guardPhoneRail('otp', '+6591234567', counterDeps());
    expect(otp).toEqual({ allowed: true, enforced: false });
    const mail = await guardEmailRail('anyone@example.com', counterDeps());
    expect(mail).toEqual({ allowed: true, enforced: false });
    expect(bumped).toHaveLength(0);
  });
});

describe('sandbox denial paths', () => {
  const base = {
    DEPLOY_ENV: 'sandbox',
    SANDBOX_LIVE_OTP_ENABLED: 'true',
    SANDBOX_LIVE_DNC_ENABLED: 'true',
    SANDBOX_ALLOWED_PHONES: '+6596989089',
  };

  test('a rail with its kill switch off is refused before anything else', async () => {
    const { guardPhoneRail } = await loadPolicy({ ...base, SANDBOX_LIVE_OTP_ENABLED: 'false' });
    const d = await guardPhoneRail('otp', '+6596989089', counterDeps());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('rail_disabled');
    expect(bumped).toHaveLength(0); // no database touched
  });

  test('a non-allowlisted number is refused with no counter write', async () => {
    const { guardPhoneRail } = await loadPolicy(base);
    const d = await guardPhoneRail('otp', '+6591234567', counterDeps());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('not_allowlisted');
    expect(bumped).toHaveLength(0);
  });

  test('an empty allowlist denies everything', async () => {
    const { guardPhoneRail } = await loadPolicy({ ...base, SANDBOX_ALLOWED_PHONES: '' });
    const d = await guardPhoneRail('otp', '+6596989089', counterDeps());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('empty_allowlist');
  });

  test('an unparseable destination is refused', async () => {
    const { guardPhoneRail } = await loadPolicy(base);
    const d = await guardPhoneRail('otp', 'not-a-number', counterDeps());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('bad_destination');
  });

  test('a fixed-OTP seed number is denied even when allowlisted', async () => {
    const { guardPhoneRail, isDeniedPhone } = await loadPolicy({
      ...base,
      SANDBOX_ALLOWED_PHONES: '+6580000201,+6596989089',
    });
    expect(isDeniedPhone('+6580000201')).toBe(true);
    expect(isDeniedPhone('+6580000230')).toBe(true);
    expect(isDeniedPhone('+6599999999')).toBe(true);
    expect(isDeniedPhone('+6596989089')).toBe(false);
    const d = await guardPhoneRail('dnc', '+6580000201', counterDeps());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('blocked_destination');
    expect(bumped).toHaveLength(0);
  });

  test('the allowlist matches on the NORMALISED number, not the literal', async () => {
    const { guardPhoneRail } = await loadPolicy({ ...base, SANDBOX_ALLOWED_PHONES: '96989089' });
    const d = await guardPhoneRail('otp', '+65 9698 9089', counterDeps());
    expect(d.allowed).toBe(true);
  });
});

describe('durable budgets', () => {
  const base = {
    DEPLOY_ENV: 'sandbox',
    SANDBOX_LIVE_OTP_ENABLED: 'true',
    SANDBOX_ALLOWED_PHONES: '+6596989089',
    SANDBOX_OTP_PER_DEST_DAILY_CAP: '3',
    SANDBOX_OTP_DAILY_CAP: '10',
    SANDBOX_OTP_MONTHLY_CAP: '50',
  };

  test('allows up to the per-destination cap and then refuses', async () => {
    const { guardPhoneRail } = await loadPolicy(base);
    const deps = counterDeps();
    for (let i = 0; i < 3; i += 1) {
      const d = await guardPhoneRail('otp', '+6596989089', deps);
      expect(d.allowed).toBe(true);
    }
    const fourth = await guardPhoneRail('otp', '+6596989089', deps);
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe('per_destination_daily_cap');
  });

  test('a refused attempt hands every claim back', async () => {
    const { guardPhoneRail } = await loadPolicy({ ...base, SANDBOX_OTP_DAILY_CAP: '1' });
    const deps = counterDeps();
    const first = await guardPhoneRail('otp', '+6596989089', deps);
    expect(first.allowed).toBe(true);
    unbumped.length = 0;
    const second = await guardPhoneRail('otp', '+6596989089', deps);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('global_daily_cap');
    // Both the per-destination and the global claim are released.
    expect(unbumped).toHaveLength(2);
  });

  test('releasePhoneRail returns the budget of a send that never happened', async () => {
    const { guardPhoneRail, releasePhoneRail } = await loadPolicy(base);
    const deps = counterDeps();
    const decision = await guardPhoneRail('otp', '+6596989089', deps);
    expect(decision.allowed).toBe(true);
    unbumped.length = 0;
    await releasePhoneRail(decision, deps);
    expect(unbumped).toHaveLength(3); // per-destination, daily, monthly
  });

  test('the monthly ceiling stops the rail even with daily headroom', async () => {
    const { guardPhoneRail } = await loadPolicy({
      ...base,
      SANDBOX_OTP_PER_DEST_DAILY_CAP: '99',
      SANDBOX_OTP_DAILY_CAP: '99',
      SANDBOX_OTP_MONTHLY_CAP: '2',
    });
    const deps = counterDeps();
    expect((await guardPhoneRail('otp', '+6596989089', deps)).allowed).toBe(true);
    expect((await guardPhoneRail('otp', '+6596989089', deps)).allowed).toBe(true);
    const third = await guardPhoneRail('otp', '+6596989089', deps);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe('global_monthly_cap');
  });
});

describe('email rail', () => {
  test('refuses a non-allowlisted recipient and the synthetic seed domain', async () => {
    const { guardEmailRail } = await loadPolicy({
      DEPLOY_ENV: 'sandbox',
      SANDBOX_LIVE_EMAIL_ENABLED: 'true',
      SANDBOX_ALLOWED_EMAILS: 'approved@example.com',
    });
    expect((await guardEmailRail('someone@else.com', counterDeps())).reason).toBe('not_allowlisted');
    expect((await guardEmailRail('sandbox.admin@example.invalid', counterDeps())).reason).toBe('blocked_destination');
    expect((await guardEmailRail('APPROVED@Example.com ', counterDeps())).allowed).toBe(true);
  });
});
