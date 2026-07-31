import { jest } from '@jest/globals';
import { resolveConsentCopy } from '../../src/services/consentCopyRegistry.js';
import {
  CONTACT_CONSENT_VERSION, AGREE_ALL_CONSENT_VERSION, AGREE_ALL_CONTACT_COPY,
} from '../../src/services/contactConsent.js';
import { AGREE_ALL_THIRD_PARTY_COPY } from '../../src/services/externalConsent.js';

/**
 * Consent-version → wording resolver (admin lead-profile click-through).
 * The agree-all label carries TWO clauses (contact + sponsor sharing) under
 * one version string; legacy contact is single-clause; uuids resolve pinned
 * draw terms via the DI'd model; everything else is honestly null.
 */

describe('resolveConsentCopy', () => {
  it('resolves the agree-all label to BOTH of its clauses', async () => {
    const out = await resolveConsentCopy(AGREE_ALL_CONSENT_VERSION);
    expect(out.version).toBe(AGREE_ALL_CONSENT_VERSION);
    expect(out.clauses.map((c) => c.kind)).toEqual(['contact', 'third_party']);
    expect(out.clauses[0].copy).toBe(AGREE_ALL_CONTACT_COPY);
    expect(out.clauses[1].copy).toBe(AGREE_ALL_THIRD_PARTY_COPY);
    expect(out.clauses[0].channels).toContain('whatsapp');
  });

  it('resolves the legacy contact era to its single clause', async () => {
    const out = await resolveConsentCopy(CONTACT_CONSENT_VERSION);
    expect(out.clauses).toHaveLength(1);
    expect(out.clauses[0]).toMatchObject({ kind: 'contact', scope: 'campaign' });
  });

  it('resolves a uuid to pinned draw terms through the model', async () => {
    const findByPk = jest.fn(async () => ({ content: '<p>Terms HTML</p>', createdAt: new Date('2026-07-12') }));
    const out = await resolveConsentCopy('2b9f8a70-1111-4222-8333-444455556666', { DrawTermsVersion: { findByPk } });
    expect(findByPk).toHaveBeenCalledWith('2b9f8a70-1111-4222-8333-444455556666');
    expect(out.clauses[0]).toMatchObject({ kind: 'draw_terms', format: 'html', copy: '<p>Terms HTML</p>' });
  });

  it('returns null for unknown labels, missing uuids and junk', async () => {
    const findByPk = jest.fn(async () => null);
    expect(await resolveConsentCopy('never-registered-era', { DrawTermsVersion: { findByPk } })).toBeNull();
    expect(await resolveConsentCopy('2b9f8a70-1111-4222-8333-444455556666', { DrawTermsVersion: { findByPk } })).toBeNull();
    expect(await resolveConsentCopy('', { DrawTermsVersion: { findByPk } })).toBeNull();
    expect(await resolveConsentCopy('x'.repeat(200), { DrawTermsVersion: { findByPk } })).toBeNull();
  });
});
