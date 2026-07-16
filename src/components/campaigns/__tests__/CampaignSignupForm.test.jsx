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
    // The panel now plays a brief success + collapse animation before flipping to
    // 'verified' (which enables submit), so allow more than the 1s default.
    await waitFor(() => expect(submit).toBeEnabled(), { timeout: 2500 });
    await user.click(submit);

    // Preview short-circuits: neutral notice, no parent submit, no network at all.
    expect(await screen.findByText('Preview — your details were not submitted.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('CampaignSignupForm — SG/PR eligibility gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the form directly when sgPrOnly is off (default)', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
    expect(screen.queryByText(/Singapore Citizen or Permanent Resident/i)).toBeNull();
  });

  it('gates the form behind a Yes/No screening question when sgPrOnly is on', () => {
    renderForm({ design: { sgPrOnly: true } });
    expect(screen.getByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
    // Form stays hidden until they answer Yes.
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Yes, I am' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('reveals the form after answering Yes', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true } });
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    expect(await screen.findByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
    expect(screen.queryByText('Are you a Singapore Citizen or Permanent Resident?')).toBeNull();
  });

  it('blocks the form with an ineligible message after answering No, and is reversible', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true } });
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(await screen.findByText(/only open to Singapore Citizens/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
    // Mis-tap recovery: back to the screening question.
    await user.click(screen.getByRole('button', { name: /picked the wrong option/i }));
    expect(await screen.findByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
  });

  it('after Yes, shows a confirmed-eligibility chip with an Edit control', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true } });
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    expect(await screen.findByText(/Confirmed: Singaporean or PR/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('Edit on the confirmation chip returns to the screening gate', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true } });
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
  });

  it('shows no eligibility chip when the gate is off', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText(/Confirmed: Singaporean or PR/i)).toBeNull();
  });
});

