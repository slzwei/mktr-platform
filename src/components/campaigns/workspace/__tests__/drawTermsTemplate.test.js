import { describe, it, expect } from 'vitest';
import { buildDrawTermsHtml, formatLongDate, numberWords } from '../drawTermsTemplate';

describe('formatLongDate', () => {
  it('renders D Month YYYY and rejects junk', () => {
    expect(formatLongDate('2026-08-31')).toBe('31 August 2026');
    expect(formatLongDate('2026-13-01')).toBe('');
    expect(formatLongDate('junk')).toBe('');
    expect(formatLongDate(undefined)).toBe('');
  });
});

describe('buildDrawTermsHtml', () => {
  it('interpolates name, prize, dates, and multiplier', () => {
    const html = buildDrawTermsHtml({
      campaignName: 'iPhone Lucky Draw',
      prize: 'One (1) iPhone 17 Pro',
      closesAt: '2026-08-31',
      boostClosesAt: '2026-08-15',
      multiplier: 10,
    });
    expect(html).toContain('Redeem &times; MKTR &mdash; iPhone Lucky Draw');
    expect(html).toContain('One (1) iPhone 17 Pro');
    expect(html).toContain('23:59 (SGT) on 31 August 2026');
    expect(html).toContain('on or before 15 August 2026 earns you 10 entries instead of one');
    expect(html).toContain('fourteen (14) days');
    expect(html).toContain('redeem.sg/winners');
    expect(html).toContain('Do Not Call registry');
  });

  it('boost defaults to the close date and HTML in inputs is escaped', () => {
    const html = buildDrawTermsHtml({
      campaignName: 'X<script>alert(1)</script>',
      prize: 'A & B <b>prize</b>',
      closesAt: '2026-08-31',
    });
    expect(html).toContain('on or before 31 August 2026');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &lt;b&gt;prize&lt;/b&gt;');
  });

  it('pins the exact legacy singular clauses (regression: structured rollout must not shift them)', () => {
    const html = buildDrawTermsHtml({ campaignName: 'D', prize: 'One (1) iPhone 17 Pro', closesAt: '2026-08-31' });
    expect(html).toContain('<p><strong>Prize:</strong> One (1) iPhone 17 Pro. The prize is not exchangeable for cash and is subject to availability and any conditions advised to the winner.</p>');
    expect(html).toContain('One winner is drawn at random from all verified entries');
    expect(html).toContain("with the winner's masked details");
  });

  it('a structured single row (qty 1) emits byte-identical output to the legacy string signature', () => {
    const opts = { campaignName: 'D', closesAt: '2026-08-31', boostClosesAt: '2026-08-15', multiplier: 10 };
    expect(buildDrawTermsHtml({ ...opts, prizes: [{ qty: 1, name: 'One (1) iPhone 17 Pro' }] }))
      .toBe(buildDrawTermsHtml({ ...opts, prize: 'One (1) iPhone 17 Pro' }));
  });
});

describe('buildDrawTermsHtml — structured multi-prize', () => {
  const opts = {
    campaignName: 'Mega Draw',
    prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }],
    closesAt: '2026-08-31',
  };

  it('enumerates prizes in award order and states the winner total + award rule', () => {
    const html = buildDrawTermsHtml(opts);
    expect(html).toContain('<p><strong>Prizes:</strong></p>');
    expect(html.indexOf('One (1) &times; iPhone 17 Pro')).toBeLessThan(html.indexOf('Three (3) &times; $100 FairPrice Voucher'));
    expect(html).toContain('Four (4) winners are drawn at random from all verified entries');
    expect(html).toContain('Prizes are awarded in the order listed above, with each prize awarded its stated number of times');
    expect(html).toContain('Each verified mobile number can win at most one prize');
    expect(html).toContain('Winners are contacted directly by phone or SMS');
    expect(html).toContain("with each winner's masked details");
    expect(html).toContain('a replacement winner is drawn for that prize');
  });

  it('a single row with qty > 1 is already plural (quantity, not row count, drives the wording)', () => {
    const html = buildDrawTermsHtml({ campaignName: 'V', prizes: [{ qty: 3, name: '$100 Voucher' }], closesAt: '2026-08-31' });
    expect(html).toContain('Three (3) &times; $100 Voucher');
    expect(html).toContain('Three (3) winners are drawn at random');
    expect(html).not.toContain('One winner is drawn');
  });

  it('escapes each prize name individually in the list', () => {
    const html = buildDrawTermsHtml({
      campaignName: 'E',
      prizes: [{ qty: 2, name: '<img src=x onerror=alert(1)>' }, { qty: 1, name: 'A & B' }],
      closesAt: '2026-08-31',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('numberWords covers legal-style counts', () => {
    expect(numberWords(1)).toBe('One');
    expect(numberWords(4)).toBe('Four');
    expect(numberWords(19)).toBe('Nineteen');
    expect(numberWords(20)).toBe('Twenty');
    expect(numberWords(25)).toBe('Twenty-five');
    expect(numberWords(99)).toBe('Ninety-nine');
    expect(numberWords(100)).toBe('100');
  });
});
