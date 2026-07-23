/**
 * designConfigV2 twin LOCK-STEP — imports BOTH the backend source of truth and
 * the frontend mirror; fails the build if they diverge (redeemOpsPermissions
 * drift pattern for constants, quizScoring behavioral-parity pattern for the
 * migration/theme functions, plus a seeded deterministic fuzz corpus).
 */
import { describe, it, expect } from 'vitest';

import * as mirror from '../designConfigV2.js';
import * as backend from '../../../backend/src/utils/designConfigV2.js';
import { readableTextOn } from '../contrast.js';
import { V1_DOCS } from '../../../test-fixtures/designConfigV1Docs.mjs';

const CONSTANT_EXPORTS = [
  'DESIGN_CONFIG_VERSION', 'TEMPLATE_IDS', 'DRAW_TEMPLATE_IDS', 'TEMPLATE_PARAM_DEFAULTS',
  'THEME_RADIUS_IDS', 'THEME_BACKGROUNDS', 'FONT_IDS', 'RADII', 'THEME_PRESETS',
  'PRESET_IDS', 'LIMITS', 'FIELD_IDS', 'LOCKED_FIELD_IDS', 'V1_TO_V2_FIELD_ID',
  'V2_TO_V1_FIELD_ID', 'MARKETPLACE_V1_TO_V2', 'V1_CONSUMED_KEYS', 'V2_TOP_KEYS',
  'QR_V1_TO_V2', 'QR_V2_TO_V1',
];

const FUNCTION_EXPORTS = [
  'classifyDesignConfigVersion', 'isV2', 'upgradeDesignConfig',
  'downgradeDesignConfig', 'readLegacyView', 'resolveTheme', 'defaultFields',
  'fieldsFromV1', 'fieldsToV1', 'marketplaceToV1', 'nearestPresetForAccent',
  'onColor', 'youTubeIdFrom', 'getMarketplaceListedFromDoc',
];

describe('designConfigV2 twins — constant drift', () => {
  it('exports the same surface', () => {
    for (const name of [...CONSTANT_EXPORTS, ...FUNCTION_EXPORTS]) {
      expect(mirror[name], `mirror missing ${name}`).toBeDefined();
      expect(backend[name], `backend missing ${name}`).toBeDefined();
    }
  });

  it.each(CONSTANT_EXPORTS)('constant %s is structurally identical', (name) => {
    expect(mirror[name]).toEqual(backend[name]);
  });
});

describe('designConfigV2 twins — behavioral parity over the fixture corpus', () => {
  for (const [name, doc] of Object.entries(V1_DOCS)) {
    it(`upgrade + downgrade agree for fixture "${name}"`, () => {
      const up = mirror.upgradeDesignConfig(doc);
      expect(up).toEqual(backend.upgradeDesignConfig(doc));
      expect(mirror.downgradeDesignConfig(up)).toEqual(backend.downgradeDesignConfig(up));
    });
  }

  it('classification agrees on every fixture + tagged edge shapes', () => {
    const shapes = [
      ...Object.values(V1_DOCS), null, undefined, 'nope', 42, [],
      { version: 2 }, { version: 3 }, { version: '2' }, { version: null },
    ];
    for (const s of shapes) {
      expect(mirror.classifyDesignConfigVersion(s)).toBe(backend.classifyDesignConfigVersion(s));
    }
  });

  it('getMarketplaceListedFromDoc agrees across versions', () => {
    const shapes = [
      { marketplaceListed: true },
      { marketplaceListed: false },
      { version: 2, distribution: { marketplace: { listed: true } } },
      { version: 2, distribution: {} },
      {}, null, undefined,
    ];
    for (const s of shapes) {
      expect(mirror.getMarketplaceListedFromDoc(s)).toBe(backend.getMarketplaceListedFromDoc(s));
    }
  });
});

describe('designConfigV2 twins — resolveTheme parity (exhaustive enumeration)', () => {
  const radii = [undefined, 'soft', 'sharp', 'round'];
  const backgrounds = [undefined, 'plain', 'wash', 'grain'];
  const accents = [undefined, null, '#123456', 'not-a-hex'];
  it('agrees across 10 presets × radii × backgrounds × accents', () => {
    for (const preset of backend.PRESET_IDS) {
      for (const radius of radii) {
        for (const background of backgrounds) {
          for (const accent of accents) {
            const theme = { preset, radius, background, accent };
            expect(mirror.resolveTheme(theme)).toEqual(backend.resolveTheme(theme));
          }
        }
      }
    }
  });

  it('onColor matches the production contrast helper over preset accents + edges', () => {
    const samples = [
      ...backend.THEME_PRESETS.map((p) => p.accent),
      '#FFFFFF', '#000000', '#E8D7B8', 'garbage', '', '#abc',
    ];
    for (const hex of samples) {
      expect(mirror.onColor(hex)).toBe(readableTextOn(hex));
      expect(backend.onColor(hex)).toBe(readableTextOn(hex));
    }
  });
});

