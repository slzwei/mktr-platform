import { describe, it, expect } from 'vitest';
import { assertRsvpSurfaceEnv, AD_TECH_ENV_KEYS, RSVP_HTML } from '../../../scripts/rsvpSurfaceGuard.mjs';

describe('rsvp surface build guard', () => {
  it('passes a clean redeem-brand env', () => {
    expect(assertRsvpSurfaceEnv({ VITE_BRAND: 'redeem', VITE_SURFACE: 'rsvp', VITE_RSVP_API_BASE: 'https://api.mktr.sg/api' })).toBe(true);
  });

  it.each(AD_TECH_ENV_KEYS)('refuses to build with %s set', (key) => {
    expect(() => assertRsvpSurfaceEnv({ VITE_BRAND: 'redeem', [key]: '123' })).toThrow(new RegExp(key));
  });

  it('refuses the operator brand (an inherited default) and an unset brand', () => {
    expect(() => assertRsvpSurfaceEnv({ VITE_BRAND: 'mktr' })).toThrow(/VITE_BRAND=redeem/);
    expect(() => assertRsvpSurfaceEnv({})).toThrow(/VITE_BRAND=redeem/);
  });

  it('ships its own HTML identity', () => {
    expect(RSVP_HTML.VITE_CANONICAL_BASE).toBe('https://rsvp.redeem.sg/');
    expect(RSVP_HTML.VITE_PAGE_TITLE).toBe('RSVP');
  });
});
