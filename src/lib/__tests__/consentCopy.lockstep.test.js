/**
 * Consent-copy LOCK-STEP (tracker "copyhash") — imports the frontend copy
 * module AND the backend evidence constants; fails the build if the on-screen
 * wording and the ledger-pinned copy ever drift apart. Pattern:
 * designConfigV2.lockstep.test.js (frontend Vitest importing backend source).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { CONSENT_COPY, CONSENT_COPY_VERSION } from '../consentCopy.js';
import {
  CONTACT_CONSENT_VERSIONS,
  AGREE_ALL_CONSENT_VERSION,
  AGREE_ALL_CONTACT_COPY,
  AGREE_ALL_CONSENT_VERSION_V2,
  AGREE_ALL_CONTACT_COPY_V2,
  AGREE_ALL_CONSENT_VERSION_V3,
} from '../../../backend/src/services/contactConsent.js';
import {
  AGREE_ALL_THIRD_PARTY_VERSION,
  AGREE_ALL_THIRD_PARTY_VERSION_V2,
  AGREE_ALL_THIRD_PARTY_VERSION_V3,
  AGREE_ALL_THIRD_PARTY_COPY,
} from '../../../backend/src/services/externalConsent.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

describe('agree-all consent copy — frontend/backend lock-step', () => {
  it('one era, one label: frontend version === both backend era labels', () => {
    expect(CONSENT_COPY_VERSION).toBe(AGREE_ALL_CONSENT_VERSION_V3);
    expect(CONSENT_COPY_VERSION).toBe(AGREE_ALL_THIRD_PARTY_VERSION_V3);
  });

  it('the CLOSED v1 era is still registered, byte-untouched (evidence keeps meaning)', () => {
    const v1 = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
    expect(v1.copy).toBe(AGREE_ALL_CONTACT_COPY);
    expect(v1.copy).toContain('MKTR Pte. Ltd.');
    expect(AGREE_ALL_THIRD_PARTY_VERSION).toBe('2026-07-21-agree-all-v1');
  });

  it('the CLOSED v2 era is still registered, byte-untouched', () => {
    const v2 = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION_V2];
    expect(v2.copy).toBe(AGREE_ALL_CONTACT_COPY_V2);
    expect(AGREE_ALL_THIRD_PARTY_VERSION_V2).toBe('2026-08-19-agree-all-v2');
  });

  it('v2 changed ONLY the entity casing in the contact clause', () => {
    expect(AGREE_ALL_CONTACT_COPY_V2).toBe(AGREE_ALL_CONTACT_COPY.replace('MKTR Pte. Ltd.', 'MKTR PTE. LTD.'));
  });

  it("v3 changed ONLY the dialog intro — clause bytes are v2's, and the intro no longer claims to be short", () => {
    expect(CONSENT_COPY.intro).toBe('By submitting this form, you agree to the following:');
    const v3 = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION_V3];
    expect(v3.copy).toBe(AGREE_ALL_CONTACT_COPY_V2);
    expect(v3.copyHash).toBe(CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION_V2].copyHash);
  });

  it('contact clause (headline + body) is BYTE-IDENTICAL to the ledger-pinned backend copy', () => {
    const onScreen = `${CONSENT_COPY.clauseContactHeadline} ${CONSENT_COPY.clauseContactBody}`;
    expect(AGREE_ALL_CONTACT_COPY_V2).toBe(onScreen);
    const era = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION_V3];
    expect(era.copy).toBe(onScreen);
    expect(era.copyHash).toBe(sha256(onScreen));
    expect(era.scope).toBe('brand');
    // The copy says "(SMS or WhatsApp)" — the recorded channels must agree.
    expect([...era.channels]).toEqual(['phone', 'text', 'whatsapp', 'email']);
  });

  it('third-party clause (headline + body) is BYTE-IDENTICAL to the external-evidence backend copy', () => {
    const onScreen = `${CONSENT_COPY.clauseThirdPartyHeadline} ${CONSENT_COPY.clauseThirdPartyBody}`;
    expect(AGREE_ALL_THIRD_PARTY_COPY).toBe(onScreen);
  });

  it('terms clause reassembles into a complete sentence around the modal link', () => {
    const joined = CONSENT_COPY.clauseTermsPrefix
      + CONSENT_COPY.clauseTermsLinkText
      + CONSENT_COPY.clauseTermsSuffix;
    expect(joined).toBe("You agree to the campaign's terms & conditions.");
  });

  it('every user-visible string is frozen and non-empty', () => {
    expect(Object.isFrozen(CONSENT_COPY)).toBe(true);
    for (const [key, value] of Object.entries(CONSENT_COPY)) {
      expect(typeof value, key).toBe('string');
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});
