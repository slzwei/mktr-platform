import { hasValidExternalConsent, extractExternalConsent } from '../../src/services/externalConsent.js';

const goodExternal = {
  version: 'ext-v1',
  consentedAt: '2026-05-31T08:00:00.000Z',
  channels: ['phone', 'whatsapp'],
  sourceUrl: 'https://redeem.sg/LeadCapture?campaign_id=abc',
};

describe('hasValidExternalConsent', () => {
  it('is false for null/empty/no-consent inputs (inert by default)', () => {
    expect(hasValidExternalConsent(null)).toBe(false);
    expect(hasValidExternalConsent(undefined)).toBe(false);
    expect(hasValidExternalConsent({})).toBe(false);
    expect(hasValidExternalConsent({ consentMetadata: {} })).toBe(false);
    expect(hasValidExternalConsent({ consentMetadata: { external: {} } })).toBe(false);
  });

  it('is true for complete, well-formed external consent', () => {
    expect(hasValidExternalConsent({ consentMetadata: { external: goodExternal } })).toBe(true);
  });

  it('accepts a bare consentMetadata-like object', () => {
    expect(hasValidExternalConsent({ external: goodExternal })).toBe(true);
  });

  it('accepts a Sequelize-like instance via get()', () => {
    const instance = { get: (k) => (k === 'consentMetadata' ? { external: goodExternal } : undefined) };
    expect(hasValidExternalConsent(instance)).toBe(true);
  });

  it('rejects when any required field is missing or malformed', () => {
    expect(hasValidExternalConsent({ consentMetadata: { external: { ...goodExternal, version: '' } } })).toBe(false);
    expect(hasValidExternalConsent({ consentMetadata: { external: { ...goodExternal, channels: [] } } })).toBe(false);
    expect(hasValidExternalConsent({ consentMetadata: { external: { ...goodExternal, channels: 'phone' } } })).toBe(false);
    expect(hasValidExternalConsent({ consentMetadata: { external: { ...goodExternal, consentedAt: 'not-a-date' } } })).toBe(false);
    const { consentedAt, ...noTs } = goodExternal;
    expect(hasValidExternalConsent({ consentMetadata: { external: noTs } })).toBe(false);
  });

  it('"contact me" consent alone does NOT imply external-disclosure consent', () => {
    // consentToContact true but no consentMetadata.external => still false.
    expect(hasValidExternalConsent({ consentToContact: true, consentMetadata: {} })).toBe(false);
  });
});

describe('extractExternalConsent', () => {
  it('returns null when absent and the block when present', () => {
    expect(extractExternalConsent({})).toBeNull();
    expect(extractExternalConsent({ consentMetadata: { external: goodExternal } })).toEqual(goodExternal);
  });
});
