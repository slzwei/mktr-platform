import { describe, it, expect } from '@jest/globals';
import { scrubObject, scrubEvent, scrubBreadcrumb, scrubText } from '../src/utils/sentryScrub.js';

describe('sentryScrub', () => {
  describe('scrubObject', () => {
    it('redacts top-level PII keys (case-insensitive substring match)', () => {
      const input = {
        agentPhone: '+6591234567',
        lead_email: 'a@b.com',
        staff_full_name: 'Jane Doe',
        nric: 'S1234567A',
        access_token: 'abc',
        jwt: 'xyz',
        homeAddress: '123 Main',
        otpCode: '999999',
        password_hash: 'pw',
        keep: 'me',
      };
      const out = scrubObject(input);
      expect(out.agentPhone).toBe('[redacted]');
      expect(out.lead_email).toBe('[redacted]');
      expect(out.staff_full_name).toBe('[redacted]');
      expect(out.nric).toBe('[redacted]');
      expect(out.access_token).toBe('[redacted]');
      expect(out.jwt).toBe('[redacted]');
      expect(out.homeAddress).toBe('[redacted]');
      expect(out.otpCode).toBe('[redacted]');
      expect(out.password_hash).toBe('[redacted]');
      expect(out.keep).toBe('me');
    });

    it('recurses into nested objects', () => {
      const out = scrubObject({ outer: { phone: '+65', value: 1 } });
      expect(out.outer.phone).toBe('[redacted]');
      expect(out.outer.value).toBe(1);
    });

    it('walks arrays of objects', () => {
      const out = scrubObject({ list: [{ email: 'a@b' }, { value: 2 }] });
      expect(out.list[0].email).toBe('[redacted]');
      expect(out.list[1].value).toBe(2);
    });

    it('passes through primitives and null/undefined', () => {
      expect(scrubObject(null)).toBe(null);
      expect(scrubObject(undefined)).toBe(undefined);
      expect(scrubObject(42)).toBe(42);
      expect(scrubObject('hi')).toBe('hi');
    });
  });

  describe('scrubEvent', () => {
    it('scrubs extra/tags/contexts/request.data and strips user to id only', () => {
      const event = {
        extra: { agentPhone: '+65', kept: 1 },
        tags: { user_email: 'a@b' },
        contexts: { trace: { name: 'op' } },
        request: { data: { name: 'Jane', value: 2 } },
        user: { id: 'u1', email: 'a@b', ip_address: '1.2.3.4' },
      };
      const out = scrubEvent(event);
      expect(out.extra.agentPhone).toBe('[redacted]');
      expect(out.extra.kept).toBe(1);
      expect(out.tags.user_email).toBe('[redacted]');
      expect(out.contexts.trace.name).toBe('[redacted]');
      expect(out.request.data.name).toBe('[redacted]');
      expect(out.request.data.value).toBe(2);
      expect(out.user).toEqual({ id: 'u1' });
    });

    it('returns the event unchanged when fields are absent', () => {
      const event = {};
      expect(scrubEvent(event)).toBe(event);
    });

    it('handles null/undefined event input', () => {
      expect(scrubEvent(null)).toBe(null);
      expect(scrubEvent(undefined)).toBe(undefined);
    });
  });

  describe('scrubBreadcrumb', () => {
    it('scrubs breadcrumb.data', () => {
      const breadcrumb = { category: 'http', data: { phone: '+65', code: 200 } };
      const out = scrubBreadcrumb(breadcrumb);
      expect(out.data.phone).toBe('[redacted]');
      expect(out.data.code).toBe(200);
    });

    it('returns crumb unchanged when no data', () => {
      const crumb = { category: 'http' };
      expect(scrubBreadcrumb(crumb)).toBe(crumb);
    });
  });

  /**
   * P2-11. scrubObject matches KEY NAMES, and scrubEvent never touched
   * event.message or event.exception at all — so an identifier interpolated
   * into a thrown Error ("User a@b.com not found") reached Sentry verbatim, and
   * the same string reached pino, which sits OUTSIDE the PDPA erasure matrix.
   * A key-based scrubber cannot help when the identifier is inside a sentence.
   */
  describe('scrubText — value-level PII in free text', () => {
    it.each([
      ['User shawn@example.com not found', 'User [email] not found'],
      ['Lead +65 9123 4567 blocked', 'Lead [phone] blocked'],
      ['dial +6591234567 failed', 'dial [phone] failed'],
      ['holder 6591234567 duplicate', 'holder [phone] duplicate'],
      ['sms to 91234567 bounced', 'sms to [phone] bounced'],
      ['display 9123 4567 rejected', 'display [phone] rejected'],
      ['NRIC S1234567A rejected', 'NRIC [nric] rejected'],
    ])('redacts %s', (input, expected) => {
      expect(scrubText(input)).toBe(expected);
    });

    it('still masks URL-borne credentials', () => {
      expect(scrubText('GET /api/reward-claim/live-secret failed'))
        .toBe('GET /api/reward-claim/[token] failed');
    });

    it('leaves non-identifier numbers alone', () => {
      expect(scrubText('deleted 12345678 rows')).toBe('deleted 12345678 rows');
      expect(scrubText('order 4567 of 8')).toBe('order 4567 of 8');
      expect(scrubText('no pii here, id 42')).toBe('no pii here, id 42');
    });

    it('passes non-strings through untouched', () => {
      expect(scrubText(undefined)).toBeUndefined();
      expect(scrubText(null)).toBeNull();
      expect(scrubText(42)).toBe(42);
    });
  });

  describe('scrubEvent — exception values and message (P2-11)', () => {
    it('scrubs an identifier thrown inside an Error message', () => {
      const event = scrubEvent({
        exception: {
          values: [{ type: 'AppError', value: 'Lead shawn@example.com (+65 9123 4567) not found' }],
        },
      });
      expect(event.exception.values[0].value).toBe('Lead [email] ([phone]) not found');
      // The class name is not PII and stays readable.
      expect(event.exception.values[0].type).toBe('AppError');
    });

    it('scrubs event.message', () => {
      const event = scrubEvent({ message: 'failed for a@b.com' });
      expect(event.message).toBe('failed for [email]');
    });

    it('handles events with no exception/message', () => {
      expect(() => scrubEvent({ extra: { keep: 1 } })).not.toThrow();
      expect(scrubEvent({ exception: { values: [] } }).exception.values).toEqual([]);
    });
  });

  describe('scrubBreadcrumb — message PII (P2-11)', () => {
    it('redacts an identifier in the breadcrumb text, not just the URL', () => {
      const out = scrubBreadcrumb({ message: 'sent otp to +6591234567 via /r/tok3n' });
      expect(out.message).toBe('sent otp to [phone] via /r/[token]');
    });
  });
});
