/**
 * "Fill it for me" for the create-flow Details form — schema shape, the
 * sanitation boundary (model output is untrusted), and the DI'd entry point.
 */
import {
  detailsDraftSchema,
  buildDetailsDraftPrompts,
  sanitizeDetailsDraft,
  generateCampaignDetailsDraft,
  sgtToday,
} from '../src/services/campaignDetailsAiService.js';

const TODAY = '2026-07-22';

describe('detailsDraftSchema', () => {
  it('base schema carries the five detail fields; draw adds prizes/dates/multiplier', () => {
    const base = detailsDraftSchema(false);
    expect(Object.keys(base.properties)).toEqual(['name', 'startDate', 'endDate', 'minAge', 'maxAge']);
    expect(base.required).toContain('name');
    const draw = detailsDraftSchema(true);
    expect(draw.required).toEqual(expect.arrayContaining(['prizes', 'closesAt', 'boostClosesAt', 'multiplier']));
    expect(draw.properties.prizes.items.required).toEqual(['qty', 'name']);
  });
});

describe('buildDetailsDraftPrompts', () => {
  it('anchors today, names the type, and adds draw rules only for draws', () => {
    const p = buildDetailsDraftPrompts({ type: 'lucky_draw', draw: true, brief: 'iPhone draw', today: TODAY });
    expect(p.system).toContain(TODAY);
    expect(p.system).toContain('lucky-draw campaign');
    expect(p.system).toContain('award order');
    const q = buildDetailsDraftPrompts({ type: 'quiz', draw: false, brief: 'quiz', today: TODAY });
    expect(q.system).toContain('personality-quiz');
    expect(q.system).not.toContain('award order');
  });
});

describe('sanitizeDetailsDraft', () => {
  const drawRaw = {
    name: '  iPhone 17 Lucky Draw — August 2026  ',
    startDate: '2026-07-22',
    endDate: '2026-08-31',
    minAge: 16,
    maxAge: 40,
    prizes: [
      { qty: 1, name: 'iPhone 17 Pro 256GB' },
      { qty: 3, name: '  AirPods Pro  ' },
      { qty: 0, name: 'Zero qty coerces to 1' },
      { qty: 2, name: '' },
    ],
    closesAt: '2026-08-31',
    boostClosesAt: '2026-08-15',
    multiplier: 10,
  };

  it('clamps a full draw draft: whitespace, qty floor, 18+ floor, boost >= close', () => {
    const out = sanitizeDetailsDraft(drawRaw, { draw: true, today: TODAY });
    expect(out.name).toBe('iPhone 17 Lucky Draw — August 2026');
    expect(out.minAge).toBe(18); // draw floor beats the model's 16
    expect(out.prizes).toEqual([
      { qty: 1, name: 'iPhone 17 Pro 256GB' },
      { qty: 3, name: 'AirPods Pro' },
      { qty: 1, name: 'Zero qty coerces to 1' },
    ]);
    expect(out.closesAt).toBe('2026-08-31');
    // Direction CORRECTED: the engine requires boostClosesAt >= closesAt
    // ('must not be before closesAt'), because an entrant may complete their
    // session AFTER entries close. The fixture's 2026-08-15 is before the
    // close, so it snaps up — it used to be kept, printed into the pinned
    // T&Cs, and then 422'd at draw creation.
    expect(out.boostClosesAt).toBe('2026-08-31');
  });

  it('a boost AFTER the close is legitimate and survives', () => {
    expect(sanitizeDetailsDraft({ ...drawRaw, boostClosesAt: '2026-09-15' }, { draw: true, today: TODAY }).boostClosesAt).toBe('2026-09-15');
  });

  it('a boost before the close — or in the past — snaps up to the close date', () => {
    expect(sanitizeDetailsDraft({ ...drawRaw, boostClosesAt: '2026-08-15' }, { draw: true, today: TODAY }).boostClosesAt).toBe('2026-08-31');
    expect(sanitizeDetailsDraft({ ...drawRaw, boostClosesAt: '2026-01-01' }, { draw: true, today: TODAY }).boostClosesAt).toBe('2026-08-31');
  });

  it('draw drafts are unusable without prizes or a future close date', () => {
    expect(sanitizeDetailsDraft({ ...drawRaw, prizes: [] }, { draw: true, today: TODAY })).toBeNull();
    expect(sanitizeDetailsDraft({ ...drawRaw, closesAt: TODAY }, { draw: true, today: TODAY })).toBeNull();
    expect(sanitizeDetailsDraft({ ...drawRaw, closesAt: '2026-02-31' }, { draw: true, today: TODAY })).toBeNull();
  });

  it('draw endDate defaults to the close date when the model omits it', () => {
    const out = sanitizeDetailsDraft({ ...drawRaw, endDate: '' }, { draw: true, today: TODAY });
    expect(out.endDate).toBe('2026-08-31');
  });

  it('Codex folds: past start floors to today; past end drops; explicit empty end survives', () => {
    const out = sanitizeDetailsDraft(
      { name: 'Backdated Push', startDate: '2020-01-01', endDate: '2020-02-01' },
      { draw: false, today: TODAY }
    );
    expect(out.startDate).toBe(TODAY);
    expect(out.endDate).toBeUndefined();
    const cleared = sanitizeDetailsDraft({ name: 'Ongoing Push', endDate: '' }, { draw: false, today: TODAY });
    expect(cleared.endDate).toBe(''); // intentional "no end date" — the form may clear
  });

  it('Codex folds: name truncates at the campaignCreate limit (100), same-day boost survives, age 0 falls back', () => {
    const long = sanitizeDetailsDraft({ name: 'x'.repeat(120) }, { draw: false, today: TODAY });
    expect(long.name).toHaveLength(100);
    // A boost dated TODAY is necessarily before the close (closesAt must be
    // in the future), so it snaps up to the close — the engine would refuse it.
    const sameDayBoost = sanitizeDetailsDraft({ ...drawRaw, boostClosesAt: TODAY }, { draw: true, today: TODAY });
    expect(sameDayBoost.boostClosesAt).toBe('2026-08-31');
    const zeroAges = sanitizeDetailsDraft({ name: 'Zero Ages', minAge: 0, maxAge: 0 }, { draw: false, today: TODAY });
    expect(zeroAges.minAge).toBe(18);
    expect(zeroAges.maxAge).toBe(65);
  });

  it('non-draw: bad ages fall back to 18-65; endDate before startDate drops', () => {
    const out = sanitizeDetailsDraft(
      { name: 'Voucher Push', startDate: '2026-08-01', endDate: '2026-07-01', minAge: 70, maxAge: 20 },
      { draw: false, today: TODAY }
    );
    expect(out.minAge).toBe(18);
    expect(out.maxAge).toBe(65);
    expect(out.endDate).toBeUndefined();
    expect(sanitizeDetailsDraft({ name: 'ab' }, { draw: false, today: TODAY })).toBeNull();
  });
});

