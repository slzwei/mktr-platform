import { describe, it, expect } from 'vitest';
import { TEMPLATE_IDS } from '../designConfigV2';
import {
  HERO_MEDIA_SPECS,
  heroMediaSpec,
  heroMediaHiddenReason,
  heroFramePadsYouTube,
} from '../heroMediaSpecs';

describe('heroMediaSpecs', () => {
  it('covers EVERY template id — a new template must bring its own asset size', () => {
    expect(Object.keys(HERO_MEDIA_SPECS).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it('gives every rendering template a pixel size, a ratio and a frame description', () => {
    for (const id of TEMPLATE_IDS) {
      const spec = HERO_MEDIA_SPECS[id];
      if (spec.hidden) {
        expect(typeof spec.hidden).toBe('string');
        continue;
      }
      expect(spec.size).toMatch(/^\d{3,4} × \d{3,4}$/);
      expect(spec.ratio).toMatch(/^[\d.]+:\d+ \w+$/);
      expect(spec.frame.length).toBeGreaterThan(10);
    }
  });

  it('the sizes actually match the ratio they claim (within 2%)', () => {
    for (const id of TEMPLATE_IDS) {
      const spec = HERO_MEDIA_SPECS[id];
      if (spec.hidden) continue;
      const [w, h] = spec.size.split('×').map((n) => Number(n.trim()));
      const [rw, rh] = spec.ratio.split(' ')[0].split(':').map(Number);
      expect(Math.abs(w / h - rw / rh) / (rw / rh)).toBeLessThan(0.02);
    }
  });

  it('falls back to the editorial 16:9 baseline for an unknown template', () => {
    expect(heroMediaSpec('not-a-template')).toBe(HERO_MEDIA_SPECS.editorial);
  });

  it('reports the templates and params that render no media at all', () => {
    expect(heroMediaHiddenReason('editorial')).toBeNull();
    expect(heroMediaHiddenReason('spotlight')).toMatch(/no hero-media slot/);
    expect(heroMediaHiddenReason('express')).toMatch(/no hero-media slot/);
    expect(heroMediaHiddenReason('stub', { ticketTone: 'paper' })).toBeNull();
    expect(heroMediaHiddenReason('stub', { ticketTone: 'accent' })).toMatch(/hides the image/);
    expect(heroMediaHiddenReason('checklist', {})).toBeNull();
    expect(heroMediaHiddenReason('checklist', { heroBand: false })).toMatch(/switched off/);
  });

  it('reads the FRAME ratio, not the recommended-source copy, for YouTube padding', () => {
    // Only editorial + journey keep MediaBlock's default 16/9 frame.
    expect(heroFramePadsYouTube('editorial')).toBe(false);
    expect(heroFramePadsYouTube('journey')).toBe(false);
    // Poster RECOMMENDS a 16:9 source but its frame is aspectRatio:auto (~3:1),
    // so a 16:9 embed still gets padded — the trap a string test falls into.
    expect(heroFramePadsYouTube('poster')).toBe(true);
    expect(heroFramePadsYouTube('gazette')).toBe(true);
    expect(heroFramePadsYouTube('nightfall')).toBe(true);
    expect(heroFramePadsYouTube('spotlight')).toBeNull(); // not applicable
  });

  it('never claims a hidden template throws the upload away — it still feeds the listing', () => {
    for (const spec of Object.values(HERO_MEDIA_SPECS)) {
      if (!spec.hidden) continue;
      expect(spec.hidden).toMatch(/marketplace listing/);
      expect(spec.hidden).not.toMatch(/nothing will show(?! it)/);
    }
  });
});
