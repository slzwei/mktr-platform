/**
 * ⌘K palette — open/close affordances, grouped results across all four
 * sources (server-searched leads, cached campaigns/agents, page labels),
 * keyboard selection, and the never-dead-end fallback row. API layer mocked;
 * navigation asserted through a real MemoryRouter location probe.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GlobalSearch from '../GlobalSearch';

vi.mock('@/api/adminV2', () => ({
  fetchProspects: vi.fn(async ({ search }) => ({
    rows: String(search).toLowerCase().includes('sa')
      ? [{ id: 'p1', firstName: 'Sam', lastName: 'Tan', phone: '+6589279750', email: 'sam@x.com', campaign: { name: 'Redeem $10 Fairprice Voucher' } }]
      : [],
    total: 1, page: 1, totalPages: 1,
  })),
  fetchCampaignsList: vi.fn(async () => ({
    rows: [{ id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active' }],
    total: 1,
  })),
  fetchAgentOptions: vi.fn(async () => ([
    { id: 'a1', name: 'Lee Wei', phone: '+6591111111', email: 'lee@x.com' },
  ])),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/AdminDashboard']}>
        <GlobalSearch />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const openPalette = () => {
  fireEvent.click(screen.getByRole('button', { name: /search leads, campaigns, agents/i }));
  return screen.getByRole('combobox', { name: 'Global search' });
};

beforeEach(() => vi.clearAllMocks());

describe('GlobalSearch', () => {
  it('pill opens a real palette; Escape closes it', () => {
    setup();
    const input = openPalette();
    expect(screen.getByRole('dialog', { name: 'Global search' })).toBeInTheDocument();
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('⌘K toggles the palette', () => {
    setup();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Global search' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('typing surfaces lead results and Enter deep-links with the drawer param', async () => {
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'sam' } });
    await screen.findByText('Sam Tan');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminProspects?q=%2B6589279750&lead=p1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('matches campaigns from the cached leaderboard and opens the detail page', async () => {
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'tokyo' } });
    fireEvent.click(await screen.findByText('Tokyo Getaway Lucky Draw'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/campaigns/c1');
  });

  it('matches agents and lands on the roster pre-filtered', async () => {
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'lee wei' } });
    fireEvent.click(await screen.findByText('Lee Wei'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminAgents?q=Lee%20Wei');
  });

  it('matches page routes by sidebar label', async () => {
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'wallet' } });
    fireEvent.click(await screen.findByText('Wallets & Commitments'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminWallets');
  });

  it('arrow keys walk the flat list; the fallback row never dead-ends Enter', async () => {
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'sam' } });
    await screen.findByText('Sam Tan');
    // flat list: [Sam Tan, fallback] — one step down lands on the fallback.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminProspects?q=sam');
  });

  it('shows a no-match note plus the fallback when nothing hits', async () => {
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'zzz' } });
    await screen.findByText(/no direct matches for/i);
    expect(screen.getByText('Search “zzz” in Prospects')).toBeInTheDocument();
  });

  it('reports an error instead of claiming no matches when a source fails', async () => {
    const { fetchProspects } = await import('@/api/adminV2');
    fetchProspects.mockRejectedValueOnce(new Error('boom'));
    setup();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'err' } });
    await screen.findByText(/search hit an error/i);
    expect(screen.queryByText(/no direct matches/i)).not.toBeInTheDocument();
    // The fallback row still gives Enter somewhere to go.
    expect(screen.getByText('Search “err” in Prospects')).toBeInTheDocument();
  });
});