describe('generateCampaignDetailsDraft', () => {
  const settings = { provider: 'openai', apiKey: 'k', model: 'm' };
  const NOW = Date.parse('2026-07-22T04:00:00Z'); // 12:00 SGT

  it('threads settings + prompts into the transport and returns sanitized fields', async () => {
    const calls = [];
    const requestJson = async (args) => (calls.push(args), {
      name: 'iPhone 17 Lucky Draw',
      startDate: '2026-07-22',
      endDate: '',
      minAge: 21,
      maxAge: 45,
      prizes: [{ qty: 1, name: 'iPhone 17 Pro' }],
      closesAt: '2026-08-31',
      boostClosesAt: '2026-08-31',
      multiplier: 10,
    });
    const out = await generateCampaignDetailsDraft(
      { type: 'lucky_draw', brief: 'iPhone draw until end of August' },
      'user-1',
      { getSettings: async () => settings, requestJson, now: () => NOW }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: 'openai', model: 'm', schemaName: 'campaign_details_draft', maxOutputTokens: 6000 });
    expect(calls[0].system).toContain('2026-07-22');
    expect(calls[0].user).toContain('untrusted operator input');
    expect(out.fields.prizes).toEqual([{ qty: 1, name: 'iPhone 17 Pro' }]);
    expect(out.fields.endDate).toBe('2026-08-31'); // defaulted to closesAt
  });

  it('admin AI-settings guardrails ride the system prompt (withOrgStyle)', async () => {
    const calls = [];
    const requestJson = async (args) => (calls.push(args), { name: 'Guardrailed', startDate: '', endDate: '', minAge: 18, maxAge: 65 });
    await generateCampaignDetailsDraft({ type: 'lead_generation', brief: 'voucher push' }, 'u', {
      getSettings: async () => ({ ...settings, globalGuardrails: 'Never promise guaranteed returns.' }),
      requestJson,
      now: () => NOW,
    });
    expect(calls[0].system).toContain('Never promise guaranteed returns.');
  });

  it('502s when the model returns nothing usable', async () => {
    const requestJson = async () => ({ name: 'x' });
    await expect(
      generateCampaignDetailsDraft({ type: 'lead_generation', brief: 'anything here' }, 'u', {
        getSettings: async () => settings, requestJson, now: () => NOW,
      })
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('sgtToday reflects the Singapore calendar day', () => {
    expect(sgtToday(Date.parse('2026-07-22T17:00:00Z'))).toBe('2026-07-23'); // 01:00 SGT next day
    expect(sgtToday(Date.parse('2026-07-22T04:00:00Z'))).toBe('2026-07-22');
  });
});
