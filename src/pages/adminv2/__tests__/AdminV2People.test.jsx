/**
 * People directory — one row per PERSON: house phone display, the
 * signups-voice cell, erased rows browsable with the ⊘ chip, row click lands
 * on the profile's PERSON view carrying state.from (the back-link contract),
 * defensive inert row when latestProspectId is missing, debounced search in
 * the URL, and page flips that keep prior rows (v5 placeholderData).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2People from '../AdminV2People';

vi.mock('@/api/adminV2', () => ({ fetchConsumers: vi.fn() }));

import { fetchConsumers } from '@/api/adminV2';

const DATA = {
  total: 26, page: 1, limit: 25,
  rows: [
    {
      id: 'c1', firstName: 'Shawn', lastName: 'Lee', email: 'shawn@x.com', phone: '+6591234567',
      signupCount: 3, verifiedSignupCount: 2, firstSeenAt: '2026-05-01T08:40:00Z',
      lastSeenAt: '2026-07-25T08:40:00Z', erasedAt: null, latestProspectId: 'p9',
    },
    {
      id: 'c2', firstName: null, lastName: null, email: null, phone: null,
      signupCount: 2, verifiedSignupCount: 1, firstSeenAt: '2026-04-01T08:40:00Z',
      lastSeenAt: '2026-07-20T08:40:00Z', erasedAt: '2026-07-01T00:00:00Z', latestProspectId: 'p8',
    },
    {
      id: 'c3', firstName: 'Null', lastName: 'Anchor', email: 'n@x.com', phone: '+6598887777',
      signupCount: 1, verifiedSignupCount: 0, firstSeenAt: '2026-03-01T08:40:00Z',
      lastSeenAt: '2026-07-10T08:40:00Z', erasedAt: null, latestProspectId: null,
    },
  ],
};

function Loc() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}{location.search}|from:{String(location.state?.from)}</div>;
}

function setup(initial = '/AdminPeople') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/AdminPeople" element={<><AdminV2People /><Loc /></>} />
          <Route path="/admin/leads/:prospectId" element={<Loc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchConsumers.mockResolvedValue(JSON.parse(JSON.stringify(DATA)));
});

describe('AdminV2People', () => {
  it('renders linked people with the house phone display and the signups voice', async () => {
    setup();
    expect(await screen.findByText('Shawn Lee')).toBeInTheDocument();
    expect(screen.getByText('+65 9123 4567')).toBeInTheDocument();
    expect(screen.getByText('3 signups (2 verified)')).toBeInTheDocument();
    expect(screen.getByText(/26 LINKED PEOPLE/)).toBeInTheDocument();
    expect(screen.getByText(/no linked person — find them in Prospects/)).toBeInTheDocument();
    expect(fetchConsumers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 25, sort: '-lastSeenAt' })
    );
  });

  it('row click opens the PERSON view of the profile, carrying the list URL as state.from', async () => {
    setup('/AdminPeople?q=shawn');
    fireEvent.click(await screen.findByRole('button', { name: /Shawn Lee/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p9?view=profile|from:/AdminPeople?q=shawn');
  });

  it('erased people are browsable: ⊘ chip, dashed identity, still clickable', async () => {
    setup();
    const row = await screen.findByRole('button', { name: /Erased person/ });
    expect(screen.getByText('erased')).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p8?view=profile');
  });

  it('a row with no latestProspectId is inert — never a dead click', async () => {
    setup();
    await screen.findByText('Null Anchor');
    expect(screen.queryByRole('button', { name: /Null Anchor/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Null Anchor'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminPeople');
  });

  it('search is debounced into the URL and drives the query', async () => {
    setup();
    await screen.findByText('Shawn Lee');
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'lee' } });
    await waitFor(() => expect(fetchConsumers).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'lee' })
    ), { timeout: 1500 });
  });

  it('page flips keep the prior rows rendered (placeholderData, not a blank flash)', async () => {
    setup();
    await screen.findByText('Shawn Lee');
    fetchConsumers.mockImplementation(() => new Promise(() => {})); // page 2 never resolves
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Shawn Lee')).toBeInTheDocument();
  });
});
