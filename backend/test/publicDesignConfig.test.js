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
      'sgPrOnly', 'excludeAdvisors', 'dncCheckAtSubmit', 'otpChannel', 'quiz', 'guidedReview',
    ];
    const raw = Object.fromEntries(keys.map((k) => [k, `v-${k}`]));
    const out = buildPublicDesignConfig(raw);
    for (const k of keys) expect(out[k]).toBe(`v-${k}`);
  });
});
