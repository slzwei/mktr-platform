/**
 * The RSVP designer (docs/plans/rsvp-pages.md §6): shared renderer in the
 * preview, block/field editing, locked + frozen rules, explicit save with
 * only-changed meta, and publish problems surfaced from the server.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { clampLayout } from '@/lib/rsvpLayout';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock, useParams: () => ({ id: 'ev-1' }) };
});
vi.mock('@/components/studio/DeviceFrame', () => ({ default: ({ children }) => <div data-testid="frame">{children}</div> }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const api = vi.hoisted(() => ({ updateRsvpEvent: vi.fn(), publishRsvpEvent: vi.fn(), closeRsvpEvent: vi.fn(), checkRsvpSlug: vi.fn() }));
vi.mock('@/api/rsvp', () => api);

let EVENT;
vi.mock('@/hooks/queries/useRsvp', () => ({ useRsvpEvent: () => ({ data: EVENT, isLoading: false, isError: false }) }));

import AdminRsvpDesigner, { metaPatch, problemLabel } from '../AdminRsvpDesigner';

const LAYOUT = clampLayout({
  blocks: [{ id: 'b_hero', type: 'hero', headline: 'Launch night' }, { id: 'b_form', type: 'form', headline: 'Save your spot' }],
  fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_diet', type: 'select', label: 'Diet', options: ['Veg', 'Halal'] }],
});
const baseEvent = () => ({
  id: 'ev-1', title: 'Launch night', slug: 'launch', organiserName: 'Acme', status: 'draft', capacity: null, closesAt: null,
  layout: LAYOUT, consent: { version: 'v1', copy: 'I agree ... Acme ...' }, problems: [], goingCount: 0, responseCount: 0, frozen: false, locked: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.checkRsvpSlug.mockResolvedValue({ available: true });
  EVENT = baseEvent();
  api.updateRsvpEvent.mockImplementation(async (id, patch) => ({ ...EVENT, ...patch, layout: clampLayout(patch.layout || EVENT.layout) }));
});

const renderPage = () => render(<MemoryRouter><AdminRsvpDesigner /></MemoryRouter>);

describe('AdminRsvpDesigner', () => {
  it('renders the four sections and the shared renderer as the preview', () => {
    renderPage();
    for (const s of ['Content', 'Form', 'Theme', 'Settings']) expect(screen.getByRole('button', { name: s })).toBeInTheDocument();
    expect(within(screen.getByTestId('frame')).getByRole('heading', { level: 1, name: 'Launch night' })).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('adds a text block, edits it, and the preview follows', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
    const list = screen.getByRole('list', { name: 'Page blocks' });
    expect(within(list).getByRole('button', { name: 'Drag Text' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Text'), 'Doors open at 7.');
    expect(screen.getByLabelText('Text')).toHaveValue('Doors open at 7.');
    expect(within(screen.getByTestId('frame')).getByText('Doors open at 7.')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    // The form block can never be removed.
    expect(within(list).queryByRole('button', { name: 'Delete RSVP form' })).not.toBeInTheDocument();
  });

  it('form: locked fields cannot be deleted, custom ones can; frozen fields lose type/options editing', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Form' }));
    const list = screen.getByRole('list', { name: 'Form fields' });
    expect(within(list).queryByRole('button', { name: 'Delete Full name' })).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Delete Diet' })).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: /^Diet/ }));
    expect(screen.getByLabelText('Type')).toBeEnabled();
    await userEvent.click(within(list).getByRole('button', { name: 'Delete Diet' }));
    expect(within(list).queryByRole('button', { name: 'Drag Diet' })).not.toBeInTheDocument();
  });

  it('frozen event: existing fields are undeletable and their type is fixed', async () => {
    EVENT = { ...baseEvent(), frozen: true, responseCount: 3 };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Form' }));
    const list = screen.getByRole('list', { name: 'Form fields' });
    expect(within(list).queryByRole('button', { name: 'Delete Diet' })).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: /^Diet/ }));
    expect(screen.getByLabelText('Type')).toBeDisabled();
    expect(screen.getByLabelText('Options (one per line)')).toBeDisabled();
    expect(screen.getByText(/People have already answered/)).toBeInTheDocument();
  });

  it('save sends the layout plus only the meta that changed', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const titleInput = screen.getByLabelText('Title (admin only)');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Launch night v2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateRsvpEvent).toHaveBeenCalledTimes(1));
    const [id, patch] = api.updateRsvpEvent.mock.calls[0];
    expect(id).toBe('ev-1');
    expect(patch.title).toBe('Launch night v2');
    expect(patch.layout.version).toBe(1);
    expect('slug' in patch).toBe(false);
    expect('organiserName' in patch).toBe(false);
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument());
  });

  it('published events lock the link and organiser inputs', async () => {
    EVENT = { ...baseEvent(), status: 'published', locked: true, publishedAt: '2026-09-03T00:00:00Z' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('Link')).toBeDisabled();
    expect(screen.getByLabelText(/Organiser/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close RSVPs' })).toBeInTheDocument();
  });

  it('publish surfaces the server problems in plain words', async () => {
    api.publishRsvpEvent.mockRejectedValue(Object.assign(new Error('The event is not ready to publish'), { data: { code: 'not_publishable', problems: ['slug_missing', 'options_too_few:f_diet'] } }));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const banner = () => screen.getAllByRole('status').map((n) => n.textContent).join(' | ');
    await waitFor(() => expect(banner()).toContain('Add a link in Settings'));
    expect(banner()).toContain('"f_diet" needs at least 2 options');
  });
});

describe('undo / redo', () => {
  it('undoes and redoes structural edits via the buttons and the keyboard', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
    const list = () => screen.getByRole('list', { name: 'Page blocks' });
    expect(within(list()).getByRole('button', { name: 'Drag Text' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(list()).queryByRole('button', { name: 'Drag Text' })).not.toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(within(list()).getByRole('button', { name: 'Drag Text' })).toBeInTheDocument();
    await userEvent.keyboard('{Meta>}z{/Meta}');
    expect(within(list()).queryByRole('button', { name: 'Drag Text' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
    expect(within(list()).getByRole('button', { name: 'Drag Text' })).toBeInTheDocument();
  });

  it('collapses a typing burst into one step, and a new edit clears the redo stack', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
    await userEvent.type(screen.getByLabelText('Text'), 'Doors at 7');
    expect(screen.getByLabelText('Text')).toHaveValue('Doors at 7');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Text')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Text'), 'New');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('settings edits are undoable too', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.type(screen.getByLabelText('Title (admin only)'), ' v2');
    expect(screen.getByLabelText('Title (admin only)')).toHaveValue('Launch night v2');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Title (admin only)')).toHaveValue('Launch night');
  });
});

describe('helpers', () => {
  it('metaPatch diffs against the baseline and shapes capacity/closesAt', () => {
    const base = { title: 'A', slug: 'a', organiserName: 'O', capacity: '', closesAt: '' };
    expect(metaPatch(base, { ...base })).toEqual({});
    expect(metaPatch(base, { ...base, capacity: '40', closesAt: '2026-10-04T14:00' })).toEqual({ capacity: 40, closesAt: '2026-10-04T14:00' });
    expect(metaPatch({ ...base, capacity: '40' }, { ...base, capacity: '', slug: '' })).toEqual({ capacity: null, slug: null });
  });
  it('problemLabel maps codes to copy', () => {
    expect(problemLabel('organiser_missing')).toMatch(/organiser/);
    expect(problemLabel('locked_field_missing:email')).toMatch(/email/);
    expect(problemLabel('weird')).toBe('weird');
  });
});
