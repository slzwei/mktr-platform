import { describe, it, expect } from 'vitest';
import { computeStudioReadiness, computeDesignChecks, drawCloseMismatchWithLive, sgtYmdFromInstant } from '../studioReadiness';
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

  it('PR 5: the old client draw-date-mismatch item is GONE (it compared YMD vs ISO instant — always true)', () => {
    const doc = docWith({}, { luckyDraw: { enabled: true, closesAt: '2026-10-30' }, form: docWith({ termsContent: 'x' }).form });
    // Real record shape: an ISO cutoff INSTANT for the same calendar day.
    const preview = { ops: { draw: { closesAt: '2026-10-30T16:00:00.000Z' } } };
    const items = computeDesignChecks({ campaign: CAMPAIGN, doc, marketplacePreview: preview });
    expect(items.filter((i) => i.sec === 'dist')).toHaveLength(0);
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

  it('NEVER claims READY while the server check is pending or failed (Codex diff #5)', () => {
    const pending = computeStudioReadiness({ campaign: CAMPAIGN, doc: docWith({}), serverReadiness: undefined, serverStatus: 'pending' });
    expect(pending.label).toBe('CHECKING…');
    expect(pending.tone).toBe('warn');

    const failed = computeStudioReadiness({ campaign: CAMPAIGN, doc: docWith({}), serverReadiness: null, serverStatus: 'error' });
    expect(failed.label).toBe('▲ 1');
    expect(failed.items[0]).toMatchObject({ source: 'delivery', sev: 'warn' });
    expect(failed.items[0].msg).toMatch(/Delivery readiness unavailable/);
  });

  it('calendar-impossible draw dates are blocked, not just shape-checked (Codex diff #7)', () => {
    const doc = docWith({ termsContent: '<p>t</p>' }, { luckyDraw: { enabled: true, closesAt: '2026-02-31' } });
    const items = computeDesignChecks({ campaign: CAMPAIGN, doc });
    expect(items).toContainEqual(expect.objectContaining({ sev: 'block', msg: expect.stringMatching(/valid close date/) }));
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

describe('PR 5 — server code mapping + WhatsApp dedupe + draw-date math', () => {
  it('mapped server codes deep-link (sec + code) and light the rail dots; unknown codes stay inert', () => {
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({}),
      serverReadiness: {
        applicable: true,
        ready: false,
        issues: [
          { level: 'critical', code: 'otp_send_unconfigured', message: 'SMS OTP cannot be sent.' },
          { level: 'warning', code: 'draw_record_missing', message: 'No draw record.' },
          { level: 'warning', code: 'some_future_code', message: 'Unknown thing.' },
        ],
      },
    });
    const otp = r.items.find((i) => i.code === 'otp_send_unconfigured');
    expect(otp).toMatchObject({ source: 'delivery', sev: 'block', sec: 'form' });
    expect(r.items.find((i) => i.code === 'draw_record_missing').sec).toBeNull(); // no draw controls in the rail
    expect(r.items.find((i) => i.code === 'some_future_code').sec).toBeNull(); // regression guard
    expect(r.sectionFlags.form).toBe(true);
  });

  it('retires the speculative WhatsApp design warning when the server VERIFIES the creds', () => {
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({ otpChannel: 'whatsapp' }),
      serverReadiness: { applicable: true, ready: true, issues: [], whatsappOtpConfigured: true },
    });
    expect(r.items).toHaveLength(0);
    expect(r.label).toBe('READY ✓');
  });

  it("retires the speculative warning when the server's own authoritative warning is listed (no double entry)", () => {
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({ otpChannel: 'whatsapp' }),
      serverReadiness: {
        applicable: true,
        ready: true,
        whatsappOtpConfigured: false,
        issues: [{ level: 'warning', code: 'otp_whatsapp_unconfigured', message: 'Falls back to SMS.' }],
      },
    });
    const whatsappItems = r.items.filter((i) => /whatsapp|creds|credentials|SMS/i.test(i.msg));
    expect(whatsappItems).toHaveLength(1);
    expect(whatsappItems[0].source).toBe('delivery');
  });

  it('keeps the static warning while the server has NOT answered (fail-noisy)', () => {
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({ otpChannel: 'whatsapp' }),
      serverReadiness: null,
      serverStatus: 'error',
    });
    expect(r.items.some((i) => i.source === 'design' && i.sec === 'form')).toBe(true);
  });

  it('STALE cached data through a FAILED refetch never clears the warning (Codex diff #6)', () => {
    // TanStack Query keeps the last successful data when a refetch errors —
    // the retire condition must be gated on a CURRENT success.
    const r = computeStudioReadiness({
      campaign: CAMPAIGN,
      doc: docWith({ otpChannel: 'whatsapp' }),
      serverReadiness: { applicable: true, ready: true, issues: [], whatsappOtpConfigured: true },
      serverStatus: 'error',
    });
    expect(r.items.some((i) => i.source === 'design' && i.sec === 'form')).toBe(true);
  });

  it('drawCloseMismatchWithLive: instant-correct — same SGT day agrees, different day mismatches, junk never warns', () => {
    // 2026-10-30 SGT ends at 2026-10-30T16:00:00.000Z (UTC+8, exclusive next-day start)
    expect(drawCloseMismatchWithLive('2026-10-30', '2026-10-30T16:00:00.000Z')).toBe(false);
    expect(drawCloseMismatchWithLive('2026-10-30', '2026-11-05T16:00:00.000Z')).toBe(true);
    expect(drawCloseMismatchWithLive(undefined, '2026-10-30T16:00:00.000Z')).toBe(false);
    expect(drawCloseMismatchWithLive('2026-10-30', undefined)).toBe(false);
    expect(drawCloseMismatchWithLive('not-a-date', 'also-not')).toBe(false);
  });

  it('sgtYmdFromInstant renders the INCLUSIVE last entry day', () => {
    expect(sgtYmdFromInstant('2026-10-30T16:00:00.000Z')).toBe('2026-10-30');
    expect(sgtYmdFromInstant('garbage')).toBeNull();
  });
});

