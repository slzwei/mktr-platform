import { describe, it, expect } from 'vitest';
import { buildDrawTermsHtml, formatLongDate } from '../drawTermsTemplate';

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
});
