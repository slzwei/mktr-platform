/**
 * drawConsistency unit tests (PR-3, draw-launch-integrity §3 / Codex R1
 * CX15/CX17). The primary fixtures are the REAL production documents from the
 * 2026-07-24 incident: the v2 terms (iPad Pro + "aged 21 and above") that
 * shipped live under an iPhone/25–65 campaign, and the corrected v3. If this
 * suite is green, that incident is mechanically unshippable.
 */
import {
  checkDrawConsistency, checkDrawRecordDrift, htmlToText, extractAgeMentions, longDate, prizeShort,
} from '../src/utils/drawConsistency.js';
import { sgtDayEndExclusiveMs } from '../src/utils/sgtTime.js';

// Abridged but byte-faithful clauses from the live documents (entities intact).
const V2_TERMS_IPAD_21 = [
  '<h3>Redeem &times; MKTR &mdash; iPhone 17 Pro 256GB Lucky Draw, September 2026</h3>',
  '<p><strong>Promoter:</strong> MKTR PTE. LTD. (UEN 202507548M), Singapore. Redeem is a service of MKTR PTE. LTD.</p>',
  '<p><strong>Prize:</strong> iPad Pro. The prize is not exchangeable for cash and is subject to availability and any conditions advised to the winner.</p>',
  '<p><strong>Eligibility &amp; entry:</strong> Open to Singapore residents aged 21 and above. Entry is free. Complete the form and verify your mobile number with the one-time SMS code &mdash; one entry per verified mobile number.</p>',
  '<p><strong>Entry period:</strong> Entries close at 23:59 (SGT) on 30 September 2026. Entries received after that time are not eligible.</p>',
  '<p><strong>The draw:</strong> One winner is drawn at random from all verified entries after the entry period closes, in a process witnessed by MKTR staff. Completing a complimentary financial-review session on or before 30 September 2026 earns you 10 entries instead of one.</p>',
].join('\n');

const V3_TERMS_IPHONE_25_65 = V2_TERMS_IPAD_21
  .replace('iPad Pro', 'iPhone 17 Pro 256GB (colour subject to availability)')
  .replace('aged 21 and above', 'aged 25 to 65');

const FACTS = {
  minAge: 25,
  maxAge: 65,
  luckyDraw: { enabled: true, prize: 'iPhone 17 Pro 256GB', prizes: [{ qty: 1, name: 'iPhone 17 Pro 256GB' }], closesAt: '2026-09-30', multiplier: 10 },
  contentHeadline: 'Win an iPhone 17 PRO',
  contentStory: 'One iPhone 17 Pro winner will be drawn.',
};

const codes = (arr) => arr.map((i) => i.code);

describe('htmlToText / extractAgeMentions / helpers', () => {
  it('strips markup, decodes entities, collapses whitespace', () => {
    expect(htmlToText('<p><strong>Prize:</strong>  iPad&nbsp;Pro &mdash; &times;10 &amp; more</p>'))
      .toBe('Prize: iPad Pro — ×10 & more');
    expect(htmlToText('&#215; &#x2014;')).toBe('× —');
  });

  it('parses every age-clause shape the templates and operators write', () => {
    expect(extractAgeMentions('open to residents aged 25 to 65 only')).toEqual([{ min: 25, max: 65, open: false }]);
    expect(extractAgeMentions('aged 21 and above')).toEqual([{ min: 21, max: null, open: true }]);
    expect(extractAgeMentions('aged 21 or older')).toEqual([{ min: 21, max: null, open: true }]);
    expect(extractAgeMentions('aged 25–65')).toEqual([{ min: 25, max: 65, open: false }]); // en-dash
    expect(extractAgeMentions('aged 25-65')).toEqual([{ min: 25, max: 65, open: false }]);
    expect(extractAgeMentions('aged 30')).toEqual([{ min: 30, max: null, open: false }]);
    expect(extractAgeMentions('no ages here')).toEqual([]);
  });

  it('longDate + prizeShort', () => {
    expect(longDate('2026-09-30')).toBe('30 September 2026');
    expect(longDate('garbage')).toBe('');
    expect(prizeShort('iPhone 17 Pro 256GB')).toBe('iphone 17 pro');
  });
});

