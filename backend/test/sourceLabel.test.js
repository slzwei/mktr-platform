import { signupSourcePhrase, signupActivityDescription, signupSourceLabel } from '../src/utils/sourceLabel.js';

describe('signupSourcePhrase', () => {
  describe('QR scans', () => {
    it('uses the QR tag name', () => {
      expect(signupSourcePhrase({ leadSource: 'qr_code', qrTag: { name: 'Marina Bay' } })).toBe(
        'via Marina Bay QR code'
      );
    });
    it('falls back to the QR tag label', () => {
      expect(signupSourcePhrase({ leadSource: 'qr_code', qrTag: { label: 'Booth A' } })).toBe(
        'via Booth A QR code'
      );
    });
    it('handles a bound tag with no name/label', () => {
      expect(signupSourcePhrase({ leadSource: 'qr_code', qrTag: {} })).toBe('via QR code');
    });
    it('handles leadSource qr_code with no tag (deleted QR)', () => {
      expect(signupSourcePhrase({ leadSource: 'qr_code', qrTag: null })).toBe('via QR code');
    });
  });

  describe('referral', () => {
    it('names the referrer when known', () => {
      expect(
        signupSourcePhrase({ leadSource: 'referral', sourceMetadata: { referral: { referrerName: 'Jane Tan' } } })
      ).toBe('via referral from Jane Tan');
    });
    it('falls back to plain referral when name unknown', () => {
      expect(signupSourcePhrase({ leadSource: 'referral', sourceMetadata: { referral: {} } })).toBe('via referral');
    });
    it('wins over a stale UTM capture (explicit intent)', () => {
      expect(
        signupSourcePhrase({
          leadSource: 'referral',
          sourceMetadata: { utm: { utm_source: 'tiktok' }, referral: { referrerName: 'Bob' } },
        })
      ).toBe('via referral from Bob');
    });
  });

  describe('voice call', () => {
    it('labels call_bot leads', () => {
      expect(signupSourcePhrase({ leadSource: 'call_bot' })).toBe('via voice call');
    });
  });

  describe('paid ads (utm_source)', () => {
    it('TikTok (the reported bug — was "Unknown QR")', () => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'tiktok' } } })).toBe(
        'via TikTok ad'
      );
    });
    it.each(['tt', 'tiktok_ads', 'tiktok-ads', 'TikTokAds'])('TikTok alias %s', (src) => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { utm: { utm_source: src } } })).toBe(
        'via TikTok ad'
      );
    });
    it.each(['facebook', 'fb', 'instagram', 'ig', 'meta'])('Meta alias %s', (src) => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { utm: { utm_source: src } } })).toBe(
        'via Meta ad'
      );
    });
    it('title-cases an unknown utm_source', () => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'google' } } })).toBe(
        'via Google ad'
      );
    });
  });

  describe('click-ids only (no utm) → "click", not "ad"', () => {
    it('ttclid → TikTok click', () => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { ttclid: 'abc' } })).toBe('via TikTok click');
    });
    it('fbc → Meta click', () => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { fbc: 'fb.1.x' } })).toBe('via Meta click');
    });
    it('fbclid in eventSourceUrl → Meta click', () => {
      expect(
        signupSourcePhrase({ leadSource: 'website', sourceMetadata: { eventSourceUrl: 'https://redeem.sg/LeadCapture?fbclid=z' } })
      ).toBe('via Meta click');
    });
    it('ttclid in eventSourceUrl → TikTok click', () => {
      expect(
        signupSourcePhrase({ leadSource: 'website', sourceMetadata: { eventSourceUrl: 'https://redeem.sg/LeadCapture?ttclid=z' } })
      ).toBe('via TikTok click');
    });
    it('Meta wins when both click-ids present', () => {
      expect(signupSourcePhrase({ leadSource: 'website', sourceMetadata: { fbc: 'fb.1.x', ttclid: 'abc' } })).toBe(
        'via Meta click'
      );
    });
    it('utm beats a bare click-id', () => {
      expect(
        signupSourcePhrase({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'tiktok' }, ttclid: 'abc' } })
      ).toBe('via TikTok ad');
    });
  });

  describe('plain form / fallback', () => {
    it('website with no attribution → web form', () => {
      expect(signupSourcePhrase({ leadSource: 'website' })).toBe('via web form');
    });
    it('missing leadSource → web form', () => {
      expect(signupSourcePhrase({})).toBe('via web form');
      expect(signupSourcePhrase()).toBe('via web form');
    });
    it('other source surfaces readably', () => {
      expect(signupSourcePhrase({ leadSource: 'lead_import' })).toBe('via lead import');
    });
  });
});

