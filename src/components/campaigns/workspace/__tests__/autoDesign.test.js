import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock only the network boundary — the real requestCopyDraft, studioLooks
// composer and designConfigV2 upgrade all run, so the composed document is
// asserted through the genuine buildLookDoc semantics (never mocked away).
vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }));

import { apiClient } from '@/api/client';
import { generateCampaignDesign } from '../autoDesign';

const POSTER_LOOK = {
  name: 'Dusk Poster',
  template: { id: 'poster', params: { overlay: 'dusk' } },
  theme: { preset: 'ink-slate', accent: null },
  media: { kind: 'image', note: 'Warm hawker-centre scene' },
  draft: [{ path: 'content.headline', label: 'Headline', section: 'page', value: 'Look headline' }],
};
const SPOTLIGHT_LOOK = {
  name: 'Quiz Spotlight',
  template: { id: 'spotlight', params: {} },
  theme: { preset: 'warm-cream' },
  draft: [],
};
const draftResolves = (proposals) => apiClient.post.mockResolvedValueOnce({ data: { proposals } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateCampaignDesign', () => {
  it('requests full mode from the base template and composes the first usable look', async () => {
    draftResolves([POSTER_LOOK]);
    const doc = await generateCampaignDesign({
      campaign: { id: 'c1', design_config: {} },
      brief: '1 x iphone 17 pro lucky draw for singaporeans or pr. 21 to 65 years old only.',
    });

    // Mirrors the Studio's full-mode request exactly.
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const [url, body] = apiClient.post.mock.calls[0];
    expect(url).toBe('/admin/ai/copy-draft');
    expect(body).toMatchObject({ campaignId: 'c1', templateId: 'editorial', mode: 'full', scope: null, regen: 0 });
    expect(body.brief.topic).toBe('1 x iphone 17 pro lucky draw for singaporeans or pr. 21 to 65 years old only.');

    // The composed doc genuinely carries the look's template + theme + copy.
    expect(doc.template.id).toBe('poster');
    expect(doc.template.params.poster).toMatchObject({ overlay: 'dusk' });
    expect(doc.theme.preset).toBe('ink-slate');
    expect(doc.content.headline).toBe('Look headline');
  });

  it('skips a blocked look (Spotlight needs a quiz) and picks the next usable one', async () => {
    draftResolves([SPOTLIGHT_LOOK, POSTER_LOOK]);
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'voucher push' });
    expect(doc.template.id).toBe('poster');
  });

  it('returns null when every proposal is blocked', async () => {
    draftResolves([SPOTLIGHT_LOOK]); // no quiz on this campaign → blocked
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'voucher push' });
    expect(doc).toBeNull();
  });

  it('returns null when the provider returns no proposals', async () => {
    draftResolves([]);
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'voucher push' });
    expect(doc).toBeNull();
  });

  it('a draw campaign keeps luckyDraw enabled so draw-template looks stay usable', async () => {
    const DRAW_LOOK = { name: 'Postcard', template: { id: 'postcard', params: {} }, theme: { preset: 'warm-cream' }, draft: [] };
    draftResolves([DRAW_LOOK]);
    const doc = await generateCampaignDesign({
      campaign: {
        id: 'c-draw',
        design_config: { luckyDraw: { enabled: true, prize: 'iPhone 17 Pro', closesAt: '2026-08-31' }, termsContent: '<p>terms</p>' },
      },
      brief: 'iphone draw',
    });
    expect(doc.template.id).toBe('postcard');
    expect(doc.luckyDraw.enabled).toBe(true); // seed carried through
  });

  it('propagates a thrown copy-draft error to the caller (create flow catches it)', async () => {
    apiClient.post.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 409 }));
    await expect(
      generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'voucher push' })
    ).rejects.toBeTruthy();
  });

  it('applies the common FIELDS + TERMS sections beside the look (rowApplyValue shapes)', async () => {
    apiClient.post.mockResolvedValueOnce({
      data: {
        proposals: [POSTER_LOOK],
        fields: [
          { id: 'name', visible: true, required: true },
          { id: 'email', visible: true, required: true },
          { id: 'phone', visible: true, required: true },
          { id: 'dob', visible: true, required: true },
          { id: 'postal', visible: false },
          { id: 'education', visible: false },
          { id: 'salary', visible: false },
        ],
        terms: { template: 'default', html: '<h3>Terms</h3><p>Drafted legal copy.</p>' },
      },
    });
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'voucher push' });
    expect(doc.template.id).toBe('poster'); // look still composed
    expect(doc.form.terms).toEqual({ template: 'default', html: '<h3>Terms</h3><p>Drafted legal copy.</p>' });
    expect(doc.form.fields).toHaveLength(7);
    expect(doc.form.fields[3]).toEqual({ id: 'dob', visible: true, required: true, row: null });
    expect(doc.form.fields[4]).toEqual({ id: 'postal', visible: false, required: false, row: null });
  });

  it('draw campaigns compose terms from the deterministic drawTerms FACTS, never LLM text', async () => {
    apiClient.post.mockResolvedValueOnce({
      data: {
        proposals: [{ name: 'Postcard', template: { id: 'postcard', params: {} }, theme: { preset: 'warm-cream' }, draft: [] }],
        drawTerms: {
          campaignName: 'iPhone 17 Pro Lucky Draw',
          prizes: [{ qty: 1, name: 'iPhone 17 Pro' }],
          closesAt: '2026-08-31',
          multiplier: 10,
          minAge: 21,
          verification: 'sms',
        },
      },
    });
    const doc = await generateCampaignDesign({
      campaign: { id: 'c-draw', design_config: { luckyDraw: { enabled: true, prize: 'iPhone 17 Pro', closesAt: '2026-08-31' } } },
      brief: 'iphone draw',
    });
    expect(doc.form.terms.template).toBe('default');
    expect(doc.form.terms.html).toContain('iPhone 17 Pro Lucky Draw'); // platform template output
    expect(doc.form.terms.html).toContain('21'); // minAge interpolated
  });

  it('terms/fields still land when NO look is usable — legal + form beat returning nothing', async () => {
    apiClient.post.mockResolvedValueOnce({
      data: {
        proposals: [SPOTLIGHT_LOOK], // blocked (no quiz)
        terms: { template: 'default', html: '<p>Drafted terms.</p>' },
      },
    });
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'voucher push' });
    expect(doc).not.toBeNull();
    expect(doc.template.id).toBe('editorial'); // base template untouched — no look adopted
    expect(doc.form.terms.html).toBe('<p>Drafted terms.</p>');
  });
});

