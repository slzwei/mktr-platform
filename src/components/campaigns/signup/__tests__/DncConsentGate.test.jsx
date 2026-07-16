import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import DncConsentGate from '@/components/campaigns/signup/DncConsentGate';

// The advertiser chip names who the person consents to being contacted by.
// CampaignSignupForm threads campaign.name; the raw '{Advertiser}' design-handoff
// token must never reach a customer (live bug until 2026-07-17).
describe('DncConsentGate — advertiser naming', () => {
  it('renders the advertiser in the notice state and consents on click', async () => {
    const user = userEvent.setup();
    const onGiveConsent = vi.fn();
    render(
      <DncConsentGate
        advertiser="Tokyo Getaway Lucky Draw"
        consented={false}
        onGiveConsent={onGiveConsent}
        onRevoke={vi.fn()}
      />
    );

    expect(screen.getByText(/Do Not Call Registry/)).toBeInTheDocument();
    expect(screen.getByText('Tokyo Getaway Lucky Draw')).toBeInTheDocument();
    expect(screen.queryByText('{Advertiser}')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I consent to be contacted' }));
    expect(onGiveConsent).toHaveBeenCalledTimes(1);
  });

  it('renders the advertiser in the confirmed state and revokes via Edit consent', async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();
    render(
      <DncConsentGate
        advertiser="Tokyo Getaway Lucky Draw"
        consented
        onGiveConsent={vi.fn()}
        onRevoke={onRevoke}
      />
    );

    expect(screen.getByText('Consent recorded')).toBeInTheDocument();
    expect(screen.getByText('Tokyo Getaway Lucky Draw')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Edit consent/ }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('falls back to a neutral name — never the literal template token', () => {
    render(<DncConsentGate consented={false} onGiveConsent={vi.fn()} onRevoke={vi.fn()} />);

    expect(screen.getByText('the advertiser')).toBeInTheDocument();
    expect(screen.queryByText('{Advertiser}')).not.toBeInTheDocument();
  });
});
