import { describe, it, expect } from '@jest/globals';
import {
  buildDncConsentEvidence,
  hasValidDncConsent,
  extractDncConsent,
  DNC_CONSENT_VERSION,
  DNC_CONSENT_CHANNELS,
} from '../../src/services/dncConsent.js';

describe('buildDncConsentEvidence', () => {
  it('returns null when the box was NOT ticked (fail-safe — nothing written, lead stays held)', () => {
    expect(buildDncConsentEvidence(false)).toBeNull();
    expect(buildDncConsentEvidence(undefined)).toBeNull();
    expect(buildDncConsentEvidence(null)).toBeNull();
  });

  it('only true counts — truthy-but-not-true values are rejected', () => {
    expect(buildDncConsentEvidence('true')).toBeNull();
    expect(buildDncConsentEvidence(1)).toBeNull();
  });

  it('builds the full evidence when ticked (consented + version + channels + timestamp + sourceUrl)', () => {
    const ev = buildDncConsentEvidence(true, {
      sourceUrl: 'https://redeem.sg/LeadCapture?campaign_id=abc',
      at: '2026-06-30T08:11:00.000Z',
    });
    expect(ev).toEqual({
      consented: true,
      version: DNC_CONSENT_VERSION,
      consentedAt: '2026-06-30T08:11:00.000Z',
      channels: ['voice', 'text', 'fax'],
      sourceUrl: 'https://redeem.sg/LeadCapture?campaign_id=abc',
    });
  });

  it('includes dncTransactionId when supplied', () => {
    const ev = buildDncConsentEvidence(true, { transactionId: 'TXN-123' });
    expect(ev.dncTransactionId).toBe('TXN-123');
  });

  it('defaults consentedAt to now (parseable ISO) when no timestamp given', () => {
    const before = Date.now();
    const ev = buildDncConsentEvidence(true, { sourceUrl: 'https://mktr.sg/LeadCapture' });
    const t = Date.parse(ev.consentedAt);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
  });

  it('ignores an unparseable `at` and falls back to now (keeps evidence valid)', () => {
    const ev = buildDncConsentEvidence(true, { at: 'not-a-date' });
    expect(Number.isNaN(Date.parse(ev.consentedAt))).toBe(false);
    expect(hasValidDncConsent({ consentMetadata: { dnc: ev } })).toBe(true);
  });

  it('omits sourceUrl / dncTransactionId cleanly when absent or blank (still valid evidence)', () => {
    const ev = buildDncConsentEvidence(true, {});
    expect('sourceUrl' in ev).toBe(false);
    expect('dncTransactionId' in ev).toBe(false);
    expect(buildDncConsentEvidence(true, { sourceUrl: '   ', transactionId: '  ' })).not.toHaveProperty('sourceUrl');
    expect(buildDncConsentEvidence(true, { sourceUrl: '   ', transactionId: '  ' })).not.toHaveProperty('dncTransactionId');
  });

  it('does not share the channels constant by reference (caller cannot mutate it)', () => {
    const ev = buildDncConsentEvidence(true);
    expect(ev.channels).toEqual([...DNC_CONSENT_CHANNELS]);
    expect(ev.channels).not.toBe(DNC_CONSENT_CHANNELS);
  });
});

describe('hasValidDncConsent', () => {
  const goodEv = () => buildDncConsentEvidence(true, { sourceUrl: 'https://redeem.sg/LeadCapture' });

  it('accepts well-formed, consented evidence (Prospect-like, bare meta, and Sequelize get())', () => {
    const ev = goodEv();
    expect(hasValidDncConsent({ consentMetadata: { dnc: ev } })).toBe(true); // plain prospect-like
    expect(hasValidDncConsent({ dnc: ev })).toBe(true); // bare consentMetadata object
    expect(hasValidDncConsent({ get: (k) => (k === 'consentMetadata' ? { dnc: ev } : undefined) })).toBe(true);
  });

  it('rejects when consented !== true even if the rest is well-formed', () => {
    const ev = { ...goodEv(), consented: false };
    expect(hasValidDncConsent({ consentMetadata: { dnc: ev } })).toBe(false);
  });

  it('rejects missing / malformed evidence', () => {
    expect(hasValidDncConsent(null)).toBe(false);
    expect(hasValidDncConsent({})).toBe(false);
    expect(hasValidDncConsent({ consentMetadata: {} })).toBe(false);
    expect(hasValidDncConsent({ consentMetadata: { dnc: { consented: true } } })).toBe(false); // no version/channels/ts
    expect(hasValidDncConsent({ consentMetadata: { dnc: { consented: true, version: '', channels: ['voice'], consentedAt: '2026-06-30T00:00:00Z' } } })).toBe(false);
    expect(hasValidDncConsent({ consentMetadata: { dnc: { consented: true, version: 'v', channels: [], consentedAt: '2026-06-30T00:00:00Z' } } })).toBe(false);
    expect(hasValidDncConsent({ consentMetadata: { dnc: { consented: true, version: 'v', channels: ['voice'], consentedAt: 'nope' } } })).toBe(false);
  });
});

describe('extractDncConsent', () => {
  it('pulls .dnc from each accepted shape, null otherwise', () => {
    const dnc = { consented: true };
    expect(extractDncConsent({ consentMetadata: { dnc } })).toBe(dnc);
    expect(extractDncConsent({ dnc })).toBe(dnc);
    expect(extractDncConsent({ get: (k) => (k === 'consentMetadata' ? { dnc } : undefined) })).toBe(dnc);
    expect(extractDncConsent(null)).toBeNull();
    expect(extractDncConsent({ consentMetadata: { external: {} } })).toBeNull();
  });
});

describe('build ↔ hasValid round-trip contract', () => {
  it('ticked evidence is accepted; unticked => null => rejected', () => {
    const dnc = buildDncConsentEvidence(true);
    expect(hasValidDncConsent({ consentMetadata: { dnc } })).toBe(true);
    const none = buildDncConsentEvidence(false);
    expect(none).toBeNull();
    expect(hasValidDncConsent({ consentMetadata: none ? { dnc: none } : {} })).toBe(false);
  });
});