describe('generateCampaignDesign — eligibility gates + verification (headless)', () => {
  const resolvesWith = (data) => apiClient.post.mockResolvedValueOnce({ data });

  it('applies the gates the brief earned, MERGING so the DNC gate survives', async () => {
    resolvesWith({ proposals: [POSTER_LOOK], gates: { sgPr: true, advisorExclusion: false } });
    const doc = await generateCampaignDesign({
      campaign: {
        id: 'c1',
        design_config: { version: 2, form: { gates: { sgPr: false, advisorExclusion: false, dncCheck: true } } },
      },
      brief: '1 x iphone 17 pro lucky draw for singaporeans or pr. 21 to 65 years old only.',
    });
    expect(doc.form.gates).toEqual({ sgPr: true, advisorExclusion: false, dncCheck: true });
  });

  it('applies the verification channel the server cleared', async () => {
    resolvesWith({ proposals: [POSTER_LOOK], verification: 'whatsapp' });
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'x' });
    expect(doc.form.verification).toBe('whatsapp');
  });

  it('ignores a verification value the server did not clamp to the enum', async () => {
    resolvesWith({ proposals: [POSTER_LOOK], verification: 'telegram' });
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'x' });
    expect(doc.form?.verification).not.toBe('telegram');
  });

  it('draw terms quote the channel this pass just APPLIED, not the stored one', async () => {
    resolvesWith({
      proposals: [{ name: 'Postcard', template: { id: 'postcard', params: {} }, theme: { preset: 'warm-cream' }, draft: [] }],
      verification: 'whatsapp',
      drawTerms: {
        campaignName: 'iPhone 17 Pro Lucky Draw',
        prizes: [{ qty: 1, name: 'iPhone 17 Pro' }],
        closesAt: '2026-09-02',
        boostClosesAt: '2026-09-02',
        multiplier: 10,
        minAge: 21,
        verification: 'sms', // STORED channel — superseded by the applied one
      },
    });
    const doc = await generateCampaignDesign({
      campaign: { id: 'c-draw', design_config: { luckyDraw: { enabled: true, closesAt: '2026-09-02' } } },
      brief: 'iphone draw',
    });
    expect(doc.form.verification).toBe('whatsapp');
    expect(doc.form.terms.html).toContain('one-time WhatsApp code');
    expect(doc.form.terms.html).not.toContain('one-time SMS code');
    // …and the age floor is the campaign's, not the template default.
    expect(doc.form.terms.html).toContain('aged 21 and above');
  });

  it('gates still land when every look is blocked (screening beats returning nothing)', async () => {
    resolvesWith({ proposals: [SPOTLIGHT_LOOK], gates: { sgPr: true, advisorExclusion: false } });
    const doc = await generateCampaignDesign({ campaign: { id: 'c1', design_config: {} }, brief: 'x' });
    expect(doc).not.toBeNull();
    expect(doc.form.gates.sgPr).toBe(true);
  });
});
