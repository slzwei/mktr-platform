/**
 * The one RSVP renderer (docs/plans/rsvp-pages.md §6): every block type, the
 * preview placeholders, the unavailable states, the confirmation, and the
 * form's payload contract.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import RsvpPageRenderer from '../RsvpPageRenderer';
import { validateAnswers, buildAnswersPayload } from '../RsvpForm';
import { clampLayout } from '@/lib/rsvpLayout';

const LAYOUT = clampLayout({
  theme: { preset: 'kopi' },
  blocks: [
    { id: 'b_hero', type: 'hero', headline: 'Launch night', subheadline: 'Drinks + demos', mediaUrl: 'https://cdn.example/hero.jpg', mediaAlt: 'Crowd' },
    { id: 'b_when', type: 'details', rows: [{ label: 'When', value: 'Sat 4 Oct' }] },
    { id: 'b_text', type: 'text', body: 'First para.\n\nSecond para.' },
    { id: 'b_img', type: 'image', url: 'https://cdn.example/venue.jpg', alt: 'Venue' },
    { id: 'b_form', type: 'form', headline: 'Save your spot', submitLabel: 'Count me in' },
  ],
  fields: [
    { key: 'name' }, { key: 'email' }, { key: 'phone' },
    { key: 'f_diet', type: 'select', label: 'Diet', required: true, options: ['Veg', 'Halal'] },
    { key: 'f_days', type: 'multiselect', label: 'Days', options: ['Sat', 'Sun'] },
    { key: 'f_okay', type: 'checkbox', label: 'I will bring ID', required: true },
    { key: 'f_note', type: 'textarea', label: 'Note' },
    { key: 'f_pax1', type: 'number', label: 'Guests' },
    { key: 'f_when', type: 'date', label: 'Arrival' },
  ],
  confirmation: { headline: 'See you there', body: 'Bring a friend.' },
});
const CONSENT = { version: 'v1', copy: 'I agree that MKTR PTE. LTD. may share my details with Acme.' };

const renderPage = (props = {}) => render(
  <RsvpPageRenderer title="Launch night" organiserName="Acme" layout={LAYOUT} state="open" consent={CONSENT} {...props} />
);

describe('RsvpPageRenderer', () => {
  it('renders every block type, the fields, the consent copy and the footer', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Launch night' })).toBeInTheDocument();
    expect(screen.getByText('Drinks + demos')).toBeInTheDocument();
    expect(screen.getByAltText('Crowd')).toHaveAttribute('src', 'https://cdn.example/hero.jpg');
    expect(screen.getByText('When')).toBeInTheDocument();
    expect(screen.getByText('Sat 4 Oct')).toBeInTheDocument();
    expect(screen.getByText('First para.')).toBeInTheDocument();
    expect(screen.getByText('Second para.')).toBeInTheDocument();
    expect(screen.getByAltText('Venue')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Save your spot' })).toBeInTheDocument();
    for (const label of [/Full name/, /Email/, /Mobile/, /Diet/, /Note/, /Guests/, /Arrival/]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /I will bring ID/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Sat' })).toBeInTheDocument();
    expect(screen.getByLabelText(/I agree that MKTR PTE. LTD./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Count me in' })).toBeInTheDocument();
    expect(screen.getByText(/Hosted by Acme/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Personal Data Policy' })).toHaveAttribute('href', 'https://redeem.sg/personal-data-policy');
    // Honeypot is present but out of the accessibility tree.
    expect(document.querySelector('input[name="website"]')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Website' })).not.toBeInTheDocument();
  });

  it('preview mode shows placeholders for empty slots and never submits', async () => {
    const onSubmit = vi.fn();
    const empty = clampLayout({ blocks: [{ id: 'b_h', type: 'hero' }, { id: 'b_t', type: 'text' }, { id: 'b_d', type: 'details' }, { id: 'b_i', type: 'image' }, { id: 'b_f', type: 'form' }] });
    render(<RsvpPageRenderer layout={empty} state="open" consent={CONSENT} mode="preview" onSubmit={onSubmit} />);
    expect(screen.getByText('Your event headline')).toBeInTheDocument();
    expect(screen.getByText('Tell people what to expect.')).toBeInTheDocument();
    expect(screen.getByText('Venue')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'RSVP' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', 'RSVPs have closed'],
    ['ended', 'RSVPs have closed'],
    ['full', 'This event is full'],
  ])('state %s replaces the form with a notice', (state, title) => {
    renderPage({ state });
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'RSVP form' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Launch night' })).toBeInTheDocument(); // chrome stays
  });

  it('shows the confirmation once done', () => {
    renderPage({ done: { status: 'created' } });
    expect(screen.getByRole('heading', { level: 2, name: 'See you there' })).toBeInTheDocument();
    expect(screen.getByText('Bring a friend.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'RSVP form' })).not.toBeInTheDocument();
  });

  it('validates before submitting and then posts exactly the wire contract', async () => {
    const onSubmit = vi.fn();
    renderPage({ onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Count me in' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('This is required').length).toBeGreaterThan(0);
    expect(screen.getByText('Please agree so we can save your RSVP')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Full name/), 'Alice');
    await userEvent.type(screen.getByLabelText(/^Email/), 'alice@example.com');
    await userEvent.selectOptions(screen.getByLabelText(/Diet/), 'Veg');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sat' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /I will bring ID/ }));
    await userEvent.type(screen.getByLabelText(/Guests/), '2');
    await userEvent.click(screen.getByLabelText(/I agree that MKTR PTE. LTD./));
    await userEvent.click(screen.getByRole('button', { name: 'Count me in' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      answers: { name: 'Alice', email: 'alice@example.com', f_diet: 'Veg', f_days: ['Sat'], f_okay: true, f_pax1: 2 },
      consent: true,
      website: '',
    });
  });

  it('maps server field errors back inline and explains typed refusals', () => {
    const fieldErr = { message: 'Validation Error', data: { code: 'invalid', errors: [{ field: 'answers.f_diet', message: '"f_diet" must be one of [Veg, Halal]' }] } };
    const { rerender } = renderPage({ submitError: fieldErr });
    expect(screen.getByText(/must be one of/)).toBeInTheDocument();
    rerender(<RsvpPageRenderer layout={LAYOUT} state="open" consent={CONSENT} submitError={{ message: 'full', data: { code: 'full' } }} />);
    expect(screen.getByText(/this event just filled up/)).toBeInTheDocument();
  });
});

describe('RsvpForm helpers', () => {
  const fields = LAYOUT.fields;
  it('validateAnswers: required, email shape, checkbox tick, consent', () => {
    const errors = validateAnswers(fields, { email: 'nope' }, false);
    expect(errors.name).toBe('This is required');
    expect(errors.email).toBe('Enter a valid email address');
    expect(errors.f_okay).toBe('Please tick this box');
    expect(errors.consent).toBeTruthy();
    expect(validateAnswers(fields, { name: 'A', email: 'a@b.co', f_diet: 'Veg', f_okay: true }, true)).toEqual({});
  });
  it('buildAnswersPayload: numbers numeric, empties dropped, arrays kept', () => {
    expect(buildAnswersPayload(fields, { name: ' A ', email: 'a@b.co', phone: '', f_pax1: '3', f_days: [], f_okay: false, f_note: undefined })).toEqual({ name: 'A', email: 'a@b.co', f_pax1: 3, f_okay: false });
  });
  it('a fetch-free component: no submit while typing a partial form', () => {
    const onSubmit = vi.fn();
    renderPage({ onSubmit });
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'A' } });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
