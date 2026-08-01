import { describe, it, expect } from 'vitest';
import {
  formatCallerId,
  formatWindowOpensLabel,
  screeningCallbackLine,
} from '../screeningCallback';

describe('formatCallerId', () => {
  it('spaces an SG landline/mobile, passes anything else through untouched', () => {
    expect(formatCallerId('+6562773210')).toBe('+65 6277 3210');
    expect(formatCallerId('+6591234567')).toBe('+65 9123 4567');
    expect(formatCallerId('+14155550123')).toBe('+14155550123');
    expect(formatCallerId('')).toBe('');
  });
});

describe('formatWindowOpensLabel', () => {
  it('reads the window START in 12-hour form', () => {
    expect(formatWindowOpensLabel('10:00-20:00')).toBe('10am');
    expect(formatWindowOpensLabel('09:30-18:00')).toBe('9.30am');
    expect(formatWindowOpensLabel('13:00-20:00')).toBe('1pm');
    expect(formatWindowOpensLabel('00:00-23:59')).toBe('12am');
    expect(formatWindowOpensLabel('12:00-20:00')).toBe('12pm');
  });
  it('returns null for anything unparseable, so the copy falls back', () => {
    expect(formatWindowOpensLabel('')).toBeNull();
    expect(formatWindowOpensLabel('all day')).toBeNull();
    expect(formatWindowOpensLabel(undefined)).toBeNull();
  });
});

describe('screeningCallbackLine', () => {
  const base = { number: '+6562773210', etaMinutes: 1, callWindow: '10:00-20:00', windowOpen: true };

  it('is null when the server said nothing — absence must never become a promise', () => {
    expect(screeningCallbackLine(null)).toBeNull();
    expect(screeningCallbackLine(undefined)).toBeNull();
    expect(screeningCallbackLine('soon')).toBeNull();
  });

  it('names the caller and the wait inside the window', () => {
    expect(screeningCallbackLine(base)).toBe(
      'An automated call from +65 6277 3210 will ring you in about a minute to confirm a few details — please pick up.'
    );
  });

  it('pluralises a longer configured delay', () => {
    expect(screeningCallbackLine({ ...base, etaMinutes: 5 })).toMatch(/in about 5 minutes/);
  });

  it('promises the window open, not a minute, when the lines are shut', () => {
    expect(screeningCallbackLine({ ...base, windowOpen: false })).toBe(
      'An automated call from +65 6277 3210 will ring you after 10am to confirm a few details — it takes about a minute.'
    );
  });

  it('falls back to "once our lines open" when the window is unreadable', () => {
    expect(screeningCallbackLine({ ...base, windowOpen: false, callWindow: null })).toMatch(
      /will ring you once our lines open/
    );
  });

  it('reads naturally with no caller id (Studio preview has no env access)', () => {
    expect(screeningCallbackLine({ ...base, number: null })).toBe(
      'An automated call will ring you in about a minute to confirm a few details — please pick up.'
    );
  });
});
