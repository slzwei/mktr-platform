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
    expect(text).toContain('Event page: https://rsvp.redeem.sg/launch');
    expect(text).toContain('not a marketing message');
    expect(html).toContain('Launch &lt;night&gt;');
    expect(html).toContain('&lt;b&gt;Hall&lt;/b&gt;');
    expect(html).toContain('Acme &amp; Co');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://rsvp.redeem.sg/launch"');
  });

  test('updated wording + a configurable public origin', () => {
    process.env.RSVP_PUBLIC_ORIGIN = 'https://rsvp.example.test/';
    const { subject, text } = rsvpMailer.renderRsvpConfirmation({ event: EVENT, response: RESPONSE, updated: true });
    expect(subject).toBe('Your RSVP is updated: Launch <night>');
    expect(text).toContain('https://rsvp.example.test/launch');
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
