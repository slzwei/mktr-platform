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
const CONSENT = { version: 'v1', copy: 'I agree that MKTR PTE. LTD. may share my details with Acme.', hash: 'a'.repeat(64) };

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

  it('a details row with a link renders the value as a new-tab link; preview keeps it inert', () => {
    const layout = clampLayout({ ...LAYOUT, blocks: LAYOUT.blocks.map((b) => (b.type === 'details' ? { ...b, rows: [{ label: 'Where', value: '545 Orchard Road', href: 'https://maps.app.goo.gl/abc' }] } : b)) });
    const { unmount } = render(<RsvpPageRenderer layout={layout} state="open" consent={CONSENT} onSubmit={() => {}} />);
    const link = screen.getByRole('link', { name: /545 Orchard Road/ });
    expect(link).toHaveAttribute('href', 'https://maps.app.goo.gl/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(fireEvent.click(link)).toBe(true);
    unmount();
    render(<RsvpPageRenderer layout={layout} state="open" consent={CONSENT} mode="preview" onSubmit={() => {}} />);
    expect(fireEvent.click(screen.getByRole('link', { name: /545 Orchard Road/ }))).toBe(false);
  });

  describe('mobile verification (same choreography as the capture funnel)', () => {
    const withPhone = (formOverrides = {}) => clampLayout({
      ...LAYOUT,
      blocks: LAYOUT.blocks.map((b) => (b.type === 'form' ? { ...b, ...formOverrides } : b)),
      fields: [
        { key: 'name', type: 'text', label: 'Full name', required: true },
        { key: 'email', type: 'email', label: 'Email', required: true },
        { key: 'phone', type: 'phone', label: 'Mobile', required: true },
      ],
    });
    const fill = async () => {
      await userEvent.type(screen.getByLabelText(/Full name/), 'Ann Lee');
      await userEvent.type(screen.getByLabelText(/Email/), 'ann@example.com');
      await userEvent.click(screen.getByLabelText(/I agree/i));
    };
    const mount = (props = {}, formOverrides = {}) => render(
      <RsvpPageRenderer
        layout={withPhone(formOverrides)}
        state="open"
        consent={CONSENT}
        onSubmit={props.onSubmit || vi.fn()}
        sendCode={props.sendCode || vi.fn().mockResolvedValue({})}
        checkCode={props.checkCode || vi.fn().mockResolvedValue(true)}
        mode={props.mode || 'live'}
      />
    );

    it('the number is typed against a +65 prefix and shown grouped', async () => {
      mount();
      const input = screen.getByLabelText(/Mobile/);
      await userEvent.type(input, '91234567');
      expect(input).toHaveValue('9123 4567');
      // Letters and a pasted country code cannot get in.
      await userEvent.clear(input);
      await userEvent.type(input, 'abc9123');
      expect(input).toHaveValue('9123');
    });

    it('Verify sends the code, the panel opens, and a correct code collapses it into a badge', async () => {
      const sendCode = vi.fn().mockResolvedValue({});
      const checkCode = vi.fn().mockResolvedValue(true);
      const onSubmit = vi.fn();
      mount({ sendCode, checkCode, onSubmit });
      await fill();

      const verifyBtn = screen.getByRole('button', { name: 'Verify' });
      expect(verifyBtn).toBeDisabled();
      await userEvent.type(screen.getByLabelText(/Mobile/), '91234567');
      expect(verifyBtn).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Count me in' })).toBeDisabled();

      await userEvent.click(verifyBtn);
      await waitFor(() => expect(sendCode).toHaveBeenCalledWith('91234567'));
      expect(await screen.findByText(/Enter the 6-digit code/)).toBeInTheDocument();
      // The number is locked while a code is outstanding.
      expect(screen.getByLabelText(/Mobile/)).toBeDisabled();

      await userEvent.type(screen.getByLabelText('Verification code'), '123456');
      // Auto-verifies on the sixth digit — no second click needed.
      await waitFor(() => expect(checkCode).toHaveBeenCalledWith('91234567', '123456'));
      expect(await screen.findByText('Verified')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(/Enter the 6-digit code/)).not.toBeInTheDocument());

      const submit = screen.getByRole('button', { name: 'Count me in' });
      await waitFor(() => expect(submit).toBeEnabled());
      await userEvent.click(submit);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('Edit reopens the number, with the resend still cooling down', async () => {
      mount();
      await userEvent.type(screen.getByLabelText(/Mobile/), '91234567');
      await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Enter the 6-digit code/);

      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.queryByText(/Enter the 6-digit code/)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Mobile/)).toBeEnabled();
      // Same guard as the capture funnel: a fresh send waits out the cooldown,
      // so one typo cannot burn a second SMS immediately.
      const row = screen.getByRole('button', { name: /Wait \d+s/ });
      expect(row).toBeDisabled();
    });

    it('the verified number is locked, so what was verified is what gets submitted', async () => {
      const onSubmit = vi.fn();
      mount({ onSubmit });
      await fill();
      await userEvent.type(screen.getByLabelText(/Mobile/), '91234567');
      await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
      await screen.findByText('Verified');

      const input = screen.getByLabelText(/Mobile/);
      expect(input).toBeDisabled();
      await userEvent.type(input, '8');
      expect(input).toHaveValue('9123 4567');

      await waitFor(() => expect(screen.getByRole('button', { name: 'Count me in' })).toBeEnabled());
      await userEvent.click(screen.getByRole('button', { name: 'Count me in' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0].answers.phone).toBe('91234567');
    });

    it('a wrong code keeps the panel open and says why', async () => {
      const checkCode = vi.fn().mockRejectedValue(new Error('Invalid verification code'));
      mount({ checkCode });
      await fill();
      await userEvent.type(screen.getByLabelText(/Mobile/), '91234567');
      await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await userEvent.type(await screen.findByLabelText('Verification code'), '000000');
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid verification code'));
      expect(screen.getByText(/Enter the 6-digit code/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Count me in' })).toBeDisabled();
    });

    it('offers a resend on a cooldown once a code is out', async () => {
      const sendCode = vi.fn().mockResolvedValue({});
      mount({ sendCode });
      await userEvent.type(screen.getByLabelText(/Mobile/), '91234567');
      await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
      const resend = await screen.findByRole('button', { name: /Resend code in \d+s/ });
      expect(resend).toBeDisabled();
      expect(sendCode).toHaveBeenCalledTimes(1);
    });

    it('a number we cannot text never gets a code', async () => {
      const sendCode = vi.fn();
      mount({ sendCode });
      await userEvent.type(screen.getByLabelText(/Mobile/), '1234567');
      expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
      expect(sendCode).not.toHaveBeenCalled();
    });

    it('the designer preview SHOWS the row, inert — the owner must see what attendees get', async () => {
      const sendCode = vi.fn();
      mount({ sendCode, mode: 'preview' });
      const button = screen.getByRole('button', { name: 'Verify' });
      expect(button).toBeInTheDocument();
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(sendCode).not.toHaveBeenCalled();
    });

    it('with the toggle off the mobile is a plain field again', async () => {
      const onSubmit = vi.fn();
      mount({ onSubmit }, { verifyPhone: false });
      await fill();
      await userEvent.type(screen.getByLabelText(/Mobile/), '+65 9123 4567');
      expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Count me in' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
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
      consentHash: 'a'.repeat(64),
    });
  });

  it('maps server field errors back inline and explains typed refusals', () => {
    const fieldErr = { message: 'Validation Error', data: { code: 'invalid', errors: [{ field: 'answers.f_diet', message: '"f_diet" must be one of [Veg, Halal]' }] } };
    const { rerender } = renderPage({ submitError: fieldErr });
    expect(screen.getByText(/must be one of/)).toBeInTheDocument();
    rerender(<RsvpPageRenderer layout={LAYOUT} state="open" consent={CONSENT} submitError={{ message: 'full', data: { code: 'full' } }} />);
    expect(screen.getByText(/this event just filled up/)).toBeInTheDocument();
    rerender(<RsvpPageRenderer layout={LAYOUT} state="open" consent={CONSENT} submitError={{ message: 'changed', data: { code: 'consent_changed' } }} />);
    expect(screen.getByText(/consent wording was updated/)).toBeInTheDocument();
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
