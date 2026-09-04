import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/services/mailer.js', () => ({ sendEmail: jest.fn() }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

let mailer;
let rsvpMailer;
beforeAll(async () => {
  mailer = await import('../../src/services/mailer.js');
  rsvpMailer = await import('../../src/services/rsvpMailer.js');
});
beforeEach(() => { mailer.sendEmail.mockReset(); delete process.env.RSVP_PUBLIC_ORIGIN; });

const EVENT = {
  id: 'ev-1', title: 'Launch <night>', slug: 'launch', organiserName: 'Acme & Co',
  layout: { blocks: [{ type: 'hero' }, { type: 'details', rows: [{ label: 'When', value: 'Sat 4 Oct, 7pm' }, { label: 'Where', value: '<b>Hall</b>' }] }], confirmation: { emailEnabled: true } },
};
const RESPONSE = { email: 'alice@example.com', name: 'Alice <script>Tan' };

describe('renderRsvpConfirmation', () => {
  test('is an operational message: title, details, link, organiser, escaped everywhere', () => {
    const { subject, html, text } = rsvpMailer.renderRsvpConfirmation({ event: EVENT, response: RESPONSE });
    expect(subject).toBe("You're in: Launch <night>");
    expect(text).toContain('Hi Alice,');
    expect(text).toContain('When: Sat 4 Oct, 7pm');
    expect(text).toContain('Your RSVP: https://rsvp.redeem.sg/launch?confirmed=1');
    expect(text).toContain('This is a confirmation of the RSVP you made');
    expect(text).not.toContain('not for marketing');
    expect(html).toContain('Launch &lt;night&gt;');
    expect(html).toContain('&lt;b&gt;Hall&lt;/b&gt;');
    expect(html).toContain('Acme &amp; Co');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://rsvp.redeem.sg/launch?confirmed=1"');
    expect(html).toContain('View your RSVP');
  });

  test('updated wording + a configurable public origin', () => {
    process.env.RSVP_PUBLIC_ORIGIN = 'https://rsvp.example.test/';
    const { subject, text } = rsvpMailer.renderRsvpConfirmation({ event: EVENT, response: RESPONSE, updated: true });
    expect(subject).toBe('Your RSVP is updated: Launch <night>');
    expect(text).toContain('https://rsvp.example.test/launch?confirmed=1');
  });
});

