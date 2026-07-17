import { describe, it, expect } from 'vitest';
import { computeStudioReadiness, computeDesignChecks } from '../studioReadiness';
import { upgradeDesignConfig } from '@/lib/designConfigV2';

const docWith = (v1 = {}, extras = {}) => ({ ...upgradeDesignConfig(v1), ...extras });
const CAMPAIGN = { id: 'c1', type: 'lead_generation' };

describe('computeDesignChecks — the client design mirror', () => {
  it('clean doc → no items', () => {
    expect(computeDesignChecks({ campaign: CAMPAIGN, doc: docWith({}) })).toEqual([]);
  });

  it('quiz campaign with quiz disabled → block, deep-linked to quiz', () => {
    const items = computeDesignChecks({ campaign: { ...CAMPAIGN, type: 'quiz' }, doc: docWith({}) });
    expect(items).toContainEqual(expect.objectContaining({ sev: 'block', sec: 'quiz' }));
  });

  it('enabled quiz with zero questions → block', () => {
    const doc = docWith({ quiz: { enabled: true, steps: [] } });
    expect(computeDesignChecks({ campaign: CAMPAIGN, doc })).toContainEqual(
      expect.objectContaining({ sev: 'block', msg: 'Quiz is enabled with zero questions.' })
    );
  });

  it('enabled draw mirrors BOTH server invariants: empty terms AND missing/invalid closesAt', () => {
    const doc = docWith({}, { luckyDraw: { enabled: true, closesAt: 'nope' } });
    const items = computeDesignChecks({ campaign: CAMPAIGN, doc });
    expect(items.filter((i) => i.sev === 'block')).toHaveLength(2);
  });

  it('hero CTA without media / whatsapp / low-contrast accent → warns with their sections', () => {
    const doc = docWith({ heroCtaLabel: 'Go', mediaType: 'none', otpChannel: 'whatsapp' });
    // Card-colored accent ON the warm-cream card — migration's nearest-preset
    // would legitimately pick a dark preset for a near-white accent, so pin it.
    doc.theme = { preset: 'warm-cream', accent: '#FFFAF0' };
    const items = computeDesignChecks({ campaign: CAMPAIGN, doc });
    expect(items.map((i) => i.sec).sort()).toEqual(['form', 'page', 'theme']);
    expect(items.every((i) => i.sev === 'warn')).toBe(true);
  });

  it('draw-date mismatch checks the LIVE draw record from ops (never in-doc marketplace endsAt)', () => {
    const doc = docWith({}, { luckyDraw: { enabled: true, closesAt: '2026-10-30' }, form: docWith({ termsContent: 'x' }).form });
    const preview = { ops: { draw: { closesAt: '2026-11-05' } } };
    const items = computeDesignChecks({ campaign: CAMPAIGN, doc, marketplacePreview: preview });
    expect(items).toContainEqual(expect.objectContaining({ sev: 'warn', sec: 'dist' }));
  });

  it('listed + incomplete server gate → info', () => {
    const doc = docWith({ marketplaceListed: true });
    const preview = { gate: { slug: false, active: true } };
    const items = computeDesignChecks({ campaign: CAMPAIGN, doc, marketplacePreview: preview });
    expect(items).toContainEqual(expect.objectContaining({ sev: 'info', sec: 'dist' }));
  });
});

describe('computeStudioReadiness — merged pill (Codex F8)', () => {
  it('server criticals force the red pill even with a clean doc', () => {
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({}),
      serverReadiness: { applicable: true, ready: false, issues: [{ level: 'critical', message: 'No funded agent pool.' }] },
    });
    expect(r.tone).toBe('bad');
    expect(r.label).toBe('▲ 1 TO REVIEW');
    expect(r.items[0]).toMatchObject({ source: 'delivery', sev: 'block', sec: null });
  });

  it('clean doc + ready server → READY ✓; brand_awareness (n/a) shows READY · N/A', () => {
    const ready = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({}),
      serverReadiness: { applicable: true, ready: true, issues: [] },
    });
    expect(ready.label).toBe('READY ✓');
    expect(ready.tone).toBe('ok');
    const na = computeStudioReadiness({
      campaign: { ...CAMPAIGN, type: 'brand_awareness' },
      doc: docWith({}),
      serverReadiness: { applicable: false, ready: true, issues: [] },
    });
    expect(na.label).toBe('READY · N/A');
  });

  it('design warns without blocks → amber count; sectionFlags feed the rail dots', () => {
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({ otpChannel: 'whatsapp' }),
      serverReadiness: { applicable: true, ready: true, issues: [] },
    });
    expect(r.tone).toBe('warn');
    expect(r.label).toBe('▲ 1');
    expect(r.sectionFlags).toEqual({ form: true });
  });
});
