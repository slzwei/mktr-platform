/**
 * Marketplace-inherits-campaign-page, Phase A (plan §4 matrix, backend half):
 * the derivation overlay, the flag-off oracle, and the parity MUST — edit the
 * page content, the listing view changes.
 */
import {
  applyListingInheritance,
  deriveListingTitle,
  deriveFeaturedDropTitle,
  marketplaceInheritEnabled,
} from '../src/utils/listingDerivation.js';
import { buildPublicDesignConfig, toDto } from '../src/services/marketplaceService.js';
import { featuredTitleOf } from '../src/services/featuredDropsService.js';
import {
  getMarketplaceCacheState,
  setMarketplaceCacheState,
  getMarketplaceCacheGeneration,
  invalidateMarketplaceCache,
} from '../src/services/marketplaceCache.js';
import { readLegacyViewSafe } from '../src/utils/designConfigV2Clamp.js';

const CAMPAIGN = { id: 'c1', name: 'Internal Campaign Name' };

/** Tokyo-shaped v2 draw doc with STORED listing copy that must lose to the page. */
const v2DrawDoc = {
  version: 2,
  template: { id: 'postcard', params: {} },
  theme: { preset: 'paper-white', accent: '#3B82F6' },
  content: {
    wordmark: 'redeem.sg',
    headline: 'Win a 4D3N Tokyo Getaway',
    subheadline: 'Return flights + 3 nights hotel.',
    story: 'Drop your details and you are in the draw.',
    footer: { regulatory: 'Organised by MKTR Pte. Ltd. No purchase necessary.', brand: '' },
    media: { kind: 'image', src: '/uploads/tokyo.jpg', alt: 'Tokyo skyline at dusk' },
  },
  form: { fields: [], verification: 'sms', terms: { template: 'default', html: '<p>T</p>' }, gates: {} },
  distribution: {
    host: 'redeem',
    marketplace: {
      listed: true,
      title: 'STORED LISTING TITLE',
      valueLine: 'STORED VALUE LINE',
      imageAlt: 'STORED ALT',
      inclusions: ['stored inclusion'],
      category: 'family_lifestyle',
      mode: 'hybrid',
      dataUse: 'Stored data use.',
    },
  },
  luckyDraw: {
    enabled: true,
    prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: 'AirPods' }],
    closesAt: '2026-10-30',
    boostClosesAt: '2026-10-30',
    multiplier: 10,
  },
};

const overlayOf = (doc, campaign = CAMPAIGN) => {
  const publicDc = buildPublicDesignConfig(doc);
  return applyListingInheritance({ campaign, publicDc, rawDc: doc });
};

describe('flag plumbing', () => {
  it('defaults off and reads per call', () => {
    delete process.env.MARKETPLACE_INHERIT_ENABLED;
    expect(marketplaceInheritEnabled()).toBe(false);
    process.env.MARKETPLACE_INHERIT_ENABLED = 'true';
    expect(marketplaceInheritEnabled()).toBe(true);
    delete process.env.MARKETPLACE_INHERIT_ENABLED;
  });
});

