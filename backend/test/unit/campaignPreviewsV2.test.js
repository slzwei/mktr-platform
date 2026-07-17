/**
 * v2 preview-snapshot lifecycle — a Studio-saved (v2) campaign's shareable
 * preview resolves through the version-aware public whitelist BOTH while the
 * campaign row exists (fresh design) and after it is deleted (stored snapshot).
 */
import { jest } from '@jest/globals';
import './../setup.js';

const Campaign = { findByPk: jest.fn(), findOne: jest.fn() };
const CampaignPreview = { findOne: jest.fn(), findOrCreate: jest.fn() };
jest.unstable_mockModule('../../src/models/index.js', () => ({ Campaign, CampaignPreview }));

const { resolveSlug } = await import('../../src/services/campaignPreviewService.js');

const v2Doc = {
  version: 2,
  template: { id: 'editorial', params: { editorial: { cardStyle: 'raised' } } },
  theme: { preset: 'warm-cream', accent: null },
  content: { headline: 'Migrated', media: { kind: 'none', src: '', alt: '', legacy: { imageUrl: '/x.jpg' } } },
  form: { verification: 'sms', gates: { sgPr: true }, fields: [] },
  distribution: { host: 'redeem', featuredDrop: { enabled: true, title: 'D' } },
  ai: { brief: { topic: 'secret' } },
};

const previewRow = {
  campaignId: 'c1',
  slug: 'p-slug',
  snapshot: { id: 'c1', name: 'Snap', type: 'lead_generation', is_active: true, design_config: v2Doc },
};

beforeEach(() => jest.clearAllMocks());

describe('v2 snapshot lifecycle', () => {
  it('campaign alive: resolves with the whitelisted v2 doc (version kept, internals stripped)', async () => {
    CampaignPreview.findOne.mockResolvedValue(previewRow);
    Campaign.findByPk.mockResolvedValue({ id: 'c1', name: 'Live Name', type: 'lead_generation', min_age: 18, max_age: 65, design_config: v2Doc });
    const { snapshot } = await resolveSlug('p-slug');
    expect(snapshot.design_config.version).toBe(2);
    expect(snapshot.design_config.content.headline).toBe('Migrated');
    expect(snapshot.design_config.ai).toBeUndefined();
    expect(snapshot.design_config.content.media.legacy).toBeUndefined();
    expect(snapshot.design_config.distribution.featuredDrop).toBeUndefined();
    expect(snapshot.name).toBe('Live Name');
  });

  it('campaign deleted: still resolves from the stored snapshot, whitelisted', async () => {
    CampaignPreview.findOne.mockResolvedValue(previewRow);
    Campaign.findByPk.mockResolvedValue(null);
    const { snapshot } = await resolveSlug('p-slug');
    expect(snapshot.design_config.version).toBe(2);
    expect(snapshot.design_config.ai).toBeUndefined();
    expect(snapshot.name).toBe('Snap');
  });
});