describe('designConfigV2 twins — seeded deterministic fuzz corpus', () => {
  // Tiny LCG so the corpus is stable across runs/runners (no Math.random).
  const lcg = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const buildRandomV1Doc = (rand) => {
    const maybe = (p, v) => (rand() < p ? v : undefined);
    const doc = {};
    const set = (k, v) => { if (v !== undefined) doc[k] = v; };
    set('formHeadline', maybe(0.7, `Headline ${Math.floor(rand() * 1000)}`));
    set('ctaText', maybe(0.5, rand() < 0.5 ? '' : 'Go'));
    set('themeColor', maybe(0.6, rand() < 0.5 ? '#D17029' : 'junk'));
    set('heroFont', maybe(0.5, rand() < 0.5 ? 'inter' : 'unknown-font'));
    set('formWidth', maybe(0.4, Math.floor(rand() * 1000)));
    set('mediaType', maybe(0.6, ['none', 'image', 'video'][Math.floor(rand() * 3)]));
    set('imageUrl', maybe(0.5, '/uploads/x.jpg'));
    set('videoUrl', maybe(0.5, rand() < 0.4 ? 'https://youtu.be/dQw4w9WgXcQ' : '/uploads/x.mp4'));
    set('customerHost', maybe(0.5, rand() < 0.5 ? 'mktr' : 'weird'));
    set('otpChannel', maybe(0.5, rand() < 0.5 ? 'whatsapp' : 'sms'));
    set('sgPrOnly', maybe(0.5, rand() < 0.5));
    set('visibleFields', maybe(0.6, { dob: rand() < 0.5, education_level: rand() < 0.5 }));
    set('requiredFields', maybe(0.6, { dob: ['optional', true, false, 'yes'][Math.floor(rand() * 4)] }));
    set('fieldOrder', maybe(0.5, rand() < 0.5
      ? ['name', 'phone', 'email']
      : [{ id: 'r1', columns: ['dob', 'postal_code'] }, 'name', { id: 'r2', columns: [] }]));
    set('featuredDrop', maybe(0.3, { enabled: rand() < 0.5, title: 'T' }));
    set('quiz', maybe(0.3, { enabled: true, steps: [], scoring: { method: 'profile-sum' } }));
    set('mysteryKey', maybe(0.3, { nested: Math.floor(rand() * 10) }));
    return doc;
  };

  it('200 seeded docs: twins agree, upgrade is idempotent, downgrade(v1) is identity-safe', () => {
    const rand = lcg(20260717);
    for (let i = 0; i < 200; i += 1) {
      const doc = buildRandomV1Doc(rand);
      const upM = mirror.upgradeDesignConfig(doc);
      const upB = backend.upgradeDesignConfig(doc);
      expect(upM).toEqual(upB);
      expect(mirror.upgradeDesignConfig(upM)).toEqual(upM); // idempotent
      const downM = mirror.downgradeDesignConfig(upM);
      expect(downM).toEqual(backend.downgradeDesignConfig(upB));
      // Second round trip is stable (canonical form reached after one pass).
      expect(mirror.upgradeDesignConfig(downM)).toEqual(upM);
    }
  });
});

describe('L6 — content.drawCopy is v2-only in BOTH twins', () => {
  const v2WithDrawCopy = () => {
    const doc = mirror.upgradeDesignConfig({ formHeadline: 'H', customerHost: 'redeem' });
    doc.content = { ...doc.content, drawCopy: { trustRow: 'VERIFIED', boostBody: 'Custom body.' } };
    return doc;
  };

  it('downgrade DROPS drawCopy identically in both twins', () => {
    for (const twin of [mirror, backend]) {
      const v1 = twin.downgradeDesignConfig(v2WithDrawCopy());
      const flat = JSON.stringify(v1);
      expect(flat).not.toContain('drawCopy');
      expect(flat).not.toContain('VERIFIED');
      expect(flat).not.toContain('Custom body.');
    }
  });

  it('upgrade never CREATES drawCopy in either twin', () => {
    for (const twin of [mirror, backend]) {
      for (const v1 of Object.values(V1_DOCS)) {
        expect(twin.upgradeDesignConfig(v1).content?.drawCopy).toBeUndefined();
      }
    }
  });
});

describe('L7 — content.submitFontSize is v2-only in BOTH twins', () => {
  const v2WithSize = () => {
    const doc = mirror.upgradeDesignConfig({ formHeadline: 'H', customerHost: 'redeem' });
    doc.content = { ...doc.content, submitFontSize: 21 };
    return doc;
  };

  it('downgrade DROPS submitFontSize identically in both twins', () => {
    for (const twin of [mirror, backend]) {
      const v1 = twin.downgradeDesignConfig(v2WithSize());
      expect(JSON.stringify(v1)).not.toContain('submitFontSize');
    }
  });

  it('upgrade never CREATES submitFontSize in either twin', () => {
    for (const twin of [mirror, backend]) {
      for (const v1 of Object.values(V1_DOCS)) {
        expect(twin.upgradeDesignConfig(v1).content?.submitFontSize).toBeUndefined();
      }
    }
  });
});
