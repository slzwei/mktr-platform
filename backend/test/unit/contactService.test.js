import { jest } from '@jest/globals';
import '../setup.js';

// ── Helpers ──

function buildMocks() {
  const sendEmail = jest.fn().mockResolvedValue({ success: true });

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return { sendEmail, logger };
}

async function makeService(mocks) {
  // Mock the mailer module before importing contactService
  jest.unstable_mockModule('../../src/services/mailer.js', () => ({
    sendEmail: mocks.sendEmail,
  }));

  // Dynamic import so the mock is picked up
  const mod = await import('../../src/services/contactService.js');
  return mod;
}

// ── Tests ──

describe('contactService (unit)', () => {
  let mocks, service;

  beforeEach(async () => {
    jest.restoreAllMocks();
    // Clear module registry so mocks are re-applied
    jest.resetModules();
    mocks = buildMocks();
    service = await makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // buildContactEmailHtml
  // ────────────────────────────────────────────────

  describe('buildContactEmailHtml', () => {
    it('includes all fields when present', () => {
      const html = service.buildContactEmailHtml({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+6591234567',
        company: 'Acme Corp',
        message: 'Hello world',
        userType: 'advertiser',
      });

      expect(html).toContain('John Doe');
      expect(html).toContain('john@example.com');
      expect(html).toContain('+6591234567');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('Hello world');
      expect(html).toContain('Advertiser'); // ROLE_LABELS mapped
    });

    it('omits optional fields (phone, company, userType) when missing', () => {
      const html = service.buildContactEmailHtml({
        name: 'Jane',
        email: 'jane@example.com',
        message: 'Just a message',
      });

      expect(html).toContain('Jane');
      expect(html).toContain('jane@example.com');
      expect(html).toContain('Just a message');
      // Optional table rows should not be rendered
      expect(html).not.toContain('Company');
      expect(html).not.toContain('Phone');
      expect(html).not.toContain('Role');
    });

    it('escapes HTML in user-provided fields', () => {
      const html = service.buildContactEmailHtml({
        name: '<script>alert("xss")</script>',
        email: 'test@example.com',
        message: 'Hello & goodbye',
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
      expect(html).toContain('Hello &amp; goodbye');
    });
  });

  // ────────────────────────────────────────────────
  // buildContactEmailText
  // ────────────────────────────────────────────────

  describe('buildContactEmailText', () => {
    it('includes all fields in plain text', () => {
      const text = service.buildContactEmailText({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+6591234567',
        company: 'Acme Corp',
        message: 'Hello world',
        userType: 'phv_driver',
      });

      expect(text).toContain('Name: John Doe');
      expect(text).toContain('Email: john@example.com');
      expect(text).toContain('Phone: +6591234567');
      expect(text).toContain('Company: Acme Corp');
      expect(text).toContain('Role: PHV Driver');
      expect(text).toContain('Hello world');
    });

    it('shows dash for missing company', () => {
      const text = service.buildContactEmailText({
        name: 'Jane',
        email: 'jane@example.com',
        message: 'Hi',
      });

      expect(text).toContain('Company: -');
      expect(text).toContain('Phone: -');
      expect(text).toContain('Role: -');
    });
  });

  // ────────────────────────────────────────────────
  // processContactSubmission
  // ────────────────────────────────────────────────

  describe('processContactSubmission', () => {
    it('sends email with correct subject and returns sent: true on success', async () => {
      mocks.sendEmail.mockResolvedValue({ success: true });

      const data = {
        name: 'Alice',
        email: 'alice@example.com',
        message: 'Test message',
      };

      const result = await service.processContactSubmission(data);

      expect(result).toEqual({ sent: true });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'shawnleeapps@gmail.com',
          subject: expect.stringContaining('New Contact Form Submission'),
          html: expect.any(String),
          text: expect.any(String),
        })
      );
    });

    it('returns sent: false when email sending fails', async () => {
      mocks.sendEmail.mockResolvedValue({ success: false });

      const data = {
        name: 'Bob',
        email: 'bob@example.com',
        message: 'Help',
      };

      const result = await service.processContactSubmission(data);

      expect(result).toEqual({ sent: false });
    });
  });
});
