import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { clampLayout } from '@/lib/rsvpLayout';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ slug: 'launch' }) };
});
const api = vi.hoisted(() => ({ fetchPublicRsvp: vi.fn(), submitRsvp: vi.fn() }));
vi.mock('@/api/rsvpPublic', () => api);

import RsvpPublicPage from '../RsvpPublicPage';

const DTO = {
  slug: 'launch', title: 'Launch night', organiserName: 'Acme', state: 'open', closesAt: null,
  layout: clampLayout({ blocks: [{ id: 'b_h', type: 'hero', headline: 'Launch night' }, { id: 'b_f', type: 'form' }], fields: [{ key: 'name' }, { key: 'email' }] }),
  consent: { version: 'v1', copy: 'I agree that Acme may contact me about this event.', hash: 'b'.repeat(64) },
};

beforeEach(() => {
  vi.clearAllMocks();
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

describe('RsvpPublicPage', () => {
  it('404 → a plain "not live" page, with noindex set', async () => {
    api.fetchPublicRsvp.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    render(<MemoryRouter><RsvpPublicPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /isn.t live/ })).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')?.content).toBe('noindex,nofollow');
  });

  it('renders the event, submits, and shows the confirmation', async () => {
    api.fetchPublicRsvp.mockResolvedValue(DTO);
    api.submitRsvp.mockResolvedValue({ status: 'created' });
    render(<MemoryRouter><RsvpPublicPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch night' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Full name/), 'Alice');
    await userEvent.type(screen.getByLabelText(/^Email/), 'alice@example.com');
    await userEvent.click(screen.getByLabelText(/I agree that Acme/));
    await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
    await waitFor(() => expect(api.submitRsvp).toHaveBeenCalledWith('launch', { answers: { name: 'Alice', email: 'alice@example.com' }, consent: true, website: '', consentHash: 'b'.repeat(64) }));
    expect(await screen.findByRole('heading', { level: 2, name: "You're in" })).toBeInTheDocument();
    expect(document.title).toBe('Launch night · RSVP');
  });

  it('a consent_changed refusal swaps in the wording the server holds now', async () => {
    api.fetchPublicRsvp.mockResolvedValue(DTO);
    api.submitRsvp.mockRejectedValue(Object.assign(new Error('changed'), { status: 409, data: { code: 'consent_changed', consent: { version: 'v1', copy: 'New wording from Acme.', hash: 'c'.repeat(64) } } }));
    render(<MemoryRouter><RsvpPublicPage /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: 'Launch night' });
    await userEvent.type(screen.getByLabelText(/Full name/), 'Alice');
    await userEvent.type(screen.getByLabelText(/^Email/), 'alice@example.com');
    await userEvent.click(screen.getByLabelText(/I agree that Acme/));
    await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
    expect(await screen.findByText(/consent wording was updated/)).toBeInTheDocument();
    expect(screen.getByLabelText(/New wording from Acme/)).toBeInTheDocument();
  });

  it('?confirmed=1 (the email link) opens on the confirmation card, and "Change my RSVP" reveals the form', async () => {
    api.fetchPublicRsvp.mockResolvedValue(DTO);
    render(<MemoryRouter initialEntries={['/launch?confirmed=1']}><RsvpPublicPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 2, name: "You're in" })).toBeInTheDocument();
    expect(screen.getByText('Your RSVP is confirmed. See you there.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'RSVP form' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change my RSVP' }));
    expect(screen.getByRole('form', { name: 'RSVP form' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change my RSVP' })).not.toBeInTheDocument();
  });

  it('a "full" refusal flips the page into the full state', async () => {
    api.fetchPublicRsvp.mockResolvedValue(DTO);
    api.submitRsvp.mockRejectedValue(Object.assign(new Error('This event is full'), { status: 409, data: { code: 'full' } }));
    render(<MemoryRouter><RsvpPublicPage /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: 'Launch night' });
    await userEvent.type(screen.getByLabelText(/Full name/), 'Alice');
    await userEvent.type(screen.getByLabelText(/^Email/), 'alice@example.com');
    await userEvent.click(screen.getByLabelText(/I agree that Acme/));
    await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'This event is full' })).toBeInTheDocument();
  });
});
