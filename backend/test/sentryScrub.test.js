import { describe, it, expect } from '@jest/globals';
import { scrubObject, scrubEvent, scrubBreadcrumb } from '../src/utils/sentryScrub.js';

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
});
