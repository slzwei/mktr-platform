/**
 * CLIENT ↔ SERVER derivation lockstep (plan §3B): the Studio's unsaved-doc
 * preview must derive exactly what the server overlay will emit after save.
 * Same discipline as designConfigV2.lockstep — the backend module is imported
 * directly (pure utils, no models).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applyClientInheritance,
  deriveListingTitle as clientTitle,
  marketplaceInheritEnabled,
  listingTitleOf,
} from '../listingDerivation';
import {
  applyListingInheritance as serverOverlay,
  deriveListingTitle as serverTitle,
} from '../../../backend/src/utils/listingDerivation.js';
import { readLegacyViewSafe } from '../../../backend/src/utils/designConfigV2Clamp.js';
import { publicLuckyDraw } from '../../../backend/src/utils/publicDesignConfig.js';

const DERIVED_KEYS = ['name', 'description', 'regulatory_line', 'value_line', 'imageUrl', 'image_label', 'prize_breakdown', 'inclusions'];

const v2Draw = {
  version: 2,
  content: {
    headline: 'Win a 4D3N Tokyo Getaway',
    story: 'Drop your details and you are in the draw.',
    footer: { regulatory: 'Organised by MKTR. No purchase necessary.', brand: '' },
    media: { kind: 'image', src: '/uploads/tokyo.jpg', alt: 'Tokyo at dusk' },
  },
  distribution: { host: 'redeem', marketplace: { listed: true } },
  luckyDraw: { enabled: true, prize: '1× iPhone 17 Pro + 3× AirPods', prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: 'AirPods' }], closesAt: '2026-10-30', multiplier: 10 },
};
const v2Plain = { ...structuredClone(v2Draw), luckyDraw: undefined };
const v2Generic = (() => { const d = structuredClone(v2Draw); d.content.headline = 'Get Started'; return d; })();
const v2Video = (() => { const d = structuredClone(v2Draw); d.content.media = { kind: 'youtube', src: 'https://youtu.be/x', alt: 'ig' }; return d; })();
const v1Doc = {
  formHeadline: 'V1 Headline',
  storyText: 'V1 story.',
  regulatoryFooter: 'V1 regulatory.',
  imageUrl: '/uploads/x.jpg',
  mediaType: 'image',
  image_label: 'v1 stored label',
  marketplaceListed: true,
  customerHost: 'redeem',
};

const BASE = {
  name: 'STORED TITLE', value_line: 'STORED VALUE', image_label: 'STORED ALT',
  inclusions: ['stored'], category: 'family_lifestyle',
  luckyDraw: undefined, // overridden per doc below
};

/** The REAL public pipeline builds the server's luckyDraw view (Phase B
 * review finding 1: hand-mirrored fixtures hid normalization drift). */
const baseFor = (doc) => {
  const ld = publicLuckyDraw(doc.luckyDraw);
  return { ...structuredClone(BASE), ...(ld ? { luckyDraw: ld } : {}) };
};

const v2Dirty = (() => {
  const d = structuredClone(v2Draw);
  d.luckyDraw.prizes = [
    { qty: '3', name: '  Padded  Voucher  ' },
    { qty: 0, name: 'Zero Coerces' },
    { qty: 2.5, name: 'Fractional Coerces' },
    ...Array.from({ length: 9 }, (_, i) => ({ qty: 2, name: `Overflow Row ${i + 1}` })),
  ];
  d.luckyDraw.prize = 'STALE STORED SUMMARY';
  return d;
})();
const v2VideoKind = (() => { const d = structuredClone(v2Draw); d.content.media = { kind: 'video', src: '/uploads/v.mp4' }; return d; })();
const v2NoneKind = (() => { const d = structuredClone(v2Draw); d.content.media = { kind: 'none', src: '' }; return d; })();

describe('client twin ↔ server overlay lockstep', () => {
  it.each([
    ['v2 draw', v2Draw],
    ['v2 plain', v2Plain],
    ['v2 generic headline', v2Generic],
    ['v2 video media', v2Video],
    ['v1 doc', v1Doc],
    ['v2 dirty prize rows', v2Dirty],
    ['v2 video media', v2VideoKind],
    ['v2 none media', v2NoneKind],
  ])('%s derives identically on every derived key', (_label, doc) => {
    const base = baseFor(doc);
    const server = serverOverlay({ campaign: { name: 'Camp' }, publicDc: structuredClone(base), rawDc: doc });
    const client = applyClientInheritance(structuredClone(base), doc, 'Camp');
    for (const k of DERIVED_KEYS) {
      expect(client[k]).toEqual(server[k]);
    }
  });

  it('the title rule is one rule', () => {
    for (const doc of [v2Draw, v2Generic, v1Doc, {}]) {
      expect(clientTitle(doc)).toEqual(serverTitle(doc, readLegacyViewSafe(doc || {}, {})));
    }
  });
});

describe('listingTitleOf (consumer-side effective title incl. tracking)', () => {
  it('served dc.name wins, campaign name falls back', () => {
    expect(listingTitleOf({ name: 'Internal', design_config: { name: 'Listing Title' } })).toBe('Listing Title');
    expect(listingTitleOf({ name: 'Internal', design_config: {} })).toBe('Internal');
    expect(listingTitleOf(null)).toBe('');
  });
});

describe('flag plumbing', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('reads VITE_MARKETPLACE_INHERIT_ENABLED', () => {
    expect(marketplaceInheritEnabled()).toBe(false);
    vi.stubEnv('VITE_MARKETPLACE_INHERIT_ENABLED', 'true');
    expect(marketplaceInheritEnabled()).toBe(true);
  });
});
