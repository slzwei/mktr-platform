import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: 'ev-1' }) };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const EVENT = {
  id: 'ev-1', title: 'Launch night', slug: 'launch', status: 'published', goingCount: 1, responseCount: 2, capacity: 40,
  layout: { fields: [{ key: 'name' }, { key: 'email' }, { key: 'phone' }, { key: 'f_diet', type: 'select', label: 'Diet' }] },
};
const update = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/hooks/queries/useRsvp', () => ({
  useRsvpEvent: () => ({ data: EVENT, isLoading: false, isError: false }),
  useUpdateRsvpResponse: () => update,
}));
const api = vi.hoisted(() => ({ fetchRsvpResponses: vi.fn(), downloadRsvpCsv: vi.fn() }));
const PAGE = {
    responses: [
      { id: 'r1', name: 'Alice', email: 'alice@x.com', phone: '+6591234567', answers: { f_diet: 'Veg' }, status: 'going', createdAt: '2026-09-03T01:00:00Z' },
      { id: 'r2', name: 'Bob', email: 'bob@x.com', phone: null, answers: {}, status: 'cancelled', createdAt: '2026-09-03T02:00:00Z' },
    ],
    nextCursor: null,
};
vi.mock('@/api/rsvp', () => api);

import AdminRsvpResponses from '../AdminRsvpResponses';

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchRsvpResponses.mockResolvedValue(PAGE);
  api.downloadRsvpCsv.mockResolvedValue({ truncated: false });
  update.mutateAsync.mockResolvedValue({});
});

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><AdminRsvpResponses /></MemoryRouter>
  </QueryClientProvider>
);

describe('AdminRsvpResponses', () => {
  it('renders attendees with the custom field as a column and exports the CSV', async () => {
    renderPage();
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Diet' })).toBeInTheDocument();
    expect(screen.getByText('Veg')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(api.downloadRsvpCsv).toHaveBeenCalledWith('ev-1', 'rsvp-launch-responses.csv'));
  });

  it('cancel and reactivate go through the correction endpoint', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel Alice' }));
    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalledWith({ id: 'ev-1', responseId: 'r1', patch: { status: 'cancelled' } }));
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate Bob' }));
    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalledWith({ id: 'ev-1', responseId: 'r2', patch: { status: 'going' } }));
  });
});
