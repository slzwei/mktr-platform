/**
 * P2-15 regression: a screen-reader user is told WHY submit was blocked.
 *
 * Both PUBLIC lead-capture funnels rendered validation errors in a plain
 * <div>/<span className="rm-err"> — no role="alert", no aria-live, no
 * aria-invalid, and nothing tying the message to the field it is about. So a
 * failed validation was a silent event: the form simply did not advance, and
 * the reason existed only as pixels (WCAG 3.3.1 / 4.1.3).
 *
 * These assert the announcement contract on both surfaces. The visual design is
 * unchanged — nothing here touches styling.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));
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
vi.mock('@/pages/marketplace/MarketplaceLayout', () => ({ default: ({ children }) => <div>{children}</div> }));

import { MemoryRouter, Route, Routes } from 'react-router-dom';

import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import MarketplaceFlow from '@/pages/marketplace/MarketplaceFlow';
import { apiClient } from '@/api/client';
import { getMarketplaceCampaign } from '@/api/marketplace';

const campaign = { id: 'camp-1', name: 'Test Campaign', design_config: {} };

const renderForm = () => render(
  <CampaignSignupForm
    themeColor="#D17029"
    formHeadline="Get Started"
    formSubheadline="Fill in your details"
    campaignId="camp-1"
    campaign={campaign}
    onSubmit={vi.fn()}
    ctaLabel="Submit Now"
  />
);

const marketplaceCampaign = {
  id: 'camp-9', name: 'Trial Class', status: 'active',
  design_config: {
    visibleFields: { dob: false, postal_code: false },
    requiredFields: {},
    fieldOrder: ['name', 'phone', 'email'],
    termsContent: '<p>The terms.</p>',
  },
  ops: { partner: { name: 'Bright Minds', locations: [] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
});

describe('CampaignSignupForm — validation errors are announced', () => {
  /**
   * Drive the CLIENT-SIDE failure path so the assertion is about the
   * announcement, not about how the OTP endpoint behaves. 8 digits (the Verify
   * button is disabled below that) with a leading 1, which no SG rule accepts.
   */
  async function triggerPhoneError() {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText('9123 4567'), '11234567');
    await user.click(screen.getByRole('button', { name: /verify/i }));
  }

  it('renders the form-level error in a live alert region', async () => {
    await triggerPhoneError();

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent.trim().length).toBeGreaterThan(0);
    expect(alert.textContent).toMatch(/must start with|singapore mobile/i);
  });

  it('marks the phone input invalid and points it at the message', async () => {
    await triggerPhoneError();

    const alert = await screen.findByRole('alert');
    const phone = document.getElementById('phone');

    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-describedby')).toBe(alert.id);
    expect(alert.id).toBeTruthy();
  });

  it('leaves a valid form silent — no alert, no aria-invalid', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');

    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(document.getElementById('phone').getAttribute('aria-invalid')).toBeNull();
    });
  });
});

/**
 * The marketplace funnel had the same gap in a different shape: a per-field
 * <span className="rm-err"> with no role and no link back to its input.
 */
describe('MarketplaceFlow — per-field errors are announced', () => {
  it('gives each field error an alert role and ties it to its input', async () => {
    const user = userEvent.setup();
    getMarketplaceCampaign.mockResolvedValue(marketplaceCampaign);
    apiClient.get.mockResolvedValue({});
    apiClient.post.mockResolvedValue({ success: true });

    render(
      <MemoryRouter initialEntries={['/flow/trial-class']}>
        <Routes>
          <Route path="/flow/:slug" element={<MarketplaceFlow />} />
        </Routes>
      </MemoryRouter>
    );

    // Advance with an invalid phone so the details step reports errors.
    await user.type(await screen.findByPlaceholderText('John Tan'), 'Jane Tan');
    await user.type(screen.getByPlaceholderText('8-digit SG mobile'), '11234567');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const phone = document.querySelector('input[name="phone"]');
    await waitFor(() => expect(phone.getAttribute('aria-invalid')).toBe('true'));

    const describedBy = phone.getAttribute('aria-describedby');
    expect(describedBy).toBe('rm-err-phone');

    const message = document.getElementById(describedBy);
    expect(message).toBeTruthy();
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toMatch(/singapore mobile/i);
  });

  it('leaves valid fields unmarked', async () => {
    const user = userEvent.setup();
    getMarketplaceCampaign.mockResolvedValue(marketplaceCampaign);
    apiClient.get.mockResolvedValue({});
    apiClient.post.mockResolvedValue({ success: true });

    render(
      <MemoryRouter initialEntries={['/flow/trial-class']}>
        <Routes>
          <Route path="/flow/:slug" element={<MarketplaceFlow />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByPlaceholderText('John Tan');
    const phone = document.querySelector('input[name="phone"]');

    expect(phone.getAttribute('aria-invalid')).toBeNull();
    expect(phone.getAttribute('aria-describedby')).toBeNull();
  });
});
