import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { create, remove } = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}));
const ROWS = [
  { id: 'e1', title: 'Launch night', organiserName: 'Acme', slug: 'launch', status: 'published', goingCount: 12, capacity: 40, responseCount: 13, closesAt: '2026-10-04T06:00:00Z', updatedAt: '2026-09-03T00:00:00Z' },
  { id: 'e2', title: 'Draft thing', organiserName: '', slug: null, status: 'draft', goingCount: 0, capacity: null, responseCount: 0, closesAt: null, updatedAt: '2026-09-02T00:00:00Z' },
];
vi.mock('@/hooks/queries/useRsvp', () => ({
  useRsvpEvents: () => ({ data: ROWS, isLoading: false, isError: false }),
  useCreateRsvpEvent: () => create,
  useDeleteRsvpEvent: () => remove,
}));

import AdminRsvpList from '../AdminRsvpList';

beforeEach(() => {
  vi.clearAllMocks();
  create.mutateAsync.mockResolvedValue({ id: 'new-1' });
  remove.mutateAsync.mockResolvedValue(undefined);
});

describe('AdminRsvpList', () => {
  it('lists events with link, status and seats; drafts without responses can be deleted', async () => {
    render(<MemoryRouter><AdminRsvpList /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'rsvp.redeem.sg/launch' })).toHaveAttribute('href', 'https://rsvp.redeem.sg/launch');
    expect(screen.getByText('12 / 40')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
    expect(screen.getByText('no link yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Launch night' })).not.toBeInTheDocument();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Draft thing' }));
    await waitFor(() => expect(remove.mutateAsync).toHaveBeenCalledWith('e2'));
    await userEvent.click(screen.getByRole('button', { name: 'Launch night' }));
    expect(navigateMock).toHaveBeenCalledWith('/admin/rsvp/e1');
  });

  it('creates an event and opens the designer', async () => {
    render(<MemoryRouter><AdminRsvpList /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'New event' }));
    await userEvent.type(screen.getByLabelText('Event title'), 'Open house');
    await userEvent.type(screen.getByLabelText('Organiser'), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalledWith({ title: 'Open house', organiserName: 'Acme' }));
    expect(navigateMock).toHaveBeenCalledWith('/admin/rsvp/new-1');
  });
});
