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
});