describe('signupActivityDescription', () => {
  it('builds the full line for the reported TikTok lead', () => {
    expect(
      signupActivityDescription('Redeem $10 Fairprice Voucher', {
        leadSource: 'website',
        sourceMetadata: { utm: { utm_source: 'tiktok' } },
      })
    ).toBe('Prospect signed up for Redeem $10 Fairprice Voucher campaign via TikTok ad');
  });
  it('falls back to Unknown Campaign', () => {
    expect(signupActivityDescription(null, { leadSource: 'website' })).toBe(
      'Prospect signed up for Unknown Campaign campaign via web form'
    );
  });
  it('clamps to 255 chars (column is STRING(255)) for a long campaign + utm_source', () => {
    const desc = signupActivityDescription('C'.repeat(100), {
      leadSource: 'website',
      sourceMetadata: { utm: { utm_source: 'x'.repeat(128) } },
    });
    expect(desc.length).toBeLessThanOrEqual(255);
  });
});

// Short label for the held-queue detail view. Mirrors the mktr-leads receiver's
// deriveLeadSource().label so a held lead reads the SAME source it'll show once delivered.
describe('signupSourceLabel', () => {
  it('splits Facebook vs Instagram (the phrase helper lumps them as Meta)', () => {
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'fb' } } })).toBe('Facebook ad');
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'instagram' } } })).toBe(
      'Instagram ad'
    );
  });

  it.each(['meta', 'an', 'audience_network', 'msg', 'messenger'])('rolls Meta sub-network %s up to "Meta ad"', (src) => {
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { utm: { utm_source: src } } })).toBe('Meta ad');
  });

  it.each(['tiktok', 'tt', 'tiktok_ads', 'TikTokAds'])('labels TikTok alias %s', (src) => {
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { utm: { utm_source: src } } })).toBe('TikTok ad');
  });

  it('title-cases an unknown utm_source', () => {
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'google' } } })).toBe(
      'Google ad'
    );
  });

  it('click-ids only → "{platform} click", not an ad', () => {
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { ttclid: 'x' } })).toBe('TikTok click');
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { fbc: 'fb.1.x' } })).toBe('Meta click');
  });

  it('referral / QR / voice / web-form / unknown', () => {
    expect(signupSourceLabel({ leadSource: 'referral' })).toBe('Referral');
    expect(signupSourceLabel({ leadSource: 'qr_code' })).toBe('QR code');
    // Bound QR tag wins even when leadSource is the coarse 'website' (receiver parity).
    expect(signupSourceLabel({ leadSource: 'website', qrTag: { slug: 'booth-a' } })).toBe('QR code');
    expect(signupSourceLabel({ leadSource: 'call_bot' })).toBe('Voice call');
    expect(signupSourceLabel({ leadSource: 'website' })).toBe('Web form');
    expect(signupSourceLabel({})).toBe('Web form');
    expect(signupSourceLabel({ leadSource: 'lead_import' })).toBe('Lead Import');
  });

  it('the reported case: a "website" capture off an Instagram ad reads "Instagram ad", not "Website"', () => {
    expect(signupSourceLabel({ leadSource: 'website', sourceMetadata: { utm: { utm_source: 'ig' } } })).toBe(
      'Instagram ad'
    );
  });
});
