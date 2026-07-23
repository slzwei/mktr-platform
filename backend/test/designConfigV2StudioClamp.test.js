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

describe('draw-template ids + params (drawTemplates.jsx)', () => {
  it('accepts the five draw template ids and clamps their enum params to defaults on junk', () => {
    const doc = studioDoc();
    doc.template = {
      id: 'nightfall',
      params: {
        ...doc.template.params,
        nightfall: { overlayTone: 'neon', showCountdown: 'yes', ctaStyle: 'pill' },
        postcard: { mediaSide: 'top', cardStyle: 'float', factStyle: 'inline' },
        stub: { ticketTone: 'gold', stubEdge: 'left', showSerial: false },
      },
    };
    const out = clampDesignConfigV2(doc, undefined, 'admin');
    expect(out.template.id).toBe('nightfall');
    expect(out.template.params.nightfall).toEqual({ overlayTone: 'ink', showCountdown: false, ctaStyle: 'pill' });
    expect(out.template.params.postcard).toEqual({ mediaSide: 'left', cardStyle: 'float', factStyle: 'inline' });
    expect(out.template.params.stub).toEqual({ ticketTone: 'paper', stubEdge: 'bottom', showSerial: false });
    // Untouched draw templates keep seeded defaults.
    expect(out.template.params.gazette).toEqual({ ruleDensity: 'airy', accentUse: 'fill', showSerial: true });
    expect(out.template.params.checklist).toEqual({ boostStep: 'inline', heroBand: true, railStyle: 'line' });
  });

  it('unknown template id still falls back to editorial', () => {
    const doc = studioDoc();
    doc.template = { id: 'brutalist', params: doc.template.params };
    expect(clampDesignConfigV2(doc, undefined, 'admin').template.id).toBe('editorial');
  });
});

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

  it('structured luckyDraw.prizes survive the v2 clamp with derived prize + winners', () => {
    const doc = studioDoc();
    doc.luckyDraw = {
      enabled: true,
      closesAt: '2026-10-30',
      multiplier: 10,
      prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }],
      prize: 'stale summary',
      winners: 77,
    };
    const out = clampDesignConfigV2(doc, undefined, 'admin');
    expect(out.luckyDraw.prizes).toEqual([{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }]);
    expect(out.luckyDraw.prize).toBe('iPhone 17 Pro + 3× $100 FairPrice Voucher');
    expect(out.luckyDraw.winners).toBe(4);
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

describe('qrLanding survives the save clamp (the v1/v2 enum trap)', () => {
  const save = (qrLanding) => clampDesignConfigV2({
    version: 2,
    distribution: { marketplace: { title: 'X', qrLanding } },
  }, undefined, 'admin');
  const read = (doc) => doc.distribution?.marketplace?.qrLanding;

  it("'offer' stays 'offer' — it used to save as the v1 'detail' and revert the picker", () => {
    expect(read(save('offer'))).toBe('offer');
  });

  it("'form' stays 'form' (it used to save as 'direct')", () => {
    expect(read(save('form'))).toBe('form');
  });

  it('is idempotent across repeated saves — the old bug re-corrupted on every one', () => {
    let doc = save('offer');
    for (let i = 0; i < 3; i += 1) doc = clampDesignConfigV2(doc, undefined, 'admin');
    expect(read(doc)).toBe('offer');
  });

  it('never emits a v1 enum value into a v2 document', () => {
    for (const v of ['offer', 'form', 'detail', 'direct']) {
      expect(['form', 'offer', undefined]).toContain(read(save(v)));
    }
  });
});

describe('content.drawCopy — draw-chrome copy overrides (v2-only)', () => {
  const save = (drawCopy) => clampDesignConfigV2({
    version: 2,
    content: { headline: 'H', drawCopy },
  }, undefined, 'admin');
  const read = (doc) => doc.content?.drawCopy;

  it('keeps every recognized key, trimmed', () => {
    const out = read(save({
      trustRow: '  VERIFIED · ONE EACH ', scamLine: 'No payment.', winnersNote: 'We call you.',
      ctaSubline: 'DO THE THING', freeEntryTag: 'COSTS NOTHING', boostBody: 'Session multiplies it.',
    }));
    expect(out).toEqual({
      trustRow: 'VERIFIED · ONE EACH', scamLine: 'No payment.', winnersNote: 'We call you.',
      ctaSubline: 'DO THE THING', freeEntryTag: 'COSTS NOTHING', boostBody: 'Session multiplies it.',
    });
  });

  it('drops empty and whitespace-only values (empty = composed default)', () => {
    expect(read(save({ trustRow: '', scamLine: '   ', boostBody: 'kept' }))).toEqual({ boostBody: 'kept' });
  });

  it('drops unknown keys and non-strings; omits the object entirely when nothing survives', () => {
    expect(read(save({ bogus: 'x', trustRow: 42 }))).toBeUndefined();
    expect(read(save('not-an-object'))).toBeUndefined();
    expect(read(save(undefined))).toBeUndefined();
  });

  it('caps lengths at the LIMITS twins', () => {
    const out = read(save({ boostBody: 'x'.repeat(1000) }));
    expect(out.boostBody).toHaveLength(280);
  });

  it('is idempotent across repeated saves', () => {
    let doc = save({ trustRow: 'VERIFIED' });
    for (let i = 0; i < 3; i += 1) doc = clampDesignConfigV2(doc, undefined, 'admin');
    expect(read(doc)).toEqual({ trustRow: 'VERIFIED' });
  });
});
