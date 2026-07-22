import { buildPublicDesignConfig, publicLuckyDraw } from '../src/utils/publicDesignConfig.js';

describe('publicLuckyDraw', () => {
  test('strips internal activation/terms ids from an enabled draw', () => {
    const out = publicLuckyDraw({
      enabled: true,
      closesAt: '2026-08-31',
      boostClosesAt: '2026-08-24',
      multiplier: 10,
      winners: 5,
      activationId: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
      termsVersionId: '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b',
      termsHash: 'a'.repeat(64),
    });
    expect(out).toEqual({
      enabled: true, closesAt: '2026-08-31', boostClosesAt: '2026-08-24', multiplier: 10, winners: 5,
    });
    expect(out.activationId).toBeUndefined();
    expect(out.termsVersionId).toBeUndefined();
    expect(out.termsHash).toBeUndefined();
  });

  test('disabled/absent draws return undefined', () => {
    expect(publicLuckyDraw(undefined)).toBeUndefined();
    expect(publicLuckyDraw({ enabled: false, closesAt: '2026-08-31' })).toBeUndefined();
  });

  it('exposes bookingUrl (display-only success CTA) but never internal ids', () => {
    const out = publicLuckyDraw({
      enabled: true,
      closesAt: '2026-10-30',
      bookingUrl: 'https://redeem.sg/book',
      activationId: '2c8ba713-ac13-4e2f-89a8-fb5c25bd6371',
    });
    expect(out.bookingUrl).toBe('https://redeem.sg/book');
    expect(out.activationId).toBeUndefined();
  });
});

describe('buildPublicDesignConfig', () => {
  test('unknown keys never leak; known lead-capture keys pass through', () => {
    const out = buildPublicDesignConfig({
      themeColor: '#fff',
      storyText: 'story',
      visibleFields: { dob: false },
      requiredFields: { email: false },
      fieldOrder: [{ id: 'r1', columns: ['name', 'phone'] }],
      sgPrOnly: true,
      excludeAdvisors: true,
      otpChannel: 'whatsapp',
      quiz: { questions: [] },
      termsContent: '<p>t</p>',
      // must NOT survive:
      internalRoutingNote: 'secret',
      buyerPriceCents: 12345,
      luckyDraw: { enabled: true, closesAt: '2026-08-31', termsHash: 'b'.repeat(64) },
    });
    expect(out.internalRoutingNote).toBeUndefined();
    expect(out.buyerPriceCents).toBeUndefined();
    expect(out.storyText).toBe('story');
    expect(out.fieldOrder).toEqual([{ id: 'r1', columns: ['name', 'phone'] }]);
    expect(out.luckyDraw).toEqual({ enabled: true, closesAt: '2026-08-31', multiplier: 10 });
  });

  test('regression: every key the public LeadCapture surface reads survives', () => {
    const keys = [
      'themeColor', 'heroFont', 'imageUrl', 'videoUrl', 'mediaType', 'storyText', 'storyEmphasis',
      'heroCtaLabel', 'ctaText', 'formHeadline', 'formSubheadline', 'formWidth',
      'brandWordmark', 'brandFooter', 'regulatoryFooter', 'termsContent', 'customerHost',
      'fieldOrder', 'visibleFields', 'requiredFields',
      'sgPrOnly', 'excludeAdvisors', 'dncCheckAtSubmit', 'otpChannel', 'thirdPartyDisclosure',
      'quiz', 'guidedReview',
    ];
    const raw = Object.fromEntries(keys.map((k) => [k, `v-${k}`]));
    const out = buildPublicDesignConfig(raw);
    for (const k of keys) expect(out[k]).toBe(`v-${k}`);
  });
});

