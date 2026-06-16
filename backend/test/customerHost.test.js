import {
  normalizeCustomerHostChoice,
  customerHostOrigin,
  CUSTOMER_HOST_CHOICES,
  DEFAULT_CUSTOMER_HOST_CHOICE,
} from '../src/utils/customerHost.js';

// Pure-function unit test — intentionally does NOT import ./setup.js, so it runs
// without a database (the enum clamp is the security boundary for host selection).
describe('normalizeCustomerHostChoice', () => {
  it("passes through the two valid choices", () => {
    expect(normalizeCustomerHostChoice('redeem')).toBe('redeem');
    expect(normalizeCustomerHostChoice('mktr')).toBe('mktr');
  });

  it('clamps anything else to redeem (never trusts a raw host string)', () => {
    for (const bad of [undefined, null, '', 'MKTR', 'mktr.sg', 'redeem.sg', 'https://evil.com', 0, {}, []]) {
      expect(normalizeCustomerHostChoice(bad)).toBe('redeem');
    }
  });

  it('exposes the choice set and default', () => {
    expect(CUSTOMER_HOST_CHOICES).toEqual(['redeem', 'mktr']);
    expect(DEFAULT_CUSTOMER_HOST_CHOICE).toBe('redeem');
  });
});

describe('customerHostOrigin', () => {
  const ORIGINAL = {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    MKTR_FRONTEND_URL: process.env.MKTR_FRONTEND_URL,
  };
  afterEach(() => {
    for (const key of ['PUBLIC_BASE_URL', 'MKTR_FRONTEND_URL']) {
      if (ORIGINAL[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL[key];
    }
  });

  it("'mktr' uses MKTR_FRONTEND_URL, else falls back to https://mktr.sg", () => {
    delete process.env.MKTR_FRONTEND_URL;
    expect(customerHostOrigin('mktr')).toBe('https://mktr.sg');
    process.env.MKTR_FRONTEND_URL = 'https://mktr.example';
    expect(customerHostOrigin('mktr')).toBe('https://mktr.example');
  });

  it("'redeem'/default/garbage uses PUBLIC_BASE_URL (today's behavior, unchanged)", () => {
    process.env.PUBLIC_BASE_URL = 'https://redeem.sg';
    expect(customerHostOrigin('redeem')).toBe('https://redeem.sg');
    expect(customerHostOrigin(undefined)).toBe('https://redeem.sg');
    expect(customerHostOrigin('evil.com')).toBe('https://redeem.sg');
  });
});