describe('CampaignSignupForm — SG/PR gate edge cases & integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not gate when sgPrOnly is explicitly false', () => {
    renderForm({ design: { sgPrOnly: false } });
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
    expect(screen.queryByText('Are you a Singapore Citizen or Permanent Resident?')).toBeNull();
  });

  it('only gates on boolean true — a stale string "true" must NOT gate', () => {
    renderForm({ design: { sgPrOnly: 'true' } });
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
    expect(screen.queryByText('Are you a Singapore Citizen or Permanent Resident?')).toBeNull();
  });

  it('only gates on boolean true — a numeric 1 must NOT gate', () => {
    renderForm({ design: { sgPrOnly: 1 } });
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
  });

  it('screening buttons are type="button" so they never submit the form', () => {
    renderForm({ design: { sgPrOnly: true } });
    expect(screen.getByRole('button', { name: 'Yes, I am' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('type', 'button');
  });

  it('uses the campaign theme color on the Yes button', () => {
    renderForm({ design: { sgPrOnly: true } });
    expect(screen.getByRole('button', { name: 'Yes, I am' })).toHaveStyle({ backgroundColor: '#D17029' });
  });

  it('renders none of the form internals while gated (phone/name/submit hidden)', () => {
    renderForm({ design: { sgPrOnly: true } });
    expect(screen.queryByPlaceholderText('9123 4567')).toBeNull();
    expect(screen.queryByPlaceholderText('John Tan')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
  });

  it('keeps the form hidden after answering No', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true } });
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(await screen.findByText(/only open to Singapore Citizens/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('9123 4567')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
  });

  it('supports the full recovery path: No → wrong option → Yes → form', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true } });
    await user.click(screen.getByRole('button', { name: 'No' }));
    await user.click(await screen.findByRole('button', { name: /picked the wrong option/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, I am' }));
    expect(await screen.findByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
  });

  it('shows the gate in previewMode (designer / admin preview)', () => {
    renderForm({ previewMode: true, design: { sgPrOnly: true } });
    expect(screen.getByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
  });

  it('gate ON + previewMode: Yes reveals the form and the full submit flow still works', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({ previewMode: true, design: { sgPrOnly: true } });

    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));

    await user.type(await screen.findByPlaceholderText('John Tan'), 'Jane Tan');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com');
    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    const otpInput = await screen.findByPlaceholderText('6-digit code');
    await user.type(otpInput, '123456');
    await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument(), { timeout: 2500 });

    fireEvent.click(document.getElementById('consent_terms'));
    const submit = screen.getByRole('button', { name: 'Submit Now' });
    await waitFor(() => expect(submit).toBeEnabled(), { timeout: 2500 });
    await user.click(submit);

    expect(await screen.findByText('Preview — your details were not submitted.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('CampaignSignupForm — exclude financial consultants gate', () => {
  beforeEach(() => vi.clearAllMocks());

  const ADVISOR_Q = 'Are you a financial advisor, consultant, or insurance agent?';

  it('shows the form directly when excludeAdvisors is off (default)', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
    expect(screen.queryByText(ADVISOR_Q)).toBeNull();
  });

  it('gates the form behind a Yes/No screening question when excludeAdvisors is on', () => {
    renderForm({ design: { excludeAdvisors: true } });
    expect(screen.getByText(ADVISOR_Q)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
    expect(screen.getByRole('button', { name: 'No, I am not' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
  });

  it('reveals the form after answering "No, I am not"', async () => {
    const user = userEvent.setup();
    renderForm({ design: { excludeAdvisors: true } });
    await user.click(screen.getByRole('button', { name: 'No, I am not' }));
    expect(await screen.findByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
    expect(screen.queryByText(ADVISOR_Q)).toBeNull();
  });

  it('blocks the form with a not-eligible message after answering Yes, and is reversible', async () => {
    const user = userEvent.setup();
    renderForm({ design: { excludeAdvisors: true } });
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText(/not available to financial advisors/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
    // Mis-tap recovery: back to the screening question.
    await user.click(screen.getByRole('button', { name: /picked the wrong option/i }));
    expect(await screen.findByText(ADVISOR_Q)).toBeInTheDocument();
  });

  it('does not gate when excludeAdvisors is explicitly false', () => {
    renderForm({ design: { excludeAdvisors: false } });
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
  });

  it('only gates on boolean true — a stale string "true" must NOT gate', () => {
    renderForm({ design: { excludeAdvisors: 'true' } });
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
  });

  it('screening buttons are type="button" so they never submit the form', () => {
    renderForm({ design: { excludeAdvisors: true } });
    expect(screen.getByRole('button', { name: 'No, I am not' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('type', 'button');
  });

  it('shows the gate in previewMode (designer / admin preview)', () => {
    renderForm({ previewMode: true, design: { excludeAdvisors: true } });
    expect(screen.getByText(ADVISOR_Q)).toBeInTheDocument();
  });

  it('chains SG/PR first, then the advisor gate, before revealing the form', async () => {
    const user = userEvent.setup();
    renderForm({ design: { sgPrOnly: true, excludeAdvisors: true } });
    // SG/PR gate first; advisor question not yet visible.
    expect(screen.getByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
    expect(screen.queryByText(ADVISOR_Q)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    // Now the advisor gate; the form is still hidden.
    expect(await screen.findByText(ADVISOR_Q)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Now' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'No, I am not' }));
    // Both gates passed → the form.
    expect(await screen.findByRole('button', { name: 'Submit Now' })).toBeInTheDocument();
  });
});

describe('CampaignSignupForm — OTP rate limiting (429)', () => {
  beforeEach(() => vi.clearAllMocks());

  const COOLDOWN_MSG = 'Too many verification attempts. Please wait 10 minutes before trying again.';
  const err429 = () => Object.assign(new Error('HTTP 429: Too Many Requests'), { status: 429 });

  it('shows the cooldown message and locks the Verify button after a rate-limited send', async () => {
    const user = userEvent.setup();
    apiClient.post.mockRejectedValueOnce(err429());
    renderForm();

    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    // The friendly branch (dead until 2026-07-17: it read err.response?.status,
    // which apiClient never sets) — not the raw "HTTP 429" string.
    expect(await screen.findByText(COOLDOWN_MSG)).toBeInTheDocument();
    expect(screen.queryByText('HTTP 429: Too Many Requests')).not.toBeInTheDocument();

    // The idle Verify button now honors the cooldown: disabled + counting down,
    // so it can't invite more rate-limited requests.
    const waitButton = screen.getByRole('button', { name: /^Wait \d+:\d{2}$/ });
    expect(waitButton).toBeDisabled();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('shows the cooldown message when /verify/check is rate-limited (shared limiter)', async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation((url) => {
      if (url === '/verify/send') return Promise.resolve({ success: true });
      if (url === '/verify/check') return Promise.reject(err429());
      return Promise.resolve({ success: true });
    });
    renderForm();

    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await user.type(await screen.findByPlaceholderText('6-digit code'), '123456');

    expect(await screen.findByText(COOLDOWN_MSG)).toBeInTheDocument();
  });

  it('surfaces the server message for a non-429 send failure', async () => {
    const user = userEvent.setup();
    apiClient.post.mockRejectedValueOnce(
      Object.assign(new Error('Only Singapore (+65) phone numbers are supported.'), { status: 400 })
    );
    renderForm();

    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(
      await screen.findByText('Only Singapore (+65) phone numbers are supported.')
    ).toBeInTheDocument();
  });
});

describe('CampaignSignupForm — always-required labels never render "(optional)"', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([false, 'optional'])(
    'name/email labels ignore requiredFields set to %j (backend requires them regardless)',
    (value) => {
      renderForm({ design: { requiredFields: { name: value, email: value } } });
      expect(screen.queryByText('(optional)')).not.toBeInTheDocument();
      // Both labels still carry the required asterisk.
      expect(screen.getByText('Full Name')).toBeInTheDocument();
      expect(screen.getByText('Email Address')).toBeInTheDocument();
    }
  );

  it('still renders "(optional)" for a genuinely optional field', () => {
    renderForm({ design: { requiredFields: { postal_code: false } } });
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });
});

describe('CampaignSignupForm — DNC consent gate advertiser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the campaign, never the {Advertiser} placeholder, when the verified number is registered', async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation((url) => {
      if (url === '/verify/send') return Promise.resolve({ success: true });
      if (url === '/verify/check') return Promise.resolve({ success: true, data: { verified: true } });
      if (url === '/dnc/check') return Promise.resolve({ success: true, data: { registered: true } });
      return Promise.resolve({ success: true });
    });
    renderForm({ design: { dncCheckAtSubmit: true } });

    await user.type(screen.getByPlaceholderText('9123 4567'), '91234567');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await user.type(await screen.findByPlaceholderText('6-digit code'), '123456');

    // onVerified fires after the panel's success/collapse timeouts, then the
    // DNC check resolves 'registered' and the gate opens.
    expect(
      await screen.findByText(/Do Not Call Registry/, {}, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(screen.getByText('Test Campaign')).toBeInTheDocument();
    expect(screen.queryByText('{Advertiser}')).not.toBeInTheDocument();
  });
});