// ── design_config v2 branch (Campaign Studio) — leaf-level rebuild ──
describe('buildPublicDesignConfig — v2 documents', () => {
  const v2Doc = {
    version: 2,
    template: {
      id: 'editorial',
      params: {
        editorial: { formWidth: 400, cardStyle: 'raised', evil: 'leak-me' },
        express: { trustLine: 'Trusted by 2,000 households', storyFold: false },
      },
    },
    theme: { preset: 'warm-cream', accent: '#D17029', font: 'fraunces', radius: 'soft', background: 'plain', internalNote: 'leak' },
    content: {
      wordmark: 'redeem.sg', headline: 'Get your voucher', subheadline: 'Fast.',
      story: 'S', emphasis: 'E', heroCtaLabel: 'Claim', submitLabel: 'Redeem Now',
      advertiserName: 'FairShare Rewards',
      footer: { regulatory: 'Reg', brand: 'Powered by MKTR' },
      media: {
        kind: 'image', src: '/uploads/x.jpg', alt: 'Basket',
        legacy: { imageUrl: '/uploads/x.jpg', videoUrl: '/uploads/old.mp4' },
      },
      routing: { secretFlow: true },
    },
    form: {
      fields: [{ id: 'name', visible: true, required: true, row: null, internalScore: 9 }],
      verification: 'sms',
      gates: { sgPr: true, advisorExclusion: false, dncCheck: true, shadowGate: true },
      terms: { template: 'default', html: '<p>T&C</p>', draftHtml: '<p>unpublished</p>' },
      internalNote: 'leak',
    },
    quiz: { enabled: true, steps: [], scoring: { method: 'profile-sum' } },
    guidedReview: { templateId: 'financial_readiness' },
    distribution: {
      host: 'redeem',
      featuredDrop: { enabled: true, title: 'Drop', valueLabel: 'S$10', emoji: '🛒', cap: 100, endsAt: '2026-08-15' },
      marketplace: { listed: true, title: 'Voucher', category: 'dining', valueLine: 'S$10', internalCost: 3.5 },
    },
    thirdPartyDisclosure: false,
    ai: { brief: { topic: 'secret internal brief' } },
    luckyDraw: {
      enabled: true, prize: 'Tokyo trip', closesAt: '2026-08-30', multiplier: 10,
      activationId: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
      termsVersionId: '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b',
      termsHash: 'a'.repeat(64),
    },
    futureTopLevel: { fine: true },
  };

  test('PR 5: marketplace.endsAt is never exposed even when a raw doc carries it (whitelist removal)', () => {
    const doc = structuredClone(v2Doc);
    doc.distribution.marketplace.endsAt = '2026-12-31';
    const out = buildPublicDesignConfig(doc);
    expect(out.distribution.marketplace.endsAt).toBeUndefined();
    expect(out.distribution.marketplace.title).toBe('Voucher'); // siblings intact
  });

  test('every public v2 key survives; version + host mirror present', () => {
    const out = buildPublicDesignConfig(v2Doc);
    expect(out.version).toBe(2);
    expect(out.template.id).toBe('editorial');
    expect(out.template.params.editorial).toEqual({ formWidth: 400, cardStyle: 'raised' });
    expect(out.theme).toEqual({ preset: 'warm-cream', accent: '#D17029', font: 'fraunces', radius: 'soft', background: 'plain' });
    expect(out.content).toMatchObject({
      wordmark: 'redeem.sg', headline: 'Get your voucher', submitLabel: 'Redeem Now',
      advertiserName: 'FairShare Rewards',
      footer: { regulatory: 'Reg', brand: 'Powered by MKTR' },
      media: { kind: 'image', src: '/uploads/x.jpg', alt: 'Basket' },
    });
    expect(out.form.fields).toEqual([{ id: 'name', visible: true, required: true, row: null }]);
    expect(out.form.verification).toBe('sms');
    expect(out.form.gates).toEqual({ sgPr: true, advisorExclusion: false, dncCheck: true });
    expect(out.form.terms).toEqual({ template: 'default', html: '<p>T&C</p>' });
    expect(out.quiz).toEqual(v2Doc.quiz);
    expect(out.guidedReview).toEqual(v2Doc.guidedReview);
    // Agree-all consent block: the OFF state must reach the public form
    // (default is ON, so only an explicit false ever matters).
    expect(out.thirdPartyDisclosure).toBe(false);
    expect(out.distribution.host).toBe('redeem');
    expect(out.customerHost).toBe('redeem');
    expect(out.distribution.marketplace).toMatchObject({ title: 'Voucher', category: 'dining', valueLine: 'S$10' });
    expect(out.luckyDraw).toEqual({ enabled: true, prize: 'Tokyo trip', closesAt: '2026-08-30', multiplier: 10 });
  });

  test('internal state never leaks: ai, media.legacy, listed, featuredDrop, draw ids, nested poison keys', () => {
    const out = buildPublicDesignConfig(v2Doc);
    expect(out.ai).toBeUndefined();
    expect(out.content.media.legacy).toBeUndefined();
    expect(out.distribution.marketplace.listed).toBeUndefined();
    expect(out.distribution.marketplace.internalCost).toBeUndefined();
    expect(out.distribution.featuredDrop).toBeUndefined();
    expect(out.luckyDraw.activationId).toBeUndefined();
    expect(out.luckyDraw.termsVersionId).toBeUndefined();
    expect(out.luckyDraw.termsHash).toBeUndefined();
    // Nested poison keys injected at every public subtree.
    expect(out.template.params.editorial.evil).toBeUndefined();
    expect(out.theme.internalNote).toBeUndefined();
    expect(out.content.routing).toBeUndefined();
    expect(out.form.internalNote).toBeUndefined();
    expect(out.form.gates.shadowGate).toBeUndefined();
    expect(out.form.terms.draftHtml).toBeUndefined();
    expect(out.form.fields[0].internalScore).toBeUndefined();
    // Unknown top-level keys are NOT public either — the whitelist rebuilds.
    expect(out.futureTopLevel).toBeUndefined();
  });
});
