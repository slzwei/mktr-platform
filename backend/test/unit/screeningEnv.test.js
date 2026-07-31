/**
 * publicScreeningCallback — what an UNAUTHENTICATED campaign page is allowed to
 * promise about the AI screening call-back. Every guard here exists so the
 * success page can never print a call that will not come.
 */
import {
  publicScreeningCallback,
  screeningFromNumber,
  screeningDialDelaySeconds,
  DEFAULT_DIAL_DELAY_SECONDS,
} from '../../src/utils/screeningEnv.js';

const GATE_ON = { screeningCallAtSubmit: true };
const V2_GATE_ON = { version: 2, form: { gates: { screeningCall: true } } };

// 03:00 UTC = 11:00 SGT (inside 10:00-20:00); 16:00 UTC = 00:00 SGT (outside).
const IN_WINDOW = new Date('2026-07-30T03:00:00Z');
const OUT_OF_WINDOW = new Date('2026-07-30T16:00:00Z');

const ENV_KEYS = [
  'RETELL_SCREENING_ENABLED', 'RETELL_SCREENING_AGENT_ID', 'RETELL_SCREENING_FROM_NUMBER',
  'RETELL_API_KEY', 'SCREENING_DRY_RUN', 'SCREENING_CALL_WINDOW', 'SCREENING_DIAL_DELAY_SECONDS',
];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.RETELL_SCREENING_ENABLED = 'true';
  process.env.RETELL_SCREENING_AGENT_ID = 'agent_58b8bbdfb8920ce49bb2750b86';
  process.env.RETELL_SCREENING_FROM_NUMBER = '+6562773210';
  process.env.RETELL_API_KEY = 'key_test';
  delete process.env.SCREENING_DRY_RUN;
  delete process.env.SCREENING_CALL_WINDOW;
  delete process.env.SCREENING_DIAL_DELAY_SECONDS;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('screeningDialDelaySeconds', () => {
  it('defaults to 60s and clamps to [0, 900]', () => {
    expect(screeningDialDelaySeconds()).toBe(DEFAULT_DIAL_DELAY_SECONDS);
    process.env.SCREENING_DIAL_DELAY_SECONDS = '0';
    expect(screeningDialDelaySeconds()).toBe(0);
    process.env.SCREENING_DIAL_DELAY_SECONDS = '-30';
    expect(screeningDialDelaySeconds()).toBe(0);
    process.env.SCREENING_DIAL_DELAY_SECONDS = '99999';
    expect(screeningDialDelaySeconds()).toBe(900);
    process.env.SCREENING_DIAL_DELAY_SECONDS = 'soon';
    expect(screeningDialDelaySeconds()).toBe(DEFAULT_DIAL_DELAY_SECONDS);
  });
});

describe('screeningFromNumber', () => {
  it('clamps to E.164 — a malformed caller id is no caller id', () => {
    expect(screeningFromNumber()).toBe('+6562773210');
    process.env.RETELL_SCREENING_FROM_NUMBER = '62773210';
    expect(screeningFromNumber()).toBeNull();
  });
});

describe('publicScreeningCallback', () => {
  it('emits the caller id + eta for a gated campaign, v1 and v2 docs alike', () => {
    for (const doc of [GATE_ON, V2_GATE_ON]) {
      expect(publicScreeningCallback(doc, IN_WINDOW)).toEqual({
        number: '+6562773210',
        etaMinutes: 1,
        callWindow: '10:00-20:00',
        windowOpen: true,
      });
    }
  });

  it('reports the window CLOSED outside calling hours, so the page can stop promising "a minute"', () => {
    expect(publicScreeningCallback(GATE_ON, OUT_OF_WINDOW).windowOpen).toBe(false);
  });

  it('rounds the eta up from the configured delay', () => {
    process.env.SCREENING_DIAL_DELAY_SECONDS = '150';
    expect(publicScreeningCallback(GATE_ON, IN_WINDOW).etaMinutes).toBe(3);
    // A sub-minute delay still reads as "about a minute", never "0".
    process.env.SCREENING_DIAL_DELAY_SECONDS = '5';
    expect(publicScreeningCallback(GATE_ON, IN_WINDOW).etaMinutes).toBe(1);
  });

  it('says nothing when the campaign gate is off', () => {
    expect(publicScreeningCallback({}, IN_WINDOW)).toBeNull();
    expect(publicScreeningCallback({ screeningCallAtSubmit: false }, IN_WINDOW)).toBeNull();
    expect(publicScreeningCallback(null, IN_WINDOW)).toBeNull();
  });

  it('says nothing when the deployment cannot actually dial', () => {
    const cases = {
      RETELL_SCREENING_ENABLED: 'false',
      RETELL_SCREENING_AGENT_ID: 'not-an-agent',
      RETELL_SCREENING_FROM_NUMBER: '62773210',
      RETELL_API_KEY: '',
      SCREENING_DRY_RUN: 'true',
    };
    for (const [key, value] of Object.entries(cases)) {
      const prev = process.env[key];
      process.env[key] = value;
      expect(publicScreeningCallback(GATE_ON, IN_WINDOW)).toBeNull();
      process.env[key] = prev;
    }
    // Sanity: the harness itself is a promising configuration.
    expect(publicScreeningCallback(GATE_ON, IN_WINDOW)).not.toBeNull();
  });
});
