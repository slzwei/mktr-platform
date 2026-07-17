/**
 * Real-shaped v1 design_config fixtures — the shared corpus for the design_config
 * v2 migration (upgrade/downgrade), the clamp v1-golden oracle, and the twin
 * lock-step tests (docs/plans/campaign-studio-implementation-prompt.md, PR 1).
 *
 * Shapes mirror what the classic DesignEditor + admin API actually write today
 * (verified against DesignEditor.jsx seeding, ContentPanel/FieldOrderEditor
 * writes, normalizeMarketplaceContent, and git history: flat fieldOrder writes
 * in 494d4ea, row objects since 27acd89). Every migration-table row and every
 * canonicalization edge in the loss ledger has a fixture here — extend this
 * file when a new edge is found, never inline one-off docs in tests.
 */

import { quizDef } from './protectionPersonalityQuiz.mjs';

/** Editorial baseline: Warm-Cream voucher campaign, all copy slots, image hero,
 * explicit field flags, 2-col row pairing — the parity anchor. */
export const editorialBaseline = {
  formHeadline: 'Get your $10 voucher',
  formSubheadline: 'Your voucher code arrives by SMS after verification.',
  brandWordmark: 'redeem.sg',
  storyText:
    'We are celebrating our new rewards programme by giving away 2,000 vouchers to Singapore households.\n\nSign up, verify your mobile number, and your voucher code arrives within minutes.',
  storyEmphasis: 'S$10, yours in under a minute.',
  heroCtaLabel: 'Claim my voucher',
  ctaText: 'Redeem Now',
  regulatoryFooter:
    'Redeem (a service of MKTR PTE. LTD., UEN: 202507548M) operates this referral platform.',
  brandFooter: 'Powered by MKTR',
  imageUrl: '/uploads/campaign-assets/groceries.jpg',
  themeColor: '#D17029',
  heroFont: 'fraunces',
  formWidth: 400,
  mediaType: 'image',
  videoUrl: '',
  termsContent: '<h4>Campaign Terms</h4><p>One registration per person.</p>',
  customerHost: 'redeem',
  otpChannel: 'sms',
  sgPrOnly: true,
  excludeAdvisors: false,
  dncCheckAtSubmit: true,
  visibleFields: { phone: true, dob: true, postal_code: true },
  requiredFields: { dob: true, postal_code: false },
  fieldOrder: [
    { id: 'r-name', columns: ['name'] },
    { id: 'r-phone', columns: ['phone'] },
    { id: 'r-email', columns: ['email'] },
    { id: 'r-pair', columns: ['dob', 'postal_code'] },
    { id: 'r-edu', columns: ['education_level'] },
    { id: 'r-inc', columns: ['monthly_income'] },
  ],
  quiz: null,
};

/** Quiz campaign carrying the PRODUCTION quiz shape (steps/scoring/resultProfiles)
 * verbatim from the shared scoring fixture — migration must pass it through 1:1. */
export const quizCampaign = {
  formHeadline: 'Ready to raise your ceiling?',
  formSubheadline: 'Claim your complimentary 20-minute session.',
  themeColor: '#8A5BB8',
  heroFont: 'space-grotesk',
  customerHost: 'redeem',
  otpChannel: 'whatsapp',
  sgPrOnly: false,
  excludeAdvisors: true,
  dncCheckAtSubmit: true,
  visibleFields: { education_level: true, monthly_income: true, dob: false, postal_code: false },
  requiredFields: {},
  quiz: quizDef,
};

/** Admin-rich doc: enabled featured drop + lucky draw + full marketplace content
 * (exactly the key shapes normalizeMarketplaceContent emits, incl. sponsor and
 * partial content_blocks) + marketplaceListed. */
export const adminRichDoc = {
  formHeadline: 'Win a 4D3N Tokyo getaway for two',
  themeColor: '#232529',
  heroFont: 'playfair',
  customerHost: 'redeem',
  mediaType: 'video',
  videoUrl: '/uploads/campaign-assets/tokyo-hero.mp4',
  imageUrl: '/uploads/campaign-assets/tokyo-fallback.jpg',
  termsContent: '<h4>Draw Terms</h4><p>Winner drawn 31 Aug 2026.</p>',
  featuredDrop: {
    enabled: true,
    title: 'Tokyo Getaway Lucky Draw',
    valueLabel: 'S$3.8k',
    emoji: '🧳',
    cap: 2000,
    endsAt: '2026-08-15',
  },
  luckyDraw: {
    enabled: true,
    prize: '4D3N Tokyo getaway for two',
    closesAt: '2026-08-30',
    boostClosesAt: '2026-08-15',
    multiplier: 10,
    winners: 1,
  },
  marketplaceListed: true,
  name: 'Tokyo Getaway Lucky Draw — 4D3N for two',
  category: 'family & lifestyle',
  offer_type: 'reward',
  mode: 'online',
  qr_entry: 'detail',
  age_range: { min: 21, max: 65 },
  school_levels: ['primary', 'seconda'],
  dsa_related: false,
  showCapacity: true,
  availability: { days: ['Sat', 'Sun'], slots: ['10:00', '14:00'] },
  inclusions: ['Return flights for two', '3 nights hotel (4-star)'],
  image_label: 'Tokyo skyline at dusk',
  activation: { required: true, type: 'consult', duration_mins: 20, summary: 'Short activation call' },
  sponsor: { kind: 'agency', disclosure: 'Sponsored by MKTR Travel Partners.' },
  value_line: 'Grand prize worth S$3,800',
  content_blocks: { data_use: 'Used for draw administration only.' },
};

