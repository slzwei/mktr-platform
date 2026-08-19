/**
 * Studio-shaped v2 clamp proofs (Campaign Studio PR 3 — TEST-ONLY, no backend
 * behavior change). The Studio adopts the server-clamped response as its new
 * baseline, so the clamp must be IDEMPOTENT over Studio-authored documents
 * (a second clamp of a clamped doc is byte-identical → no phantom dirty), and
 * the admin-only subtrees must round-trip by role exactly as the policies say.
 */
import { describe, it, expect } from '@jest/globals';
import { clampDesignConfigV2 } from '../src/utils/designConfigV2Clamp.js';
import { upgradeDesignConfig, readLegacyView } from '../src/utils/designConfigV2.js';

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
    expect(out.template.params.checklist).toEqual({
      boostStep: 'inline', heroBand: true, railStyle: 'line',
      // Step-rail copy seeds empty = "use the template's built-in default".
      step1Title: '', step1Body: '', step2Title: '', step2Body: '', step3Title: '', step3Body: '',
    });
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

describe('content.submitFontSize — submit CTA size (v2-only, L7)', () => {
  const save = (submitFontSize) => clampDesignConfigV2({
    version: 2,
    content: { headline: 'H', submitFontSize },
  }, undefined, 'admin');
  const read = (doc) => doc.content?.submitFontSize;

  it('keeps an in-range number, rounded to an integer', () => {
    expect(read(save(18))).toBe(18);
    expect(read(save(17.6))).toBe(18);
  });

  it('clamps to the LIMITS twins range', () => {
    expect(read(save(6))).toBe(12);
    expect(read(save(96))).toBe(24);
  });

  it('drops non-numbers (incl. the Number()-coercible junk) — absent stays absent', () => {
    for (const junk of ['18', '', null, true, [], [18], {}, NaN, Infinity, undefined]) {
      expect(read(save(junk))).toBeUndefined();
    }
  });

  it('is idempotent across repeated saves', () => {
    let doc = save(21);
    for (let i = 0; i < 3; i += 1) doc = clampDesignConfigV2(doc, undefined, 'admin');
    expect(read(doc)).toBe(21);
  });
});