describe('checkDrawConsistency — the July incident, mechanically', () => {
  it('THE regression: the live v2 doc (iPad + 21-and-above) under iPhone/25–65 facts → BOTH hard contradictions', () => {
    const { hard } = checkDrawConsistency({ ...FACTS, termsHtml: V2_TERMS_IPAD_21 });
    expect(codes(hard)).toEqual(expect.arrayContaining(['DRAW_PRIZE_MISMATCH', 'DRAW_TERMS_AGE_MISMATCH']));
  });

  it('the corrected v3 doc is fully clean — hard AND soft (prize parenthetical + long date + multiplier all parse)', () => {
    const { hard, soft } = checkDrawConsistency({ ...FACTS, termsHtml: V3_TERMS_IPHONE_25_65 });
    expect(hard).toEqual([]);
    expect(soft).toEqual([]);
  });

  it('the prize check is CLAUSE-scoped: a heading mentioning the right prize cannot bless a wrong Prize clause (the actual incident shape)', () => {
    // V2 heading says "iPhone 17 Pro 256GB Lucky Draw…" — whole-doc containment would pass.
    const { hard } = checkDrawConsistency({ ...FACTS, termsHtml: V2_TERMS_IPAD_21 });
    expect(codes(hard)).toContain('DRAW_PRIZE_MISMATCH');
  });

  it('operator-authored terms with NO "Prize:" label → soft-unverified, never a block', () => {
    const freeform = '<p>Winners receive a lovely gift. Open to Singapore residents aged 25 to 65.</p>';
    const out = checkDrawConsistency({ ...FACTS, termsHtml: freeform });
    expect(codes(out.soft)).toContain('DRAW_TERMS_PRIZE_UNVERIFIED');
    expect(codes(out.hard)).not.toContain('DRAW_PRIZE_MISMATCH');
  });

  it('silent for disabled draws and empty terms', () => {
    expect(checkDrawConsistency({ ...FACTS, luckyDraw: { enabled: false }, termsHtml: V2_TERMS_IPAD_21 })).toEqual({ hard: [], soft: [] });
    expect(checkDrawConsistency({ ...FACTS, termsHtml: '' })).toEqual({ hard: [], soft: [] });
  });

  it('config contradicting ITSELF (prize vs prizes[0]) is hard', () => {
    const { hard } = checkDrawConsistency({
      ...FACTS,
      luckyDraw: { ...FACTS.luckyDraw, prizes: [{ qty: 1, name: 'iPad Pro' }] },
      termsHtml: V3_TERMS_IPHONE_25_65,
    });
    expect(codes(hard)).toContain('DRAW_PRIZE_INTERNAL_MISMATCH');
  });

  it('age asymmetries are hard in BOTH directions: open-ended terms on a capped campaign, capped terms on an open campaign', () => {
    const openTerms = V3_TERMS_IPHONE_25_65.replace('aged 25 to 65', 'aged 25 and above');
    const capped = checkDrawConsistency({ ...FACTS, termsHtml: openTerms });
    expect(codes(capped.hard)).toContain('DRAW_TERMS_AGE_MISMATCH');

    const noMax = checkDrawConsistency({ ...FACTS, maxAge: null, termsHtml: V3_TERMS_IPHONE_25_65 });
    expect(codes(noMax.hard)).toContain('DRAW_TERMS_AGE_MISMATCH');

    const matchedOpen = checkDrawConsistency({ ...FACTS, maxAge: null, termsHtml: openTerms });
    expect(matchedOpen.hard).toEqual([]);
  });

  it('unparseable / ambiguous age clauses are SOFT — operator-authored legal text never hard-blocks', () => {
    const noAge = V3_TERMS_IPHONE_25_65.replace('aged 25 to 65', 'adults resident in Singapore');
    expect(codes(checkDrawConsistency({ ...FACTS, termsHtml: noAge }).soft)).toContain('DRAW_TERMS_AGE_UNPARSEABLE');
    expect(checkDrawConsistency({ ...FACTS, termsHtml: noAge }).hard).toEqual([]);

    const twoAges = `${V3_TERMS_IPHONE_25_65}\n<p>Staff aged 18 to 99 may not enter.</p>`;
    expect(codes(checkDrawConsistency({ ...FACTS, termsHtml: twoAges }).soft)).toContain('DRAW_TERMS_AGE_AMBIGUOUS');
  });

  it('date and multiplier deviations are SOFT and only fire on found-and-different', () => {
    const wrongDate = checkDrawConsistency({
      ...FACTS,
      luckyDraw: { ...FACTS.luckyDraw, closesAt: '2026-10-15' },
      termsHtml: V3_TERMS_IPHONE_25_65,
    });
    expect(codes(wrongDate.soft)).toContain('DRAW_TERMS_DATE_MISMATCH');

    const wrongMult = checkDrawConsistency({
      ...FACTS,
      luckyDraw: { ...FACTS.luckyDraw, multiplier: 5 },
      termsHtml: V3_TERMS_IPHONE_25_65,
    });
    expect(codes(wrongMult.soft)).toContain('DRAW_TERMS_MULTIPLIER_MISMATCH');
  });

  it('marketing shorthand clears the lenient bar; genuinely divergent copy is soft-flagged', () => {
    const clean = checkDrawConsistency({ ...FACTS, termsHtml: V3_TERMS_IPHONE_25_65 });
    expect(codes(clean.soft)).not.toContain('DRAW_CONTENT_PRIZE_DIVERGES');

    const divergent = checkDrawConsistency({
      ...FACTS,
      contentHeadline: 'Win a Tokyo Getaway',
      contentStory: 'Fly to Japan on us.',
      termsHtml: V3_TERMS_IPHONE_25_65,
    });
    expect(codes(divergent.soft)).toContain('DRAW_CONTENT_PRIZE_DIVERGES');
  });
});

