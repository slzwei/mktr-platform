/**
 * design_config v1→v2 migration semantics — every handoff §02 row, the
 * canonicalization loss ledger (L1–L5), round-trip guarantees, and the frozen
 * Warm Cream ↔ production-tokens parity.
 */
import { describe, it, expect } from 'vitest';

import {
  upgradeDesignConfig,
  downgradeDesignConfig,
  resolveTheme,
  classifyDesignConfigVersion,
} from '../designConfigV2.js';
import { TOKENS, RADIUS } from '../../components/campaigns/LeadCaptureLayout';
import {
  editorialBaseline,
  quizCampaign,
  adminRichDoc,
  legacyFlatOrder,
  anomalousOrder,
  youtubeDoc,
  youtubeShortDoc,
  youtubeShortsUrlDoc,
  staleMediaDoc,
  deadStyleKeysDoc,
  guidedReviewDoc,
  minimalDoc,
  overLimitDoc,
  TAGGED_DOCS,
} from '../../../test-fixtures/designConfigV1Docs.mjs';

const up = upgradeDesignConfig;
const down = downgradeDesignConfig;

describe('upgrade — migration table rows (editorial baseline)', () => {
  const v2 = up(editorialBaseline);

  it('row 1: themeColor → theme.accent + nearest preset (identity for the production accent)', () => {
    expect(v2.theme.accent).toBe('#D17029');
    expect(v2.theme.preset).toBe('warm-cream');
  });

  it('row 2: heroFont → theme.font', () => {
    expect(v2.theme.font).toBe('fraunces');
  });

  it('row 3: formWidth → template.params.editorial.formWidth, verbatim (no clamping in upgrade)', () => {
    expect(v2.template).toEqual({ id: 'editorial', params: expect.objectContaining({ editorial: { formWidth: 400, cardStyle: 'raised' } }) });
  });

  it('rows 4-7: field order, rows, visibility semantics, required canonicalization', () => {
    expect(v2.form.fields).toEqual([
      { id: 'name', visible: true, required: true, row: null },
      { id: 'phone', visible: true, required: true, row: null },
      { id: 'email', visible: true, required: true, row: null },
      { id: 'dob', visible: true, required: true, row: 'r-pair' },
      { id: 'postal', visible: true, required: false, row: 'r-pair' },
      { id: 'education', visible: false, required: false, row: null },
      { id: 'salary', visible: false, required: false, row: null },
    ]);
  });

  it('rows 8-9 + L4: image media with preserved legacy shadow', () => {
    expect(v2.content.media).toEqual({
      kind: 'image',
      src: '/uploads/campaign-assets/groceries.jpg',
      alt: '',
      legacy: { imageUrl: '/uploads/campaign-assets/groceries.jpg', videoUrl: '' },
    });
  });

  it('row 10: customerHost → distribution.host with a derived legacy mirror', () => {
    expect(v2.distribution.host).toBe('redeem');
    expect(v2.customerHost).toBe('redeem');
  });

  it('row 14: termsContent → form.terms with a seeded default template', () => {
    expect(v2.form.terms).toEqual({ template: 'default', html: editorialBaseline.termsContent });
  });

  it('row 16: content slots mapped 1:1 (submitLabel from ctaText)', () => {
    expect(v2.content).toMatchObject({
      wordmark: 'redeem.sg',
      headline: 'Get your $10 voucher',
      subheadline: editorialBaseline.formSubheadline,
      story: editorialBaseline.storyText,
      emphasis: editorialBaseline.storyEmphasis,
      heroCtaLabel: 'Claim my voucher',
      submitLabel: 'Redeem Now',
      footer: { regulatory: editorialBaseline.regulatoryFooter, brand: 'Powered by MKTR' },
    });
    expect(v2.content.advertiserName).toBeUndefined(); // read-time default, never baked
  });

  it('gates + verification map explicitly', () => {
    expect(v2.form.gates).toEqual({ sgPr: true, advisorExclusion: false, dncCheck: true });
    expect(v2.form.verification).toBe('sms');
  });
});