describe('featuredDrop.endsAt inherits luckyDraw.closesAt (PR-2, F9)', () => {
  it('an endsAt-less drop on a draw campaign inherits the close date; explicit endsAt wins; non-draw untouched', () => {
    const doc = studioDoc();
    delete doc.distribution.featuredDrop.endsAt;
    const clamped = clampDesignConfigV2(doc, undefined, 'admin');
    expect(clamped.distribution.featuredDrop.endsAt).toBe('2026-10-30'); // = luckyDraw.closesAt

    const explicit = studioDoc(); // endsAt '2026-10-30' set explicitly
    explicit.distribution.featuredDrop.endsAt = '2026-11-15';
    expect(clampDesignConfigV2(explicit, undefined, 'admin').distribution.featuredDrop.endsAt).toBe('2026-11-15');

    const nonDraw = studioDoc();
    delete nonDraw.distribution.featuredDrop.endsAt;
    nonDraw.luckyDraw = { enabled: false };
    expect(clampDesignConfigV2(nonDraw, undefined, 'admin').distribution.featuredDrop.endsAt).toBeUndefined();
  });

  it('the inherit is idempotent (no phantom Studio dirty)', () => {
    const doc = studioDoc();
    delete doc.distribution.featuredDrop.endsAt;
    const once = clampDesignConfigV2(doc, undefined, 'admin');
    const twice = clampDesignConfigV2(once, undefined, 'admin');
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('clampProfileQuestions — custom questions (studio-custom-questions §3)', () => {
  const v2 = (pq) => ({
    version: 2,
    template: { id: 'express', params: {} },
    theme: { preset: 'warm-cream' },
    content: {},
    form: {},
    distribution: { host: 'redeem' },
    profileQuestions: pq,
  });
  const clampPq = (pq) => clampDesignConfigV2(v2(pq), undefined, 'admin').profileQuestions;

  it('sanitizes the full matrix: bad shapes/types/ids dropped, dup option ids dropped, labels/prompts trimmed, text rows lose options', () => {
    const out = clampPq({
      enabled: true,
      questionIds: ['language', 'c_ok0001', 'c_txt001', 'c_badid', 'not_real'],
      requiredIds: ['c_ok0001', 'c_ghost1'],
      custom: [
        { id: 'c_ok0001', type: 'single', prompt: '  Which?  ', options: [{ id: 'o1', label: ' A ' }, { id: 'o1', label: 'dup' }, { id: 'o2', label: 'B' }, { id: 'BAD ID', label: 'x' }] },
        { id: 'c_txt001', type: 'text', prompt: 'Notes', options: [{ id: 'o1', label: 'stripped' }] },
        { id: 'c_badid', type: 'single', prompt: 'x' }, // id fails the pattern? (c_badid matches — but no options → dropped)
        { id: 'not-valid', type: 'single', prompt: 'x', options: [] },
        { id: 'c_notype', type: 'wat', prompt: 'x', options: [] },
        'garbage',
      ],
    });
    expect(out.questionIds).toEqual(['language', 'c_ok0001', 'c_txt001']);
    expect(out.requiredIds).toEqual(['c_ok0001']);
    expect(out.custom).toEqual([
      { id: 'c_ok0001', type: 'single', prompt: 'Which?', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }] },
      { id: 'c_txt001', type: 'text', prompt: 'Notes', options: [] },
    ]);
  });

  it('cap ordering: 5 unreferenced defs never cost a referenced one; a 9th option is dropped; caps hold (5 custom / 10 total)', () => {
    const unref = [1, 2, 3, 4, 5].map((n) => ({ id: `c_unref${n}`, type: 'text', prompt: `U${n}`, options: [] }));
    const out = clampPq({
      enabled: true,
      questionIds: ['c_real01'],
      requiredIds: [],
      custom: [...unref, { id: 'c_real01', type: 'text', prompt: 'The real one', options: [] }],
    });
    expect(out.questionIds).toEqual(['c_real01']);
    expect(out.custom.map((d) => d.id)).toEqual(['c_real01']);

    const nineOptions = Array.from({ length: 9 }, (_, i) => ({ id: `o${i + 1}`, label: `L${i + 1}` }));
    const capped = clampPq({
      enabled: true,
      questionIds: ['c_opts01'],
      custom: [{ id: 'c_opts01', type: 'multi', prompt: 'Many?', options: nineOptions }],
    });
    expect(capped.custom[0].options).toHaveLength(8);

    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `c_q${n}0000`, type: 'text', prompt: `Q${n}`, options: [] }));
    const sixOut = clampPq({ enabled: true, questionIds: six.map((d) => d.id), custom: six });
    expect(sixOut.questionIds).toHaveLength(5);
    expect(sixOut.custom).toHaveLength(5);
  });

  it('a campaign with ONLY custom questions is fully valid; zero-valid disables; existing docs keep their exact key set', () => {
    const onlyCustom = clampPq({
      enabled: true,
      questionIds: ['c_solo01'],
      custom: [{ id: 'c_solo01', type: 'text', prompt: 'Solo', options: [] }],
    });
    expect(onlyCustom.enabled).toBe(true);

    const zeroValid = clampPq({ enabled: true, questionIds: ['c_ghost1'], custom: [] });
    expect(zeroValid.enabled).toBe(false);

    // No custom input ⇒ no custom key — existing docs round-trip byte-stable.
    const legacyShape = clampPq({ enabled: true, questionIds: ['language'], requiredIds: [] });
    expect(Object.keys(legacyShape).sort()).toEqual(['enabled', 'questionIds', 'requiredIds', 'showZh']);
  });

  it('clamp is IDEMPOTENT over a custom-question doc (Studio adopts the clamped response — no phantom dirty)', () => {
    const doc = v2({
      enabled: true,
      questionIds: ['language', 'c_ok0001'],
      requiredIds: ['c_ok0001'],
      custom: [{ id: 'c_ok0001', type: 'multi', prompt: 'Pick', promptZh: '选', options: [{ id: 'o1', label: 'A', labelZh: '甲' }, { id: 'o2', label: 'B' }] }],
    });
    const once = clampDesignConfigV2(doc, undefined, 'admin');
    const twice = clampDesignConfigV2(once, undefined, 'admin');
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('form.terms.prudentialAd — Prudential introducer disclosure toggle', () => {
  const v2terms = (terms) => ({
    version: 2,
    template: { id: 'express', params: {} },
    theme: { preset: 'warm-cream' },
    content: {},
    form: { terms },
  });

  it('survives the clamp with a trimmed, capped Facebook Business Name', () => {
    const out = clampDesignConfigV2(
      v2terms({ template: 'marketing', html: '<p>T</p>', prudentialAd: true, prudentialFbName: `  Redeem SG${'x'.repeat(200)}  ` }),
      undefined, 'admin'
    );
    expect(out.form.terms.prudentialAd).toBe(true);
    expect(out.form.terms.prudentialFbName.length).toBeLessThanOrEqual(80);
    expect(out.form.terms.prudentialFbName.startsWith('Redeem SG')).toBe(true);
    expect(out.form.terms.html).toBe('<p>T</p>');
  });

  it('OFF (or junk) strips both keys — fbName never rides without the flag', () => {
    const out = clampDesignConfigV2(
      v2terms({ template: 'default', html: '<p>T</p>', prudentialAd: 'yes', prudentialFbName: 'Redeem SG' }),
      undefined, 'admin'
    );
    expect(out.form.terms.prudentialAd).toBeUndefined();
    expect(out.form.terms.prudentialFbName).toBeUndefined();
  });

  it('keeps terms alive when the flag is on with NO custom html', () => {
    const out = clampDesignConfigV2(v2terms({ prudentialAd: true }), undefined, 'admin');
    expect(out.form.terms).toEqual({ template: 'default', prudentialAd: true });
  });

  it('round-trips v1 → v2 → v1 (legacy view feeds the funnel dialog)', () => {
    const doc = upgradeDesignConfig({ termsContent: '<p>T</p>', prudentialAd: true, prudentialFbName: 'Redeem SG' });
    expect(doc.form.terms).toMatchObject({ html: '<p>T</p>', prudentialAd: true, prudentialFbName: 'Redeem SG' });
    expect(doc.prudentialAd).toBeUndefined(); // consumed, not top-level residue
    const legacy = readLegacyView(doc);
    expect(legacy.prudentialAd).toBe(true);
    expect(legacy.prudentialFbName).toBe('Redeem SG');
    expect(readLegacyView(upgradeDesignConfig({ termsContent: '<p>T</p>' })).prudentialAd).toBeUndefined();
  });
});
