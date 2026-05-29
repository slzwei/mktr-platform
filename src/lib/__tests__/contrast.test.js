import { describe, it, expect } from 'vitest';
import { readableTextOn } from '../contrast';

const INK = '#3D1F0B';

describe('readableTextOn', () => {
  it('keeps white on dark / saturated brand accents', () => {
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn(INK)).toBe('#ffffff');
    expect(readableTextOn('#D17029')).toBe('#ffffff'); // terracotta accent
    expect(readableTextOn('#7A8C6B')).toBe('#ffffff'); // sage success
  });

  it('flips to dark ink on light backgrounds (the contrast floor)', () => {
    expect(readableTextOn('#E8D7B8')).toBe(INK); // pale tan theme
    expect(readableTextOn('#FAEAD0')).toBe(INK); // cream
    expect(readableTextOn('#ffffff')).toBe(INK);
  });

  it('falls back to white for unparseable input', () => {
    expect(readableTextOn(undefined)).toBe('#ffffff');
    expect(readableTextOn('not-a-color')).toBe('#ffffff');
  });

  it('supports 3-digit hex', () => {
    expect(readableTextOn('#fff')).toBe(INK);
    expect(readableTextOn('#000')).toBe('#ffffff');
  });
});