describe('upgrade — passthrough + canonicalization ledger', () => {
  it('L5: quiz passes through verbatim (production shape, never restructured)', () => {
    const v2 = up(quizCampaign);
    expect(v2.quiz).toEqual(quizCampaign.quiz);
  });

  it('L5: guidedReview + derived quiz coexistence passes through verbatim', () => {
    const v2 = up(guidedReviewDoc);
    expect(v2.guidedReview).toEqual(guidedReviewDoc.guidedReview);
    expect(v2.quiz).toEqual(guidedReviewDoc.quiz);
  });

  it('L5: dead style keys + unknown future keys survive (never dropped)', () => {
    const v2 = up(deadStyleKeysDoc);
    expect(v2.backgroundStyle).toBe('gradient');
    expect(v2.alignment).toBe('center');
    expect(v2.spacing).toBe('roomy');
    expect(v2.headlineSize).toBe('xl');
    expect(v2.someFutureKey).toEqual({ nested: true });
    const roundTripped = down(v2);
    expect(roundTripped.backgroundStyle).toBe('gradient');
    expect(roundTripped.someFutureKey).toEqual({ nested: true });
  });

  it('L1: required flags canonicalize (false|optional→false, truthy→true, absent→false)', () => {
    const v2 = up(legacyFlatOrder);
    const byId = Object.fromEntries(v2.form.fields.map((f) => [f.id, f]));
    expect(byId.dob.required).toBe(false); // 'optional'
    expect(byId.postal.required).toBe(true); // 'yes'
    expect(byId.education.required).toBe(false); // absent
    expect(byId.name.required).toBe(true); // locked
  });

  it('L2: education/salary absent → hidden (data-honest); explicit true stays visible', () => {
    expect(Object.fromEntries(up(minimalDoc).form.fields.map((f) => [f.id, f.visible]))).toEqual({
      name: true, email: true, phone: true, dob: true, postal: true, education: false, salary: false,
    });
    const v2 = up(quizCampaign);
    const byId = Object.fromEntries(v2.form.fields.map((f) => [f.id, f]));
    expect(byId.education.visible).toBe(true);
    expect(byId.salary.visible).toBe(true);
    expect(byId.dob.visible).toBe(false); // explicit false
  });

  it('L3: anomalous fieldOrder canonicalizes deterministically', () => {
    const v2 = up(anomalousOrder);
    expect(v2.form.fields.map((f) => f.id)).toEqual([
      'name', 'phone', 'dob', 'postal', 'email', 'education', 'salary',
    ]);
    const byId = Object.fromEntries(v2.form.fields.map((f) => [f.id, f]));
    expect(byId.phone.row).toBe('r1'); // surviving pair keeps its row id
    expect(byId.dob.row).toBe('r1');
    expect(byId.postal.row).toBe(null); // single-column row → unpaired
    expect(byId.name.row).toBe(null); // duplicate collapsed to first occurrence
  });

  it('media: youtube derivation uses the PRODUCTION matcher (shorts stay hosted video)', () => {
    expect(up(youtubeDoc).content.media.kind).toBe('youtube');
    expect(up(youtubeShortDoc).content.media.kind).toBe('youtube');
    expect(up(youtubeShortsUrlDoc).content.media.kind).toBe('video');
  });

  it('media: stale collision keeps kind none but preserves BOTH urls in the legacy shadow', () => {
    const media = up(staleMediaDoc).content.media;
    expect(media.kind).toBe('none');
    expect(media.src).toBe('');
    expect(media.legacy).toEqual({
      imageUrl: '/uploads/campaign-assets/old-hero.jpg',
      videoUrl: '/uploads/campaign-assets/old-hero.mp4',
    });
    const v1 = down(up(staleMediaDoc));
    expect(v1.imageUrl).toBe(staleMediaDoc.imageUrl);
    expect(v1.videoUrl).toBe(staleMediaDoc.videoUrl);
    expect(v1.mediaType).toBe('none');
  });

  it('no clamping in upgrade: over-limit + invalid values survive verbatim', () => {
    const v2 = up(overLimitDoc);
    expect(v2.content.headline).toHaveLength(120);
    expect(v2.template.params.editorial.formWidth).toBe(900);
    expect(v2.theme.accent).toBe('not-a-hex');
    expect(v2.theme.preset).toBe('warm-cream'); // invalid hex → parity preset
    expect(v2.theme.font).toBe('comic-sans');
    expect(v2.content.submitLabel).toBe('');
  });

  it('marketplace: full rename round-trip incl. sponsor, partials, listed', () => {
    const v2 = up(adminRichDoc);
    expect(v2.distribution.marketplace).toMatchObject({
      title: adminRichDoc.name,
      offerType: 'reward',
      qrLanding: 'offer',
      audienceAgeMin: 21,
      audienceAgeMax: 65,
      imageAlt: adminRichDoc.image_label,
      valueLine: adminRichDoc.value_line,
      days: ['sat', 'sun'],
      slots: ['10:00', '14:00'],
      activation: { required: true, type: 'consult', durationMins: 20, summary: 'Short activation call' },
      sponsor: { disclosed: true, kind: 'agency', disclosure: adminRichDoc.sponsor.disclosure },
      dataUse: adminRichDoc.content_blocks.data_use,
      listed: true,
    });
    expect(v2.distribution.marketplace.cancellation).toBeUndefined(); // partial stays partial
    const v1 = down(v2);
    expect(v1.name).toBe(adminRichDoc.name);
    expect(v1.offer_type).toBe('reward');
    expect(v1.age_range).toEqual({ min: 21, max: 65 });
    expect(v1.availability).toEqual({ days: ['sat', 'sun'], slots: ['10:00', '14:00'] });
    expect(v1.activation).toEqual(adminRichDoc.activation);
    expect(v1.sponsor).toEqual(adminRichDoc.sponsor);
    expect(v1.content_blocks).toEqual(adminRichDoc.content_blocks);
    expect(v1.marketplaceListed).toBe(true);
    expect(v1.featuredDrop).toEqual(adminRichDoc.featuredDrop);
    expect(v1.luckyDraw).toEqual(adminRichDoc.luckyDraw); // top-level passthrough both ways
  });

  it('sponsor: explicit null is preserved as a distinct state', () => {
    const v2 = up({ sponsor: null });
    expect(v2.distribution.marketplace.sponsor).toBeNull();
    expect(down(v2).sponsor).toBeNull();
  });
});

