import { describe, it, expect } from 'vitest';
import { brand } from '@/lib/brand';
import {
  deriveLeadCaptureContent,
  brandFromCampaignName,
  paragraphsFromText,
} from '@/components/campaigns/leadCaptureContent';

describe('brandFromCampaignName', () => {
  it('takes the first significant word and appends .sg', () => {
    expect(brandFromCampaignName('Goodies — Free Luggage')).toBe('goodies.sg');
    expect(brandFromCampaignName('Acme Roadshow 2026')).toBe('acme.sg');
  });

  it('returns null for empty input', () => {
    expect(brandFromCampaignName('')).toBeNull();
    expect(brandFromCampaignName(null)).toBeNull();
  });
});

describe('paragraphsFromText', () => {
  it('splits on blank lines and trims', () => {
    expect(paragraphsFromText('one\n\ntwo\n\n  three  ')).toEqual(['one', 'two', 'three']);
  });

  it('returns [] for empty', () => {
    expect(paragraphsFromText('')).toEqual([]);
    expect(paragraphsFromText(undefined)).toEqual([]);
  });
});

describe('deriveLeadCaptureContent', () => {
  it('prefers explicit brandWordmark over the derived campaign name', () => {
    const { wordmark } = deriveLeadCaptureContent({
      name: 'Acme Campaign',
      design_config: { brandWordmark: 'custom.sg' },
    });
    expect(wordmark).toBe('custom.sg');
  });

  it('falls back to the campaign name when no wordmark is set', () => {
    const { wordmark } = deriveLeadCaptureContent({ name: 'Acme Campaign', design_config: {} });
    expect(wordmark).toBe('acme.sg');
  });

  it('derives the story from storyText ONLY (no formSubheadline fallback)', () => {
    // The bug: formSubheadline used to double as a story card. It must not anymore.
    const { story } = deriveLeadCaptureContent({
      name: 'X',
      design_config: { formSubheadline: 'should NOT become a story card' },
    });
    expect(story).toBeNull();
  });

  it('builds story paragraphs + emphasis from storyText', () => {
    const { story } = deriveLeadCaptureContent({
      name: 'X',
      design_config: { storyText: 'para one\n\npara two', storyEmphasis: 'Act now.' },
    });
    expect(story).toEqual({ paragraphs: ['para one', 'para two'], emphasis: 'Act now.' });
  });

  it('returns primaryCtaData only when there is hero media (no onClick)', () => {
    const withMedia = deriveLeadCaptureContent({
      name: 'X',
      design_config: { imageUrl: '/u/x.jpg', heroCtaLabel: 'Join', themeColor: '#abc123' },
    });
    expect(withMedia.primaryCtaData).toEqual({ label: 'Join', color: '#abc123', enabled: true });
    expect('onClick' in withMedia.primaryCtaData).toBe(false);

    const noMedia = deriveLeadCaptureContent({ name: 'X', design_config: {} });
    expect(noMedia.primaryCtaData).toBeNull();
  });

  it('defaults the hero CTA label to "Get Started"', () => {
    const { primaryCtaData } = deriveLeadCaptureContent({
      name: 'X',
      design_config: { videoUrl: 'https://youtu.be/abc' },
    });
    expect(primaryCtaData.label).toBe('Get Started');
  });

  it('falls back to brand footer defaults, and explicit values win', () => {
    const defaults = deriveLeadCaptureContent({ name: 'X', design_config: {} });
    expect(defaults.regulatoryFooter).toBe(brand.defaultRegulatory);
    expect(defaults.brand).toBe(brand.defaultPoweredBy);

    const custom = deriveLeadCaptureContent({
      name: 'X',
      design_config: { regulatoryFooter: 'Custom reg', brandFooter: 'Powered by Custom' },
    });
    expect(custom.regulatoryFooter).toBe('Custom reg');
    expect(custom.brand).toBe('Powered by Custom');
  });
});