describe('checkDrawRecordDrift (CX17 — the live record is the engine)', () => {
  const LD = { enabled: true, multiplier: 10, boostClosesAt: '2026-09-30', activationId: '92dd875f-4293-4305-9a5f-293f8930bd61', termsVersionId: 'aaaa1111-a422-4ad6-a447-ae36ca63e8c8' };
  const ROW = {
    multiplier: 10,
    boostClosesAt: new Date(sgtDayEndExclusiveMs('2026-09-30')),
    activationId: '92DD875F-4293-4305-9A5F-293F8930BD61', // case must not matter
    termsVersionId: 'aaaa1111-a422-4ad6-a447-ae36ca63e8c8',
  };

  it('aligned config ⇄ record → no drift', () => {
    expect(checkDrawRecordDrift({ luckyDraw: LD, drawRow: ROW })).toEqual([]);
  });

  it('multiplier / boost-cutoff / rail-stamp drift each flagged with the field named', () => {
    const drift = checkDrawRecordDrift({
      luckyDraw: { ...LD, multiplier: 5, boostClosesAt: '2026-10-15', activationId: null },
      drawRow: ROW,
    });
    expect(drift.map((d) => d.field).sort()).toEqual(['activationId', 'boostClosesAt', 'multiplier']);
    expect(drift.every((d) => d.code === 'DRAW_LIVE_RECORD_DRIFT')).toBe(true);
  });

  it('termsVersionId drifts only when BOTH sides carry one (a config-only pin is not engine drift)', () => {
    const bothDiffer = checkDrawRecordDrift({ luckyDraw: { ...LD, termsVersionId: 'bbbb2222-a422-4ad6-a447-ae36ca63e8c8' }, drawRow: ROW });
    expect(bothDiffer.map((d) => d.field)).toContain('termsVersionId');
    const recordOnly = checkDrawRecordDrift({ luckyDraw: { ...LD, termsVersionId: undefined }, drawRow: ROW });
    expect(recordOnly.map((d) => d.field)).not.toContain('termsVersionId');
  });

  it('silent without a record or with the draw disabled', () => {
    expect(checkDrawRecordDrift({ luckyDraw: LD, drawRow: null })).toEqual([]);
    expect(checkDrawRecordDrift({ luckyDraw: { ...LD, enabled: false }, drawRow: ROW })).toEqual([]);
  });
});
