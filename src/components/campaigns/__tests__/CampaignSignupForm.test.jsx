import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import { apiClient } from '@/api/client';

const baseCampaign = (designOverrides = {}) => ({
  id: 'camp-1',
  name: 'Test Campaign',
  design_config: { ...designOverrides },
});

function renderForm(props = {}) {
  const onSubmit = vi.fn();
  const utils = render(
    <CampaignSignupForm
      themeColor="#D17029"
      formHeadline="Get Started"
      formSubheadline="Fill in your details"
      campaignId="camp-1"
      campaign={baseCampaign(props.design)}
      onSubmit={onSubmit}
      ctaLabel="Submit Now"
      {...props}
    />
  );
  return { ...utils, onSubmit };
}

describe('CampaignSignupForm — phone is always required/visible', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the phone field even when stored visibleFields.phone === false', () => {
    renderForm({ design: { visibleFields: { phone: false } } });
    // Phone input is present regardless of the stale stored config.
    expect(screen.getByPlaceholderText('9123 4567')).toBeInTheDocument();
  });

  it('keeps submit OTP-gated (disabled) when phone is unverified, even with phone:false stored', () => {
    renderForm({ design: { visibleFields: { phone: false } } });
    const submit = screen.getByRole('button', { name: 'Submit Now' });
    // submitDisabled includes otpState !== 'verified' — no brittle config can bypass it.
    expect(submit).toBeDisabled();
  });
});

describe('CampaignSignupForm — responsive combined rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wraps a two-column row in .lc-field-row and leaves single-field rows plain', () => {
    const { container } = renderForm({
      design: {
        fieldOrder: [
          { id: 'r0', columns: ['name'] },
          { id: 'r1', columns: ['dob', 'postal_code'] },
        ],
      },
    });
    const rows = container.querySelectorAll('.lc-field-row');
    expect(rows).toHaveLength(1);
    // The combined row contains both fields.
    expect(rows[0].querySelector('#dob')).toBeTruthy();
    expect(rows[0].querySelector('#postal_code')).toBeTruthy();
    // The single-field (name) row is NOT wrapped in lc-field-row.
    const nameInput = container.querySelector('#name');
    expect(nameInput.closest('.lc-field-row')).toBeNull();
  });
});

describe('CampaignSignupForm — previewMode sends no network traffic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call /verify/send when Verify is clicked in previewMode', async () => {
    const user = userEvent.setup();
    renderForm({ previewMode: true });

    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    // Simulated send reveals the inline OTP panel without any network call.
    expect(await screen.findByPlaceholderText('6-digit code')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('runs the full preview flow without calling apiClient or the parent onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({ previewMode: true });

    await user.type(screen.getByPlaceholderText('John Tan'), 'Jane Tan');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com');
    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    const otpInput = await screen.findByPlaceholderText('6-digit code');
    await user.type(otpInput, '123456'); // any 6 digits pass in preview

    // Phone becomes Verified (simulated) — wait out the success-tick timeout.
    await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument(), { timeout: 2500 });

    // Tick the required consent checkbox (hidden input → fireEvent bypasses pointer-events).
    fireEvent.click(document.getElementById('consent_terms'));

    const submit = screen.getByRole('button', { name: 'Submit Now' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    // Preview short-circuits: neutral notice, no parent submit, no network at all.
    expect(await screen.findByText('Preview — your details were not submitted.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
