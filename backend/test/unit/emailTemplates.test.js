import '../setup.js';

import {
  getAgentInviteSubject,
  getAgentInviteEmail,
  getAgentInviteText,
  getRoleInviteSubject,
  getRoleInviteEmail,
  getRoleInviteText,
} from '../../src/services/emailTemplates.js';

// ── Tests ──

describe('emailTemplates (unit)', () => {

  // ────────────────────────────────────────────────
  // getAgentInviteSubject
  // ────────────────────────────────────────────────

  describe('getAgentInviteSubject', () => {
    it('returns subject with default company name', () => {
      const subject = getAgentInviteSubject();

      expect(subject).toContain('MKTR');
      expect(subject).toContain('Agent');
    });

    it('uses custom company name', () => {
      const subject = getAgentInviteSubject('Acme Corp');

      expect(subject).toContain('Acme Corp');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentInviteEmail
  // ────────────────────────────────────────────────

  describe('getAgentInviteEmail', () => {
    it('includes the invite link', () => {
      const html = getAgentInviteEmail({
        firstName: 'Alice',
        inviteLink: 'https://app.mktr.sg/invite/abc123',
      });

      expect(html).toContain('https://app.mktr.sg/invite/abc123');
    });

    it('includes the recipient first name', () => {
      const html = getAgentInviteEmail({
        firstName: 'Bob',
        inviteLink: 'https://example.com',
      });

      expect(html).toContain('Hi Bob');
    });

    it('uses default first name when not provided', () => {
      const html = getAgentInviteEmail({ inviteLink: 'https://example.com' });

      expect(html).toContain('Hi there');
    });

    it('includes expiry days', () => {
      const html = getAgentInviteEmail({
        inviteLink: 'https://example.com',
        expiryDays: 14,
      });

      expect(html).toContain('14 days');
    });

    it('defaults to 7 day expiry', () => {
      const html = getAgentInviteEmail({
        inviteLink: 'https://example.com',
      });

      expect(html).toContain('7 days');
    });

    it('includes company name', () => {
      const html = getAgentInviteEmail({
        inviteLink: 'https://example.com',
        companyName: 'TestCorp',
      });

      expect(html).toContain('TestCorp');
    });

    it('includes Accept Invitation button', () => {
      const html = getAgentInviteEmail({
        inviteLink: 'https://example.com/invite',
      });

      expect(html).toContain('Accept Invitation');
    });

    it('produces valid HTML structure', () => {
      const html = getAgentInviteEmail({
        inviteLink: 'https://example.com',
      });

      expect(html).toContain('<!doctype html>');
      expect(html).toContain('</html>');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentInviteText
  // ────────────────────────────────────────────────

  describe('getAgentInviteText', () => {
    it('includes invite link in plain text', () => {
      const text = getAgentInviteText({
        firstName: 'Carol',
        inviteLink: 'https://app.mktr.sg/invite/xyz',
      });

      expect(text).toContain('https://app.mktr.sg/invite/xyz');
      expect(text).toContain('Carol');
    });

    it('includes expiry days', () => {
      const text = getAgentInviteText({
        inviteLink: 'https://example.com',
        expiryDays: 3,
      });

      expect(text).toContain('3 days');
    });
  });

  // ────────────────────────────────────────────────
  // getRoleInviteSubject
  // ────────────────────────────────────────────────

  describe('getRoleInviteSubject', () => {
    it('returns subject with role label', () => {
      const subject = getRoleInviteSubject({ roleLabel: 'Fleet Owner' });

      expect(subject).toContain('Fleet Owner');
    });

    it('defaults to User role label', () => {
      const subject = getRoleInviteSubject();

      expect(subject).toContain('User');
    });
  });

  // ────────────────────────────────────────────────
  // getRoleInviteEmail
  // ────────────────────────────────────────────────

  describe('getRoleInviteEmail', () => {
    it('includes role label in the email body', () => {
      const html = getRoleInviteEmail({
        firstName: 'Dave',
        inviteLink: 'https://example.com/invite',
        roleLabel: 'Driver Partner',
      });

      expect(html).toContain('Driver Partner');
      expect(html).toContain('Hi Dave');
    });

    it('includes invite link', () => {
      const html = getRoleInviteEmail({
        inviteLink: 'https://example.com/invite/abc',
        roleLabel: 'Agent',
      });

      expect(html).toContain('https://example.com/invite/abc');
    });

    it('handles custom company URL', () => {
      const html = getRoleInviteEmail({
        inviteLink: 'https://example.com',
        companyUrl: 'https://mycorp.com',
      });

      expect(html).toContain('https://mycorp.com');
    });
  });

  // ────────────────────────────────────────────────
  // getRoleInviteText
  // ────────────────────────────────────────────────

  describe('getRoleInviteText', () => {
    it('includes role label in plain text', () => {
      const text = getRoleInviteText({
        firstName: 'Eve',
        inviteLink: 'https://example.com',
        roleLabel: 'Fleet Owner',
      });

      expect(text).toContain('Fleet Owner');
      expect(text).toContain('Eve');
    });

    it('defaults to User role label', () => {
      const text = getRoleInviteText({ inviteLink: 'https://example.com' });

      expect(text).toContain('User');
    });

    it('defaults first name to there', () => {
      const text = getRoleInviteText({ inviteLink: 'https://example.com' });

      expect(text).toContain('Hi there');
    });

    it('includes expiry days', () => {
      const text = getRoleInviteText({
        inviteLink: 'https://example.com',
        expiryDays: 14,
      });

      expect(text).toContain('14 days');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentInviteEmail security
  // ────────────────────────────────────────────────

  describe('getAgentInviteEmail (security)', () => {
    it('handles empty invite link gracefully', () => {
      const html = getAgentInviteEmail({ inviteLink: '' });

      expect(html).toContain('<!doctype html>');
    });

    it('handles undefined invite link gracefully', () => {
      const html = getAgentInviteEmail({});

      expect(html).toContain('<!doctype html>');
    });

    it('includes copyright year', () => {
      const html = getAgentInviteEmail({ inviteLink: 'https://test.com' });
      const currentYear = new Date().getFullYear().toString();

      expect(html).toContain(currentYear);
    });
  });

  // ────────────────────────────────────────────────
  // getRoleInviteEmail consistency
  // ────────────────────────────────────────────────

  describe('getRoleInviteEmail (consistency)', () => {
    it('includes copyright year', () => {
      const html = getRoleInviteEmail({ inviteLink: 'https://test.com' });
      const currentYear = new Date().getFullYear().toString();

      expect(html).toContain(currentYear);
    });

    it('defaults companyUrl to example.com', () => {
      const html = getRoleInviteEmail({ inviteLink: 'https://test.com' });

      expect(html).toContain('https://example.com');
    });

    it('defaults companyName to MKTR', () => {
      const html = getRoleInviteEmail({ inviteLink: 'https://test.com' });

      expect(html).toContain('MKTR');
    });
  });
});
