import { pickFromRing } from '../../src/services/leadRing.js';

describe('pickFromRing', () => {
  it('returns null for an empty or invalid ring', () => {
    expect(pickFromRing([], 1)).toBeNull();
    expect(pickFromRing(null, 1)).toBeNull();
    expect(pickFromRing(undefined, 5)).toBeNull();
  });

  it('rotates fairly across the ring as the cursor advances and wraps', () => {
    const ring = [
      { kind: 'internal', internalAgentId: 'A' },
      { kind: 'external', externalAgentId: 'X' },
      { kind: 'internal', internalAgentId: 'B' },
    ];
    expect(pickFromRing(ring, 1)).toBe(ring[0]);
    expect(pickFromRing(ring, 2)).toBe(ring[1]);
    expect(pickFromRing(ring, 3)).toBe(ring[2]);
    expect(pickFromRing(ring, 4)).toBe(ring[0]); // wraps
  });

  it('handles large cursor values without drift', () => {
    const ring = [{ id: 0 }, { id: 1 }];
    expect(pickFromRing(ring, 101)).toBe(ring[0]); // (101-1) % 2 === 0
    expect(pickFromRing(ring, 102)).toBe(ring[1]);
  });

  it('interleaves internal and external candidates in one ring', () => {
    const ring = [
      { kind: 'internal', internalAgentId: 'A' },
      { kind: 'external', externalAgentId: 'X' },
    ];
    const picks = [1, 2, 3, 4].map((c) => pickFromRing(ring, c).kind);
    expect(picks).toEqual(['internal', 'external', 'internal', 'external']);
  });
});