describe('computeDesignChecks — draw T&Cs drifting from the campaign settings', () => {
  const drawDoc = (termsHtml, extras = {}) =>
    docWith({}, {
      luckyDraw: { enabled: true, closesAt: '2026-09-02' },
      form: { verification: 'sms', terms: { template: 'default', html: termsHtml }, ...extras },
    });
  const TERMS_18_SMS = '<p><strong>Eligibility &amp; entry:</strong> Open to Singapore residents aged 18 and above. Verify with the one-time SMS code.</p>';

  it('T&Cs stating 18+ on a 21+ campaign → warn (the exact prod drift)', () => {
    const items = computeDesignChecks({ campaign: { ...CAMPAIGN, min_age: 21 }, doc: drawDoc(TERMS_18_SMS) });
    expect(items).toContainEqual(
      expect.objectContaining({ sev: 'warn', sec: 'form', msg: expect.stringContaining('must be 18 and above') })
    );
  });

  it('matching age → no warning', () => {
    const items = computeDesignChecks({ campaign: { ...CAMPAIGN, min_age: 18 }, doc: drawDoc(TERMS_18_SMS) });
    expect(items.filter((i) => /and above/.test(i.msg || ''))).toHaveLength(0);
  });

  it('an under-18 draw warns TWICE: the illegal floor, and the 18+ terms that contradict it', () => {
    // Codex MAJOR #2: comparing against a raised floor hid the worst case —
    // terms promising 18+ while prospectService happily accepts a 16-year-old.
    const items = computeDesignChecks({ campaign: { ...CAMPAIGN, min_age: 16 }, doc: drawDoc(TERMS_18_SMS) });
    expect(items).toContainEqual(expect.objectContaining({ sev: 'warn', msg: expect.stringContaining('accepts entrants from age 16') }));
    expect(items).toContainEqual(expect.objectContaining({ sev: 'warn', msg: expect.stringContaining('must be 18 and above') }));
  });

  it('T&Cs promising an SMS code while the form verifies by WhatsApp → warn', () => {
    const doc = drawDoc(TERMS_18_SMS, { verification: 'whatsapp' });
    const items = computeDesignChecks({ campaign: { ...CAMPAIGN, min_age: 18 }, doc });
    expect(items).toContainEqual(
      expect.objectContaining({ sev: 'warn', msg: expect.stringContaining('one-time SMS code') })
    );
  });

  it('hand-written terms that use neither phrase never warn', () => {
    const doc = drawDoc('<p>Bespoke legal wording with no template phrasing at all.</p>');
    const items = computeDesignChecks({ campaign: { ...CAMPAIGN, min_age: 21 }, doc });
    expect(items.filter((i) => i.sev === 'warn')).toHaveLength(0);
  });
});