describe('applyListingInheritance — v2 draw doc', () => {
  it('page content WINS over stored listing copy across the derived set', () => {
    const out = overlayOf(v2DrawDoc);
    expect(out.name).toBe('Win a 4D3N Tokyo Getaway');           // not STORED LISTING TITLE
    expect(out.description).toBe('Drop your details and you are in the draw.');
    expect(out.regulatory_line).toBe('Organised by MKTR Pte. Ltd. No purchase necessary.');
    expect(out.value_line).toBe(out.luckyDraw.prize);            // derived prize summary fact
    expect(out.image_label).toBe('Tokyo skyline at dusk');       // not STORED ALT
    expect(out.imageUrl).toBe('/uploads/tokyo.jpg');             // page hero IS the card image (finding 4)
    expect(out.prize_breakdown).toEqual([{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: 'AirPods' }]);
    expect(out.inclusions).toBeUndefined();                      // draws never say "Includes"
  });

  it('placement picks pass through untouched', () => {
    const out = overlayOf(v2DrawDoc);
    expect(out.category).toBe('family_lifestyle');
    expect(out.mode).toBe('hybrid');
    expect(out.content_blocks?.data_use).toBe('Stored data use.');
    expect(out.luckyDraw.enabled).toBe(true);
  });

  it('THE MUST: editing page content changes the listing view', () => {
    const edited = structuredClone(v2DrawDoc);
    edited.content.headline = 'Win a Trip to Osaka';
    edited.content.story = 'A new story.';
    const out = overlayOf(edited);
    expect(out.name).toBe('Win a Trip to Osaka');
    expect(out.description).toBe('A new story.');
  });

  it('generic or missing headline drops the title so campaign.name falls back downstream', () => {
    const generic = structuredClone(v2DrawDoc);
    generic.content.headline = 'Get Started';
    expect(overlayOf(generic).name).toBeUndefined();
    const missing = structuredClone(v2DrawDoc);
    missing.content.headline = '';
    expect(overlayOf(missing).name).toBeUndefined();
  });

  it('non-image media never emits an image label (or card image)', () => {
    const video = structuredClone(v2DrawDoc);
    video.content.media = { kind: 'youtube', src: 'https://youtu.be/x', alt: 'ignored' };
    const out = overlayOf(video);
    expect(out.image_label).toBeUndefined();
    expect(out.imageUrl).toBeUndefined();
  });

  it('a short legitimate headline like "Sign Up" IS a valid title (only the template default is generic)', () => {
    const doc = structuredClone(v2DrawDoc);
    doc.content.headline = 'Sign Up';
    expect(overlayOf(doc).name).toBe('Sign Up');
  });

  it('a maximal structured prize summary clamps to the 80-char value cap; full names stay in prize_breakdown', () => {
    const doc = structuredClone(v2DrawDoc);
    doc.luckyDraw.prizes = Array.from({ length: 8 }, (_, i) => ({ qty: 9, name: `Extremely Long Prize Name Number ${i + 1} With Extra Words` }));
    const out = overlayOf(doc);
    expect(out.value_line.length).toBeLessThanOrEqual(80);
    expect(out.prize_breakdown).toHaveLength(8);
  });
});

describe('applyListingInheritance — non-draw + v1 docs', () => {
  const v2Plain = {
    ...structuredClone(v2DrawDoc),
    luckyDraw: undefined,
  };

  it('non-draw: value_line drops (frontend renders the ops retail fact); no prize_breakdown; inclusions kept', () => {
    const out = overlayOf(v2Plain);
    expect(out.value_line).toBeUndefined();
    expect(out.prize_breakdown).toBeUndefined();
    expect(out.inclusions).toEqual(['stored inclusion']); // non-draw pick passes through
  });

  it('v1 non-image media deletes the stored image_label and card image (image-kind precedence)', () => {
    const v1video = {
      formHeadline: 'V1 Video Campaign',
      mediaType: 'video',
      videoUrl: '/uploads/v.mp4',
      marketplaceListed: true,
      image_label: 'stale stored label',
      customerHost: 'redeem',
    };
    const out = overlayOf(v1video);
    expect(out.image_label).toBeUndefined();
    expect(out.imageUrl).toBeUndefined();
  });

  it('v1 docs derive from v1 keys and keep their stored image_label (no alt source)', () => {
    const v1 = {
      formHeadline: 'V1 Headline',
      storyText: 'V1 story.',
      regulatoryFooter: 'V1 regulatory.',
      imageUrl: '/uploads/x.jpg',
      mediaType: 'image',
      marketplaceListed: true,
      name: 'stored v1 title',
      image_label: 'v1 stored label',
      customerHost: 'redeem',
    };
    const out = overlayOf(v1);
    expect(out.name).toBe('V1 Headline');
    expect(out.description).toBe('V1 story.');
    expect(out.regulatory_line).toBe('V1 regulatory.');
    expect(out.image_label).toBe('v1 stored label'); // untouched — no page-level alt exists in v1
    expect(out.imageUrl).toBe('/uploads/x.jpg');     // v1 page image inherits as the card image
  });
});

describe('flag-off oracle', () => {
  it('buildPublicDesignConfig output is untouched by Phase A (stored reads byte-identical)', () => {
    const publicDc = buildPublicDesignConfig(v2DrawDoc);
    expect(publicDc.name).toBe('STORED LISTING TITLE');
    expect(publicDc.value_line).toBe('STORED VALUE LINE');
    expect(publicDc.image_label).toBe('STORED ALT');
    expect(publicDc.inclusions).toEqual(['stored inclusion']);
    expect(publicDc.description).toBeUndefined();
    expect(publicDc.prize_breakdown).toBeUndefined();
  });
});

