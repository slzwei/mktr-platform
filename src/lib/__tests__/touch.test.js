import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBootSessionId, touchGatesPass, beaconTouch, sessionSubmitHeaders } from '../touch.js';

const BOOT_KEY = '_mktr_sid_boot';
const SID_RE = /^[a-f0-9]{32}$/;

function stubTouchOn() {
  vi.stubEnv('VITE_TOUCH_ENABLED', 'true');
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('PROD', true);
  vi.stubEnv('DEV', false);
}

function setPath(pathname, search = '') {
  window.history.replaceState({}, '', pathname + search);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  setPath('/explore');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete navigator.locks;
});

describe('getBootSessionId — the §4.2 boot id', () => {
  it('mints a 32-hex id with a 90d expiry and reuses it', async () => {
    const first = await getBootSessionId();
    expect(first).toMatch(SID_RE);
    const stored = JSON.parse(localStorage.getItem(BOOT_KEY));
    expect(stored.id).toBe(first);
    expect(stored.expiresAt).toBeGreaterThan(Date.now() + 89 * 24 * 3600 * 1000);
    expect(await getBootSessionId()).toBe(first);
  });

  it('regenerates past expiry and on a malformed record', async () => {
    localStorage.setItem(BOOT_KEY, JSON.stringify({ id: 'a'.repeat(32), expiresAt: Date.now() - 1000 }));
    const regen = await getBootSessionId();
    expect(regen).toMatch(SID_RE);
    expect(regen).not.toBe('a'.repeat(32));

    localStorage.setItem(BOOT_KEY, JSON.stringify({ id: 'NOT-HEX', expiresAt: Date.now() + 1000000 }));
    expect(await getBootSessionId()).toMatch(SID_RE);
  });

  it('serializes creation through the Web Lock and re-reads inside it (other tab wins)', async () => {
    const winner = { id: 'b'.repeat(32), expiresAt: Date.now() + 1000000 };
    const request = vi.fn(async (name, fn) => {
      expect(name).toBe('mktr_sid_boot');
      // Simulate the OTHER tab writing while we waited on the lock.
      localStorage.setItem(BOOT_KEY, JSON.stringify(winner));
      return fn();
    });
    navigator.locks = { request };
    const id = await getBootSessionId();
    expect(request).toHaveBeenCalledTimes(1);
    expect(id).toBe(winner.id); // the in-lock re-read adopted the winner
  });

  it('falls back to last-writer-wins without Web Locks (documented best-effort)', async () => {
    delete navigator.locks;
    expect(await getBootSessionId()).toMatch(SID_RE);
  });
});

describe('touchGatesPass — the §4.4 gates', () => {
  it('requires the literal "true" flag', () => {
    vi.stubEnv('VITE_TOUCH_ENABLED', '1');
    vi.stubEnv('PROD', true);
    expect(touchGatesPass({ pathname: '/explore', search: '' })).toBe(false);
    stubTouchOn();
    expect(touchGatesPass({ pathname: '/explore', search: '' })).toBe(true);
  });

  it('blocks dev builds without the dev opt-in', () => {
    vi.stubEnv('VITE_TOUCH_ENABLED', 'true');
    vi.stubEnv('PROD', false);
    expect(touchGatesPass({ pathname: '/explore', search: '' })).toBe(false);
    vi.stubEnv('VITE_TOUCH_DEV_MODE', '1');
    expect(touchGatesPass({ pathname: '/explore', search: '' })).toBe(true);
  });

  it('suppresses preview surfaces and test-data campaigns via the shared pixelSuppression gate', () => {
    stubTouchOn();
    expect(touchGatesPass({ pathname: '/explore', search: '?preview=true' })).toBe(false);
    expect(touchGatesPass({ pathname: '/preview/some-proto', search: '' })).toBe(false);
    expect(touchGatesPass({ pathname: '/leadcapture', search: '', campaign: { is_test_data: true } })).toBe(false);
  });
});

describe('beaconTouch — lossy, throttled, keepalive', () => {
  it('POSTs with keepalive, credentials, the X-Session-Id boot header, and whitelisted params only', async () => {
    stubTouchOn();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setPath('/explore', '?utm_source=fb&fbclid=abc123&token=SECRET&junk=1');

    await beaconTouch({ surface: 'browse' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/analytics\/touch$/);
    expect(opts.keepalive).toBe(true);
    expect(opts.credentials).toBe('include');
    expect(opts.headers['X-Session-Id']).toMatch(SID_RE);
    const body = JSON.parse(opts.body);
    expect(body.surface).toBe('browse');
    expect(body.path).toBe('/explore?utm_source=fb&fbclid=abc123'); // token/junk stripped
    expect(body.utm_source).toBe('fb');
    expect(body.fbclid).toBe('abc123');
    expect(body.token).toBeUndefined();
  });

  it('throttles repeat beacons for the same URL within 30 minutes', async () => {
    stubTouchOn();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await beaconTouch({ surface: 'browse' });
    await beaconTouch({ surface: 'browse' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setPath('/winners');
    await beaconTouch({ surface: 'browse' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // a different URL is a different touch
  });

  it('is silent when the gates fail and swallows network errors', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await beaconTouch({ surface: 'browse' }); // flag off
    expect(fetchMock).not.toHaveBeenCalled();

    stubTouchOn();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(beaconTouch({ surface: 'browse' })).resolves.toBeUndefined();
  });
});

describe('sessionSubmitHeaders — the submit-side boot header (§4.2)', () => {
  it('is EMPTY until the touch flag flips (backend CORS must accept the header first)', async () => {
    expect(await sessionSubmitHeaders()).toEqual({});
    stubTouchOn();
    const headers = await sessionSubmitHeaders();
    expect(headers['X-Session-Id']).toMatch(SID_RE);
  });
});
