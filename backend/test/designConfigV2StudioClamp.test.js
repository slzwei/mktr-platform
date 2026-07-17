/**
 * Studio-shaped v2 clamp proofs (Campaign Studio PR 3 — TEST-ONLY, no backend
 * behavior change). The Studio adopts the server-clamped response as its new
 * baseline, so the clamp must be IDEMPOTENT over Studio-authored documents
 * (a second clamp of a clamped doc is byte-identical → no phantom dirty), and
 * the admin-only subtrees must round-trip by role exactly as the policies say.
 */
import { describe, it, expect } from '@jest/globals';
import { clampDesignConfigV2 } from '../src/utils/designConfigV2Clamp.js';
import { upgradeDesignConfig } from '../src/utils/designConfigV2.js';

// A Studio-authored doc: migrated v1 base + edits across every rail section,
// plus admin subtrees and a future unknown key.
function studioDoc() {
  const doc = upgradeDesignConfig({
    formHeadline: 'Get your $10 voucher',
    storyText: 'Story.',
    themeColor: '#D17029',
    heroFont: 'fraunces',
    customerHost: 'redeem',
    sgPrOnly: true,
    dncCheckAtSubmit: true,
    visibleFields: { dob: true, postal_code: true },
    requiredFields: { dob: true },
    termsContent: '<p>Terms</p>',
    quiz: { enabled: true, steps: [{ id: 's1', questions: [{ id: 'q1', prompt: 'P', options: [{ id: 'a', label: 'A', scores: { p1: 1 } }] }] }], resultProfiles: [{ id: 'p1', title: 'One' }], scoring: { method: 'profile-sum' } },
  });
  doc.content.headline = 'Edited in the Studio';
  doc.content.advertiserName = 'Prudential SG';
  doc.template = { id: 'poster', params: { ...doc.template.params, poster: { overlay: 'plain', formReveal: 'inline' } } };
  doc.theme = { preset: 'graphite', accent: '#7A9BFF', font: 'space-grotesk' };
  doc.distribution.featuredDrop = { enabled: true, title: 'Drop', valueLabel: '$10', emoji: '🎁', cap: 50, endsAt: '2026-10-30' };
  doc.distribution.marketplace = { listed: true, title: 'Listing', category: 'dining', offerType: 'reward', mode: 'physical', qrLanding: 'offer' };
  doc.luckyDraw = { enabled: true, prize: 'Tokyo trip', closesAt: '2026-10-30', multiplier: 10 };
  doc.ai = { brief: { topic: 'internal' } };
  doc.futureTopLevelKey = { keep: 'me' };
  return doc;
}

describe('clampDesignConfigV2 over Studio-authored docs', () => {
  it('is IDEMPOTENT for admins: clamp(clamp(x)) is byte-identical to clamp(x)', () => {
    const once = clampDesignConfigV2(studioDoc(), undefined, 'admin');
    const twice = clampDesignConfigV2(once, once, 'admin');
    expect(twice).toEqual(once);
  });

  it('is IDEMPOTENT for non-admins over their own clamped output', () => {
    const stored = clampDesignConfigV2(studioDoc(), undefined, 'admin');
    const once = clampDesignConfigV2(stored, stored, 'agent');
    const twice = clampDesignConfigV2(once, once, 'agent');
    expect(twice).toEqual(once);
  });

  it('admin saves persist the admin subtrees; unknown top-level keys and quiz ride through verbatim', () => {
    const out = clampDesignConfigV2(studioDoc(), undefined, 'admin');
    expect(out.distribution.featuredDrop).toMatchObject({ enabled: true, title: 'Drop' });
    expect(out.distribution.marketplace.listed).toBe(true);
    expect(out.luckyDraw).toMatchObject({ enabled: true, closesAt: '2026-10-30' });
    expect(out.ai).toEqual({ brief: { topic: 'internal' } });
    expect(out.futureTopLevelKey).toEqual({ keep: 'me' });
    expect(out.quiz).toEqual(studioDoc().quiz);
    expect(out.customerHost).toBe('redeem'); // derived mirror
  });

  it('PR 5: the clamp DROPS marketplace.endsAt (expiry is ops-derived — pins the schema decision)', () => {
    const doc = studioDoc();
    doc.distribution.marketplace.endsAt = '2026-12-31';
    const out = clampDesignConfigV2(doc, undefined, 'admin');
    expect(out.distribution.marketplace.endsAt).toBeUndefined();
    expect(out.distribution.marketplace.title).toBe('Listing');
  });

  it('non-admin saves preserve the STORED admin subtrees (a Studio round-trip cannot smuggle them)', () => {
    const stored = clampDesignConfigV2(studioDoc(), undefined, 'admin');
    const attempt = structuredClone(stored);
    attempt.distribution.featuredDrop = { enabled: false };
    attempt.distribution.marketplace.listed = false;
    attempt.luckyDraw = { enabled: false };
    attempt.ai = { brief: { topic: 'tampered' } };
    const out = clampDesignConfigV2(attempt, stored, 'agent');
    expect(out.distribution.featuredDrop).toEqual(stored.distribution.featuredDrop);
    expect(out.distribution.marketplace.listed).toBe(true);
    expect(out.luckyDraw).toEqual(stored.luckyDraw);
    expect(out.ai).toEqual(stored.ai);
  });
});
