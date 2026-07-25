/**
 * Prospects list → Lead Profile navigation contract (drawer replacement):
 * row click navigates carrying state.from; selection mode makes row clicks
 * TOGGLE instead (navigation would drop the selection); the legacy ?lead=
 * deep-link redirects to the page.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2Prospects from '../AdminV2Prospects';

vi.mock('@/api/adminV2', () => ({
  fetchProspects: vi.fn(async () => ({
    rows: [
      { id: 'p1', firstName: 'Sam', lastName: 'Tan', phone: '+6589279750', email: 's@x.com', leadStatus: 'new', quarantinedAt: null, campaign: { name: 'Tokyo' }, assignedAgent: null, createdAt: '2026-07-20T02:00:00Z' },
      { id: 'p2', firstName: 'Mei', lastName: 'Lim', phone: '+6581112222', email: 'm@x.com', leadStatus: 'new', quarantinedAt: null, campaign: { name: 'NTUC' }, assignedAgent: null, createdAt: '2026-07-19T02:00:00Z' },
    ],
    total: 2, page: 1, totalPages: 1,
  })),
  fetchAgentOptions: vi.fn(async () => []),
  bulkAssign: vi.fn(),
  bulkReturnToHeld: vi.fn(),
  bulkDelete: vi.fn(),
}));

function Loc() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}{location.search}</div>;
}

function setup(initial = '/AdminProspects') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/AdminProspects" element={<><AdminV2Prospects /><Loc /></>} />
          <Route path="/admin/leads/:prospectId" element={<Loc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminV2Prospects navigation', () => {
  it('row click opens the lead profile page', async () => {
    setup('/AdminProspects?status=new');
    fireEvent.click(await screen.findByText('Sam Tan'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p1');
  });

  it('selection mode: row clicks toggle instead of navigating', async () => {
    setup();
    await screen.findByText('Sam Tan');
    fireEvent.click(screen.getAllByLabelText('Select')[0]); // checkbox → selection mode
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mei Lim')); // row click TOGGLES, no navigation
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminProspects');
    fireEvent.click(screen.getByText('Mei Lim')); // toggles back off
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('legacy ?lead= deep-links redirect to the page', async () => {
    setup('/AdminProspects?q=sam&lead=p9');
    expect(await screen.findByTestId('loc')).toHaveTextContent('/admin/leads/p9');
  });
});
