import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import AdRollRouteTracker from '../AdRollRouteTracker';
import { __resetAdRollStateForTests } from '@/lib/adroll';

const ADV_ID = 'XWJKUPH2LRC4LG4ZVFR4MS';
const PIX_ID = 'Q5WESFHM2JDHPIDHKY3DBT';
const ROUNDTRIP_SELECTOR = 'script[src*="s.adroll.com/j/"]';

function installStub() {
  window.adroll_adv_id = ADV_ID;
  window.adroll_pix_id = PIX_ID;
  window.adroll = [];
  window.adroll.track = vi.fn();
  return window.adroll.track;
}

/** Navigates once on mount so a client-side route change can be asserted. */
function NavigateOnMount({ to }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

function renderAt(initialPath, extra = null) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdRollRouteTracker />
      <Routes>
        <Route path="*" element={extra} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AdRollRouteTracker', () => {
  let track;

  beforeEach(() => {
    __resetAdRollStateForTests();
    document.querySelectorAll(ROUNDTRIP_SELECTOR).forEach((s) => s.remove());
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_ADROLL_ADV_ID', ADV_ID);
    vi.stubEnv('VITE_ADROLL_PIX_ID', PIX_ID);
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    track = installStub();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.adroll;
    delete window.adroll_adv_id;
    delete window.adroll_pix_id;
    document.querySelectorAll(ROUNDTRIP_SELECTOR).forEach((s) => s.remove());
  });

  it('injects the SDK and fires a pageView on a browse surface', () => {
    renderAt('/explore');
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(1);
    expect(track).toHaveBeenCalledWith('pageView');
  });

  it('fires again on a client-side route change (the SPA has no full reloads)', () => {
    renderAt('/explore', <NavigateOnMount to="/how-it-works" />);
    expect(track).toHaveBeenCalledTimes(2);
    // Still one script tag — only the pageView repeats.
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(1);
  });

  it('stays out of the campaign funnel — those pages fire it themselves', () => {
    renderAt('/offers/tokyo-draw');
    expect(track).not.toHaveBeenCalled();
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(0);
  });

  it('never fires on internal or token-bearing routes', () => {
    for (const path of ['/AdminDashboard', '/redeem-ops/partners', '/r/sometoken', '/callback?t=x']) {
      renderAt(path);
    }
    expect(track).not.toHaveBeenCalled();
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(0);
  });

  it('stays dark when the build carries no AdRoll ids', () => {
    vi.stubEnv('VITE_ADROLL_ADV_ID', '');
    vi.stubEnv('VITE_ADROLL_PIX_ID', '');
    renderAt('/explore');
    expect(track).not.toHaveBeenCalled();
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(0);
  });
});