describe('featured-drop title inheritance', () => {
  it('derives the headline at the 40-char drop cap; undefined on generic', () => {
    expect(deriveFeaturedDropTitle(v2DrawDoc)).toBe('Win a 4D3N Tokyo Getaway');
    const long = structuredClone(v2DrawDoc);
    long.content.headline = 'A very long headline that exceeds the forty character drop cap easily';
    expect(deriveFeaturedDropTitle(long)).toHaveLength(40);
    const generic = structuredClone(v2DrawDoc);
    generic.content.headline = 'Get Started';
    expect(deriveFeaturedDropTitle(generic)).toBeUndefined();
  });
});

describe('toDto — the real choke point, flag off vs on (review finding 9)', () => {
  const campaignRow = { ...CAMPAIGN, slug: 'tokyo-draw', min_age: 18, max_age: 99, metaPixelId: null, tiktokPixelId: null, design_config: v2DrawDoc };

  afterEach(() => { delete process.env.MARKETPLACE_INHERIT_ENABLED; });

  it('flag OFF: stored listing copy serves byte-identically through toDto', () => {
    delete process.env.MARKETPLACE_INHERIT_ENABLED;
    const dto = toDto(campaignRow, null);
    expect(dto.design_config.name).toBe('STORED LISTING TITLE');
    expect(dto.design_config.value_line).toBe('STORED VALUE LINE');
    expect(dto.design_config.description).toBeUndefined();
  });

  it('flag ON: the derived view serves through toDto', () => {
    process.env.MARKETPLACE_INHERIT_ENABLED = 'true';
    const dto = toDto(campaignRow, null);
    expect(dto.design_config.name).toBe('Win a 4D3N Tokyo Getaway');
    expect(dto.design_config.imageUrl).toBe('/uploads/tokyo.jpg');
    expect(dto.design_config.inclusions).toBeUndefined();
  });
});

describe('marketplace cache — mode identity + invalidation generation (findings 1–2)', () => {
  afterEach(() => invalidateMarketplaceCache());

  it('a refresh that lost to an invalidation does not commit', () => {
    const gen = getMarketplaceCacheGeneration();
    invalidateMarketplaceCache(); // mutation lands while the refresh is in flight
    expect(setMarketplaceCacheState(['stale-data'], Date.now(), false, gen)).toBe(false);
    expect(getMarketplaceCacheState().data).toBeNull();
  });

  it('entries are mode-tagged so a flag flip cannot serve the other mode', () => {
    expect(setMarketplaceCacheState(['off-mode-data'], Date.now(), false)).toBe(true);
    expect(getMarketplaceCacheState().mode).toBe(false);
  });
});

describe('featuredTitleOf (finding 5)', () => {
  afterEach(() => { delete process.env.MARKETPLACE_INHERIT_ENABLED; });

  it('flag ON: derived headline, else campaign name — the stored drop title never wins', () => {
    process.env.MARKETPLACE_INHERIT_ENABLED = 'true';
    expect(featuredTitleOf(v2DrawDoc, { title: 'STORED DROP' }, 'Camp')).toBe('Win a 4D3N Tokyo Getaway');
    const generic = structuredClone(v2DrawDoc);
    generic.content.headline = 'Get Started';
    expect(featuredTitleOf(generic, { title: 'STORED DROP' }, 'Camp')).toBe('Camp');
  });

  it('flag OFF: stored-first read is unchanged', () => {
    expect(featuredTitleOf(v2DrawDoc, { title: 'STORED DROP' }, 'Camp')).toBe('STORED DROP');
    expect(featuredTitleOf(v2DrawDoc, {}, 'Camp')).toBe('Camp');
  });
});

describe('deriveListingTitle helper', () => {
  it('is the one title rule (v2 + v1 + fallback contract)', () => {
    expect(deriveListingTitle(v2DrawDoc, readLegacyViewSafe(v2DrawDoc, {}))).toBe('Win a 4D3N Tokyo Getaway');
    const v1 = { formHeadline: '  Spaced   Headline  ' };
    expect(deriveListingTitle(v1, readLegacyViewSafe(v1, {}))).toBe('Spaced Headline');
    expect(deriveListingTitle({}, {})).toBeUndefined();
  });
});
