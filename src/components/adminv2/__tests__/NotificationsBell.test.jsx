/**
 * Attention bell — badge counts only actionable severities, the panel lists
 * every composed row (watch tier included), rows deep-link, and an empty
 * payload reads as "all clear" with no badge. fetchAttention mocked; rows
 * come through the real composeAttentionRows.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsBell from '../NotificationsBell';
import { fetchAttention } from '@/api/adminV2';

vi.mock('@/api/adminV2', () => ({
  fetchAttention: vi.fn(async () => ({})),
}));

const PAYLOAD = {
  webhooks: { pending: 3, failedLast24h: 2, subscriberDisabled: false },
  held: { total: 3, byReason: { no_funded_agent: 2, dnc_pending: 1 } },
  unassigned: 4,
  wallets: { zero: [], low: [], floatCents: 0 },
  zeroCommitCampaigns: [],
  drawsClosing: [{ id: 'd1', name: 'Tokyo Getaway Lucky Draw', closesAt: new Date(Date.now() + 3 * 86400000).toISOString(), multiplier: 2, winners: 1 }],
  endingCampaigns: [],
};

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/AdminDashboard']}>
        <NotificationsBell />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('NotificationsBell', () => {
  it('badges the actionable count — watch-tier rows are listed but not counted', async () => {
    fetchAttention.mockResolvedValue(PAYLOAD);
    setup();
    // incident (webhooks) + held + warning (unassigned) = 3; the draw is watch.
    const bell = await screen.findByRole('button', { name: /3 items need attention/i });
    expect(bell).toHaveTextContent('3');

    fireEvent.click(bell);
    expect(await screen.findByText('2 Lyfe deliveries failed in 24h')).toBeInTheDocument();
    expect(screen.getByText('3 leads held')).toBeInTheDocument();
    expect(screen.getByText('4 leads unassigned')).toBeInTheDocument();
    expect(screen.getByText(/draw closes in \d+d/)).toBeInTheDocument();
  });

  it('rows deep-link to their pre-filtered screens and close the panel', async () => {
    fetchAttention.mockResolvedValue(PAYLOAD);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /need attention/i }));
    fireEvent.click(await screen.findByText('3 leads held'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminProspects?assignment=held');
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('reads all-clear with no badge when nothing needs attention', async () => {
    fetchAttention.mockResolvedValue({});
    setup();
    const bell = await screen.findByRole('button', { name: /all clear/i });
    expect(bell).not.toHaveTextContent(/\d/);
    fireEvent.click(bell);
    expect(await screen.findByText('All clear')).toBeInTheDocument();
  });

  it('never claims all-clear on a failed feed — label and panel say so, retry offered', async () => {
    fetchAttention.mockRejectedValue(new Error('boom'));
    setup();
    const bell = await screen.findByRole('button', { name: /couldn.t load alerts/i });
    fireEvent.click(bell);
    expect(await screen.findByText('Couldn’t load alerts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('All clear')).not.toBeInTheDocument();
  });
});
