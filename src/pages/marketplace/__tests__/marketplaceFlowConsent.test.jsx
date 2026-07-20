import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));
vi.mock('@/api/marketplace', () => ({ getMarketplaceCampaign: vi.fn() }));
vi.mock('@/lib/metaPixel', () => ({
  shouldTrack: () => false, generateEventId: () => 'ev-1',
  captureFbcFromUrl: () => {}, captureUtmsFromUrl: () => {},
  readFbc: () => undefined, readFbp: () => undefined, readUtms: () => null,
  ensureFbp: () => {}, initPixel: () => {}, trackEvent: () => {}, trackLead: () => {},
  trackCustomEvent: () => {},
}));
vi.mock('@/lib/tiktokPixel', () => ({
  shouldTrackTikTok: () => false, captureTtclidFromUrl: () => {},
  readTtclid: () => null, readTtp: () => null, initTikTokPixel: () => {},
  trackTikTokViewContent: () => {}, trackTikTokEvent: () => {}, trackTikTokLead: () => {},
}));
vi.mock('@/lib/pixelSession', () => ({
  getOrCreateVcState: () => ({ eventId: 'vc-1', firedMeta: true, firedTiktok: true }),
  markVcFired: () => {},
}));
vi.mock('../MarketplaceLayout', () => ({ default: ({ children }) => <div>{children}</div> }));

import MarketplaceFlow from '../MarketplaceFlow';
import { apiClient } from '@/api/client';
import { getMarketplaceCampaign } from '@/api/marketplace';
import { CONSENT_COPY_VERSION } from '@/lib/consentCopy';

/**
 * mktui behavioral proof: the marketplace consent step IS the agree-all block
 * — same copy source as the main funnel, all-required-to-submit, derived wire
 * flags, DNC step interaction preserved.
 */

const baseCampaign = (dcOverrides = {}) => ({
  id: 'camp-9',
  name: 'Trial Class',
  status: 'active',
  design_config: {
    // Lean details step: only the always-on trio.
    visibleFields: { dob: false, postal_code: false },
    requiredFields: {},
    fieldOrder: ['name', 'phone', 'email'],
    termsContent: '<p>The terms.</p>',
    ...dcOverrides,
  },
  ops: { partner: { name: 'Bright Minds', locations: [] } },
});

function mockApi({ dncRegistered = false } = {}) {
  apiClient.get.mockResolvedValue({});
  apiClient.post.mockImplementation((url) => {
    if (url === '/verify/send') return Promise.resolve({ success: true });
    if (url === '/verify/check') return Promise.resolve({ success: true, data: { verified: true } });
    if (url === '/dnc/check') return Promise.resolve({ success: true, data: { registered: dncRegistered } });
    if (url === '/prospects') return Promise.resolve({ success: true, data: { prospect: { id: 'p-1' } } });
    return Promise.resolve({ success: true });
  });
}

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={['/flow/trial-class']}>
      <Routes>
        <Route path="/flow/:slug" element={<MarketplaceFlow />} />
      </Routes>
    </MemoryRouter>
  );
}

async function driveToConsentStep(user) {
  await user.type(await screen.findByPlaceholderText('John Tan'), 'Jane Tan');
  await user.type(screen.getByPlaceholderText('8-digit SG mobile'), '91234567');
  await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('button', { name: /Send code via/ }));
  await user.type(await screen.findByPlaceholderText('••••••'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByText('Number verified');
}

beforeAll(() => {
  window.scrollTo = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarketplaceFlow — agree-all consent step (mktui)', () => {
  it('base campaign: block renders 2 clauses, submit locked until the single tick, derived flags on the wire', async () => {
    const user = userEvent.setup();
    getMarketplaceCampaign.mockResolvedValue(baseCampaign());
    mockApi();
    renderFlow();

    await driveToConsentStep(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // The agree-all block, from the shared twin copy.
    expect(await screen.findByText('One agreement — read once')).toBeInTheDocument();
    expect(screen.getByText('Contact from Redeem — this offer and future ones.')).toBeInTheDocument();
    expect(screen.getByText("This campaign's terms.")).toBeInTheDocument();
    expect(screen.queryByText("Sharing with this campaign's sponsor.")).toBeNull();

    // All-required-to-submit: locked + helper until the tick.
    const confirm = screen.getByRole('button', { name: 'Confirm redemption' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/You'll need to agree to the above to submit\./)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /I agree to all of the above\./ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await screen.findByText('Redemption confirmed');
    const prospectCall = apiClient.post.mock.calls.find(([url]) => url === '/prospects');
    expect(prospectCall[1]).toEqual(
      expect.objectContaining({
        consent_contact: true,
        consent_terms: true,
        consent_third_party: false,
        consent_copy_version: CONSENT_COPY_VERSION,
      })
    );
  });

  it('sponsored campaign: disclosure clause + named sponsor line render; third-party flag goes true', async () => {
    const user = userEvent.setup();
    getMarketplaceCampaign.mockResolvedValue(baseCampaign({ sponsor: { name: 'Acme FA' } }));
    mockApi();
    renderFlow();

    await driveToConsentStep(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText("Sharing with this campaign's sponsor.")).toBeInTheDocument();
    expect(screen.getByText('Sponsored by Acme FA.')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /I agree to all of the above\./ }));
    await user.click(screen.getByRole('button', { name: 'Confirm redemption' }));

    await screen.findByText('Redemption confirmed');
    const prospectCall = apiClient.post.mock.calls.find(([url]) => url === '/prospects');
    expect(prospectCall[1]).toEqual(expect.objectContaining({ consent_third_party: true }));
  });

  it('name-less sponsor object falls back to the base variant (§9.5-1 fail-closed)', async () => {
    const user = userEvent.setup();
    getMarketplaceCampaign.mockResolvedValue(baseCampaign({ sponsor: { disclosure: 'Sponsored by someone' } }));
    mockApi();
    renderFlow();

    await driveToConsentStep(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByText('One agreement — read once');
    expect(screen.queryByText("Sharing with this campaign's sponsor.")).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: /I agree to all of the above\./ }));
    await user.click(screen.getByRole('button', { name: 'Confirm redemption' }));
    await screen.findByText('Redemption confirmed');
    const prospectCall = apiClient.post.mock.calls.find(([url]) => url === '/prospects');
    expect(prospectCall[1]).toEqual(expect.objectContaining({ consent_third_party: false }));
  });

  it('DNC-registered number: the separate DNC step still gates BEFORE the agree-all step (both required)', async () => {
    const user = userEvent.setup();
    getMarketplaceCampaign.mockResolvedValue(baseCampaign({ dncCheckAtSubmit: true }));
    mockApi({ dncRegistered: true });
    renderFlow();

    await driveToConsentStep(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // DNC step first — its own explicit act, untouched by agree-all.
    expect(await screen.findByText(/your number is on the Do-Not-Call registry/)).toBeInTheDocument();
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /even though it is listed on the DNC registry/ }));
    expect(cont).toBeEnabled();
    await user.click(cont);

    // Then the agree-all step, still all-required.
    expect(await screen.findByText('One agreement — read once')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm redemption' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I agree to all of the above\./ }));
    await user.click(screen.getByRole('button', { name: 'Confirm redemption' }));

    await screen.findByText('Redemption confirmed');
    const prospectCall = apiClient.post.mock.calls.find(([url]) => url === '/prospects');
    expect(prospectCall[1]).toEqual(
      expect.objectContaining({ consent_contact: true, consent_terms: true, consent_dnc: true })
    );
  });
});
