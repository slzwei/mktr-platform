import { describe, it, expect } from '@jest/globals';
import {
  buildExternalConsentEvidence,
  hasValidExternalConsent,
  THIRD_PARTY_CONSENT_VERSION,
  THIRD_PARTY_CONSENT_CHANNELS,
  AGREE_ALL_THIRD_PARTY_VERSION,
  AGREE_ALL_THIRD_PARTY_COPY,
} from '../src/services/externalConsent.js';

describe('buildExternalConsentEvidence', () => {
  it('returns null when the box was NOT ticked (fail-safe — nothing written)', () => {
    expect(buildExternalConsentEvidence(false)).toBeNull();
    expect(buildExternalConsentEvidence(undefined)).toBeNull();
    expect(buildExternalConsentEvidence(null)).toBeNull();
  });

  it('only true counts — truthy-but-not-true values are rejected', () => {
    // Guards against a stale client sending "true"/1 instead of a real boolean.
    expect(buildExternalConsentEvidence('true')).toBeNull();
    expect(buildExternalConsentEvidence(1)).toBeNull();
  });

  it('builds the full evidence when ticked (version + channels + timestamp + sourceUrl)', () => {
    const ev = buildExternalConsentEvidence(true, {
      sourceUrl: 'https://redeem.sg/t/some-campaign',
      at: '2026-06-26T08:11:00.000Z',
    });
    expect(ev).toEqual({
      version: THIRD_PARTY_CONSENT_VERSION,
      consentedAt: '2026-06-26T08:11:00.000Z',
      channels: ['phone', 'whatsapp', 'email'],
      sourceUrl: 'https://redeem.sg/t/some-campaign',
    });
  });

  it('defaults consentedAt to now (parseable ISO) when no timestamp given', () => {
    const before = Date.now();
    const ev = buildExternalConsentEvidence(true, { sourceUrl: 'https://mktr.sg/LeadCapture' });
    const t = Date.parse(ev.consentedAt);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
  });

  it('ignores an unparseable `at` and falls back to now (keeps evidence valid)', () => {
    const ev = buildExternalConsentEvidence(true, { at: 'not-a-date' });
    expect(Number.isNaN(Date.parse(ev.consentedAt))).toBe(false);
    expect(hasValidExternalConsent({ consentMetadata: { external: ev } })).toBe(true);
  });

  it('omits sourceUrl cleanly when absent or blank (still valid evidence)', () => {
    const ev = buildExternalConsentEvidence(true, {});
    expect('sourceUrl' in ev).toBe(false);
    expect(buildExternalConsentEvidence(true, { sourceUrl: '   ' })).not.toHaveProperty('sourceUrl');
  });

  it('does not share the channels constant by reference (caller cannot mutate it)', () => {
    const ev = buildExternalConsentEvidence(true);
    expect(ev.channels).toEqual([...THIRD_PARTY_CONSENT_CHANNELS]);
    expect(ev.channels).not.toBe(THIRD_PARTY_CONSENT_CHANNELS);
  });

  it('stamps a KNOWN wording-era override (agree-all block) and keeps evidence valid', () => {
    const ev = buildExternalConsentEvidence(true, { version: AGREE_ALL_THIRD_PARTY_VERSION });
    expect(ev.version).toBe(AGREE_ALL_THIRD_PARTY_VERSION);
    expect(hasValidExternalConsent({ consentMetadata: { external: ev } })).toBe(true);
    expect(AGREE_ALL_THIRD_PARTY_COPY.length).toBeGreaterThan(0);
  });

  it('an unknown/absent version override falls back to the default era', () => {
    expect(buildExternalConsentEvidence(true, { version: '2026-01-01' }).version)
      .toBe(THIRD_PARTY_CONSENT_VERSION);
    expect(buildExternalConsentEvidence(true, { version: 42 }).version)
      .toBe(THIRD_PARTY_CONSENT_VERSION);
    expect(buildExternalConsentEvidence(true, {}).version)
      .toBe(THIRD_PARTY_CONSENT_VERSION);
  });
});

describe('buildExternalConsentEvidence ↔ hasValidExternalConsent (round-trip contract)', () => {
  it('ticked evidence is accepted by the gate', () => {
    const external = buildExternalConsentEvidence(true, { sourceUrl: 'https://redeem.sg/t/x' });
    expect(hasValidExternalConsent({ consentMetadata: { external } })).toBe(true);
  });

  it('ticked evidence with no sourceUrl is still accepted (sourceUrl is optional)', () => {
    const external = buildExternalConsentEvidence(true);
    expect(hasValidExternalConsent({ consentMetadata: { external } })).toBe(true);
  });

  it('unticked => null => gate stays false (never external)', () => {
    const external = buildExternalConsentEvidence(false);
    expect(external).toBeNull();
    expect(hasValidExternalConsent({ consentMetadata: external ? { external } : {} })).toBe(false);
  });
});
