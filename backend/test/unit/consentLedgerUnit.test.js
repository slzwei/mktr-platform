import '../setup.js';
import { buildUserRows } from '../../src/services/redeemedAudienceService.js';
import { unsubTokenFor, unsubTokenHashOf } from '../../src/services/consentService.js';
import {
  CONTACT_CONSENT_VERSION, CONTACT_CONSENT_COPY, CONTACT_CONSENT_COPY_HASH, CONTACT_CONSENT_CHANNELS,
  CONTACT_CONSENT_VERSIONS, AGREE_ALL_CONSENT_VERSION, isKnownConsentCopyVersion,
} from '../../src/services/contactConsent.js';
import { createHash } from 'crypto';

describe('audience rows — fail-closed suppression BY PHONE (Codex R1 #12)', () => {
  const consented = (phone, email = 'a@b.co') => ({
    phone, email, sourceMetadata: { consent_contact: true },
  });

  test('suppressed phones are dropped even when the row is spine-unlinked', () => {
    const suppressed = new Set(['+6591112222']);
    const rows = buildUserRows(
      [consented('+6591112222'), consented('+6593334444')],
      { requireConsent: true, suppressedPhones: suppressed }
    );
    expect(rows).toHaveLength(1); // only the non-suppressed person survives
  });

  test('no suppression set → behavior unchanged (back-compat)', () => {
    const rows = buildUserRows([consented('+6591112222')], { requireConsent: true });
    expect(rows).toHaveLength(1);
  });
});

describe('unsubscribe token', () => {
  test('deterministic per consumer, hash-addressable, secret-dependent', () => {
    const a1 = unsubTokenFor('11111111-1111-4111-8111-111111111111');
    const a2 = unsubTokenFor('11111111-1111-4111-8111-111111111111');
    const b = unsubTokenFor('22222222-2222-4222-8222-222222222222');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(unsubTokenHashOf(a1)).toBe(createHash('sha256').update(a1).digest('hex'));
  });
});

describe('contact consent contract', () => {
  test('version, copy hash, and channels are pinned together', () => {
    expect(CONTACT_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CONTACT_CONSENT_COPY_HASH).toBe(createHash('sha256').update(CONTACT_CONSENT_COPY).digest('hex'));
    expect(CONTACT_CONSENT_CHANNELS).toEqual(['phone', 'text', 'email']);
  });

  test('registry: every era pins a recomputable hash + scope; legacy stays the default', () => {
    for (const [version, era] of Object.entries(CONTACT_CONSENT_VERSIONS)) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?$/);
      expect(era.copyHash).toBe(createHash('sha256').update(era.copy).digest('hex'));
      expect(['campaign', 'brand']).toContain(era.scope);
      expect(era.channels.length).toBeGreaterThan(0);
    }
    // Legacy entry is the CONTACT_CONSENT_* constants verbatim (closed era).
    expect(CONTACT_CONSENT_VERSIONS[CONTACT_CONSENT_VERSION].copy).toBe(CONTACT_CONSENT_COPY);
    expect(CONTACT_CONSENT_VERSIONS[CONTACT_CONSENT_VERSION].scope).toBe('campaign');
    // Agree-all era is brand-scoped and a distinct wording.
    const agreeAll = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
    expect(agreeAll.scope).toBe('brand');
    expect(agreeAll.copy).not.toBe(CONTACT_CONSENT_COPY);
  });

  test('isKnownConsentCopyVersion: registry labels only, prototype keys never', () => {
    expect(isKnownConsentCopyVersion(AGREE_ALL_CONSENT_VERSION)).toBe(true);
    expect(isKnownConsentCopyVersion(CONTACT_CONSENT_VERSION)).toBe(true);
    expect(isKnownConsentCopyVersion('2026-01-01')).toBe(false);
    expect(isKnownConsentCopyVersion('toString')).toBe(false);
    expect(isKnownConsentCopyVersion(undefined)).toBe(false);
  });
});
