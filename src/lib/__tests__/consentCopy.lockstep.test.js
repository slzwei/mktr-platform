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
} from '../../../backend/src/services/contactConsent.js';
import {
  AGREE_ALL_THIRD_PARTY_VERSION,
  AGREE_ALL_THIRD_PARTY_COPY,
} from '../../../backend/src/services/externalConsent.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

describe('agree-all consent copy — frontend/backend lock-step', () => {
  it('one era, one label: frontend version === both backend era labels', () => {
    expect(CONSENT_COPY_VERSION).toBe(AGREE_ALL_CONSENT_VERSION);
    expect(CONSENT_COPY_VERSION).toBe(AGREE_ALL_THIRD_PARTY_VERSION);
  });

  it('contact clause (headline + body) is BYTE-IDENTICAL to the ledger-pinned backend copy', () => {
    const onScreen = `${CONSENT_COPY.clauseContactHeadline} ${CONSENT_COPY.clauseContactBody}`;
    expect(AGREE_ALL_CONTACT_COPY).toBe(onScreen);
    const era = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
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