describe('sendRsvpConfirmationEmail', () => {
  test('sends from the redeem context', async () => {
    mailer.sendEmail.mockResolvedValue({ success: true });
    const out = await rsvpMailer.sendRsvpConfirmationEmail({ event: EVENT, response: RESPONSE });
    expect(out).toEqual({ sent: true });
    expect(mailer.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.com', context: 'redeem', subject: "You're in: Launch <night>" }));
  });

  test('honours the event switch and never throws on transport failure', async () => {
    const off = { ...EVENT, layout: { ...EVENT.layout, confirmation: { emailEnabled: false } } };
    expect(await rsvpMailer.sendRsvpConfirmationEmail({ event: off, response: RESPONSE })).toEqual({ sent: false, reason: 'disabled' });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
    mailer.sendEmail.mockRejectedValue(new Error('smtp down'));
    expect(await rsvpMailer.sendRsvpConfirmationEmail({ event: EVENT, response: RESPONSE })).toEqual({ sent: false, reason: 'error' });
    expect(await rsvpMailer.sendRsvpConfirmationEmail({ event: EVENT, response: { name: 'x' } })).toEqual({ sent: false, reason: 'no_recipient' });
  });
});

describe('details row links', () => {
  test('a row with a link renders as an anchor in HTML and in brackets in text', () => {
    const event = {
      id: 'e1', title: 'Launch', slug: 'launch', organiserName: 'Acme',
      layout: { blocks: [{ type: 'details', rows: [{ label: 'Where', value: 'Hall <b>2</b>', href: 'https://maps.app.goo.gl/abc?q=1&x=y' }, { label: 'When', value: 'Sat', href: '' }] }], confirmation: { emailEnabled: true } },
    };
    const { html, text } = rsvpMailer.renderRsvpConfirmation({ event, response: { email: 'ann@example.com', name: 'Ann Lee' } });
    expect(html).toContain('<a href="https://maps.app.goo.gl/abc?q=1&amp;x=y" style="color:#2b1d12">Hall &lt;b&gt;2&lt;/b&gt;</a>');
    expect(html).not.toContain('<a href="">');
    expect(text).toContain('Where: Hall <b>2</b> (https://maps.app.goo.gl/abc?q=1&x=y)');
    expect(text).toContain('When: Sat\n');
  });

  test('a non-https link in stored layout is never linked', () => {
    const event = { id: 'e1', title: 'Launch', slug: 'launch', organiserName: 'Acme', layout: { blocks: [{ type: 'details', rows: [{ label: 'Where', value: 'Hall', href: 'javascript:alert(1)' }] }] } };
    const { html, text } = rsvpMailer.renderRsvpConfirmation({ event, response: { email: 'ann@example.com', name: 'Ann' } });
    expect(html).not.toContain('javascript:');
    expect(text).toContain('Where: Hall\n');
  });
});

describe('organiser notification', () => {
  const EV = {
    id: 'ev-9', title: 'Candle Making', slug: 'candle', organiserName: 'Lyfe', capacity: 12,
    notifyEmails: ['ops@example.com', 'boss@example.com'],
    layout: { fields: [
      { key: 'name', type: 'text', label: 'Full name' },
      { key: 'email', type: 'email', label: 'Email' },
      { key: 'phone', type: 'phone', label: 'Mobile' },
      { key: 'f_diet1', type: 'select', label: 'Diet' },
      { key: 'f_okay1', type: 'checkbox', label: 'Brings ID' },
      { key: 'f_none1', type: 'text', label: 'Unanswered' },
    ] },
  };
  const RES = { name: 'Ann <Lee>', email: 'ann@example.com', phone: '+6591234567', answers: { f_diet1: 'Halal', f_okay1: true } };

  test('carries everything the organiser needs, escaped, with the seat count', () => {
    const { subject, html, text } = rsvpMailer.renderRsvpOrganiserNotice({ event: EV, response: RES, goingCount: 4 });
    expect(subject).toBe('New RSVP: Ann <Lee> — Candle Making');
    expect(text).toContain('Name: Ann <Lee>');
    expect(text).toContain('Email: ann@example.com');
    expect(text).toContain('Mobile: +6591234567');
    expect(text).toContain('Diet: Halal');
    expect(text).toContain('Brings ID: Yes');
    expect(text).not.toContain('Unanswered');
    expect(text).toContain('4 of 12 seats taken');
    expect(text).toContain('/admin/rsvp/ev-9/responses');
    expect(html).toContain('Ann &lt;Lee&gt;');
    expect(html).not.toContain('<Lee>');
  });

  test('an edit says so, and an uncapped event just counts', () => {
    const { subject, text } = rsvpMailer.renderRsvpOrganiserNotice({ event: { ...EV, capacity: null }, response: RES, goingCount: 7, updated: true });
    expect(subject).toBe('RSVP updated: Ann <Lee> — Candle Making');
    expect(text).toContain('7 going so far');
  });

  test('sends one mail per recipient so nobody sees the others, reply-to the attendee', async () => {
    mailer.sendEmail.mockResolvedValue({ success: true });
    const out = await rsvpMailer.sendRsvpOrganiserNotification({ event: EV, response: RES, goingCount: 1 });
    expect(out.sent).toBe(2);
    expect(mailer.sendEmail).toHaveBeenCalledTimes(2);
    const recipients = mailer.sendEmail.mock.calls.map(([a]) => a.to);
    expect(recipients).toEqual(['ops@example.com', 'boss@example.com']);
    expect(mailer.sendEmail.mock.calls[0][0].headers).toEqual({ 'Reply-To': 'ann@example.com' });
  });

  test('no recipients means no mail, and a throwing mailer never escapes', async () => {
    mailer.sendEmail.mockReset();
    const none = await rsvpMailer.sendRsvpOrganiserNotification({ event: { ...EV, notifyEmails: [] }, response: RES });
    expect(none).toEqual({ sent: 0, reason: 'no_recipients' });
    expect(mailer.sendEmail).not.toHaveBeenCalled();

    mailer.sendEmail.mockRejectedValue(new Error('smtp down'));
    await expect(rsvpMailer.sendRsvpOrganiserNotification({ event: EV, response: RES, goingCount: 1 })).resolves.toEqual({ sent: 0 });
  });
});
