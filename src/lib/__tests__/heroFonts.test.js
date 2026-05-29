import { describe, it, expect } from 'vitest';
import { HERO_FONTS, DEFAULT_HERO_FONT, heroFontStack } from '../heroFonts';

describe('heroFontStack', () => {
  it('resolves a known font id to its stack', () => {
    expect(heroFontStack('playfair')).toContain('Playfair Display');
    expect(heroFontStack('inter')).toContain('Inter');
  });

  it('falls back to the default (Fraunces) for unknown / empty / undefined ids', () => {
    const fallback = heroFontStack(DEFAULT_HERO_FONT);
    expect(heroFontStack(undefined)).toBe(fallback);
    expect(heroFontStack('')).toBe(fallback);
    expect(heroFontStack('does-not-exist')).toBe(fallback);
    expect(fallback).toContain('Fraunces');
  });

  it('exposes the default font id in the registry', () => {
    expect(HERO_FONTS.some((f) => f.id === DEFAULT_HERO_FONT)).toBe(true);
  });

  it('every font has an id, label, and a valid CSS stack', () => {
    for (const f of HERO_FONTS) {
      expect(f.id).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.stack).toMatch(/serif|sans-serif|monospace/);
    }
  });
});