/** Legacy flat fieldOrder (pre-27acd89 write shape) + sparse everything else. */
export const legacyFlatOrder = {
  formHeadline: 'Legacy campaign',
  fieldOrder: ['name', 'phone', 'email', 'dob', 'postal_code'],
  visibleFields: { dob: true },
  requiredFields: { dob: 'optional', postal_code: 'yes' },
  themeColor: '#3B82F6',
};

/** fieldOrder anomalies the live renderer tolerates element-by-element:
 * mixed string/row entries, duplicate field, omitted locked field (email),
 * empty row, unknown field id. Canonicalization must be deterministic. */
export const anomalousOrder = {
  fieldOrder: [
    'name',
    { id: 'r1', columns: ['phone', 'dob'] },
    { id: 'r2', columns: [] },
    'name',
    { id: 'r3', columns: ['mystery_field'] },
    { id: 'r4', columns: ['postal_code'] },
  ],
  visibleFields: { education_level: true },
  requiredFields: { education_level: true },
};

/** YouTube-shaped videoUrl (watch form) — migrates to media.kind 'youtube'. */
export const youtubeDoc = {
  mediaType: 'video',
  videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  heroCtaLabel: 'Watch and win',
  formHeadline: 'Video campaign',
};

/** youtu.be short + shorts-style URL (shorts must stay kind 'video' — the
 * production matcher accepts only watch/youtu.be/embed 11-char forms). */
export const youtubeShortDoc = {
  mediaType: 'video',
  videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
};
export const youtubeShortsUrlDoc = {
  mediaType: 'video',
  videoUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
};

/** Stale-media collision: mediaType 'none' with BOTH URLs still set (the editor
 * never clears the inactive key) — media.legacy must preserve both. */
export const staleMediaDoc = {
  mediaType: 'none',
  imageUrl: '/uploads/campaign-assets/old-hero.jpg',
  videoUrl: '/uploads/campaign-assets/old-hero.mp4',
  heroCtaLabel: 'Ghost CTA',
};

/** Dead style keys (authored historically in 494d4ea) + unknown future key —
 * both must survive as unknown-key passthrough, never be dropped. */
export const deadStyleKeysDoc = {
  formHeadline: 'Styled relic',
  backgroundStyle: 'gradient',
  alignment: 'center',
  spacing: 'roomy',
  headlineSize: 'xl',
  someFutureKey: { nested: true },
};

/** guidedReview + derived qualification quiz coexistence — the real shape
 * GuidedReviewDesigner saves (spread of full stored design). */
export const guidedReviewDoc = {
  guidedReview: {
    templateId: 'financial_readiness',
    hero: { headline: 'Know where your money stands.' },
    trust: { partner: 'Example Advisory Pte. Ltd.' },
  },
  quiz: { enabled: true, mode: 'qualification', quizId: 'gr-derived', version: 1 },
  sgPrOnly: true,
  themeColor: '#0E7C6B',
};

/** Absent-everything minimal doc. */
export const minimalDoc = {};

/** Empty-string and boundary values (over-limit copy passes v1 unclamped —
 * upgrade must NOT clamp; only a v2 SAVE clamps). */
export const overLimitDoc = {
  formHeadline: 'H'.repeat(120),
  formWidth: 900,
  themeColor: 'not-a-hex',
  heroFont: 'comic-sans',
  ctaText: '',
};

/** All migration/oracle fixtures keyed by name (stable iteration order). */
export const V1_DOCS = {
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
};

/** Version-tagged adversarial payloads for the write-gate tests (NOT migration
 * inputs): hybrid alias smuggling, future version, malformed v2. */
export const TAGGED_DOCS = {
  hybridAliasSmuggle: {
    version: 2,
    template: { id: 'editorial', params: {} },
    theme: { preset: 'warm-cream', accent: null, font: 'fraunces', radius: 'soft', background: 'plain' },
    content: { headline: 'Innocent looking' },
    form: { fields: [], verification: 'sms', gates: {}, terms: {} },
    distribution: { host: 'redeem' },
    // Legacy aliases an agent could smuggle past a naive v2 clamp — existing
    // readers (featuredDropsService/marketplaceService) trust these paths.
    featuredDrop: { enabled: true, title: 'Smuggled drop' },
    marketplaceListed: true,
  },
  futureVersion: { version: 3, content: { headline: 'From the future' } },
  malformedV2: { version: 2, template: 'editorial' },
  stringVersion: { version: '2', formHeadline: 'Tagged with a string' },
};