describe('round-trip guarantees', () => {
  const fixtures = {
    editorialBaseline, quizCampaign, adminRichDoc, legacyFlatOrder, anomalousOrder,
    youtubeDoc, staleMediaDoc, deadStyleKeysDoc, guidedReviewDoc, minimalDoc, overLimitDoc,
  };

  it('upgrade(downgrade(v2)) is the exact v2 doc, for every fixture', () => {
    for (const doc of Object.values(fixtures)) {
      const v2 = up(doc);
      expect(up(down(v2))).toEqual(v2);
    }
  });

  it('upgrade is idempotent', () => {
    for (const doc of Object.values(fixtures)) {
      const v2 = up(doc);
      expect(up(v2)).toEqual(v2);
    }
  });

  it('downgrade(upgrade(editorial)) preserves the renderer contract key-by-key', () => {
    const v1 = down(up(editorialBaseline));
    const renderKeys = [
      'formHeadline', 'formSubheadline', 'brandWordmark', 'storyText', 'storyEmphasis',
      'heroCtaLabel', 'ctaText', 'regulatoryFooter', 'brandFooter', 'imageUrl', 'videoUrl',
      'themeColor', 'heroFont', 'formWidth', 'mediaType', 'termsContent', 'customerHost',
      'otpChannel', 'sgPrOnly', 'excludeAdvisors', 'dncCheckAtSubmit', 'quiz',
    ];
    for (const key of renderKeys) {
      expect(v1[key], key).toEqual(editorialBaseline[key]);
    }
    // Field semantics survive canonically (explicit booleans, same pairing).
    expect(v1.visibleFields).toEqual({
      phone: true, dob: true, postal_code: true, education_level: false, monthly_income: false,
    });
    expect(v1.requiredFields).toEqual({
      dob: true, postal_code: false, education_level: false, monthly_income: false,
    });
    expect(v1.fieldOrder.map((r) => r.columns)).toEqual([
      ['name'], ['phone'], ['email'], ['dob', 'postal_code'], ['education_level'], ['monthly_income'],
    ]);
  });

  it('downgrade doubles as the legacy-view adapter: v1 in → v1 out', () => {
    expect(down(editorialBaseline)).toEqual(editorialBaseline);
  });
});

describe('version classification + unsupported handling', () => {
  it('classifies legacy / v2 / unsupported', () => {
    expect(classifyDesignConfigVersion(editorialBaseline)).toBe('legacy');
    expect(classifyDesignConfigVersion(up(editorialBaseline))).toBe('v2');
    expect(classifyDesignConfigVersion(TAGGED_DOCS.futureVersion)).toBe('unsupported');
    expect(classifyDesignConfigVersion(TAGGED_DOCS.stringVersion)).toBe('unsupported');
    expect(classifyDesignConfigVersion(null)).toBe('legacy');
  });

  it('upgrade/downgrade throw on unsupported versions', () => {
    expect(() => up(TAGGED_DOCS.futureVersion)).toThrow(/Unsupported design_config version/);
    expect(() => down(TAGGED_DOCS.stringVersion)).toThrow(/Unsupported design_config version/);
  });
});

describe('Warm Cream preset ↔ production tokens (frozen parity)', () => {
  it('resolveTheme(warm-cream) reproduces LeadCaptureLayout TOKENS + RADIUS exactly', () => {
    const t = resolveTheme({ preset: 'warm-cream', accent: null });
    expect(t.bg).toBe(TOKENS.pagebg);
    expect(t.storyCard).toBe(TOKENS.storyCard);
    expect(t.card).toBe(TOKENS.formCard);
    expect(t.modal).toBe(TOKENS.modal);
    expect(t.ink).toBe(TOKENS.ink);
    expect(t.bodyText).toBe(TOKENS.body);
    expect(t.muted).toBe(TOKENS.muted);
    expect(t.hairline).toBe(TOKENS.hairline);
    expect(t.divider).toBe(TOKENS.divider);
    expect(t.accent).toBe(TOKENS.accent);
    expect(t.accentDeep).toBe(TOKENS.accentDeep);
    expect(t.danger).toBe(TOKENS.required);
    expect(t.success).toBe(TOKENS.success);
    expect(t.r).toEqual({
      card: RADIUS.card, input: RADIUS.pill, btn: RADIUS.pill,
      modal: RADIUS.modal, media: RADIUS.image, check: RADIUS.checkbox,
    });
  });
});
