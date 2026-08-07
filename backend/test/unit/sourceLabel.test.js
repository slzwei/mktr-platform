import '../setup.js';
import { signupSourceLabel } from '../../src/utils/sourceLabel.js';

/**
 * Twin contract with mktr-leads receive-mktr-lead/leadSource.ts — the two
 * label helpers must agree. The meta-native guard exists because per-agent
 * Meta forms route via a qrTag: routing plumbing, never a scan (the pilot's
 * first Meta lead labeled itself "QR code", 2026-08-07).
 */
describe('signupSourceLabel (unit)', () => {
  it('meta-native lead with a routing qrTag labels as a Meta ad, not QR', () => {
    expect(signupSourceLabel({
      leadSource: 'social_media',
      qrTag: { slug: 'agent-qr', externalId: 'qr-1' },
      sourceMetadata: { metaLeadgenId: '123', utm: { utm_source: 'meta' } },
    })).toBe('Meta ad');
  });

  it('fb/ig platform names survive the guard path', () => {
    expect(signupSourceLabel({
      leadSource: 'social_media',
      qrTag: { externalId: 'qr-1' },
      sourceMetadata: { metaLeadgenId: '9', utm: { utm_source: 'ig' } },
    })).toBe('Instagram ad');
  });

  it('a real scan (no metaLeadgenId) still labels QR code — even with utm noise', () => {
    expect(signupSourceLabel({
      leadSource: 'website',
      qrTag: { slug: 'shop-window' },
      sourceMetadata: { utm: { utm_source: 'fb' } },
    })).toBe('QR code');
  });

  it('explicit qr_code source without metaLeadgenId stays QR', () => {
    expect(signupSourceLabel({ leadSource: 'qr_code' })).toBe('QR code');
  });

  it('referral still wins over everything', () => {
    expect(signupSourceLabel({
      leadSource: 'referral',
      qrTag: { slug: 'x' },
      sourceMetadata: { metaLeadgenId: '1' },
    })).toBe('Referral');
  });
});
