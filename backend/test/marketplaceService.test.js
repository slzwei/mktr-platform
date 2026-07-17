import { jest } from '@jest/globals';

// Mock models BEFORE the SUT is imported (Jest ESM pattern) — no DB needed.
const campaignFindAll = jest.fn();
const campaignFindOne = jest.fn();
const campaignFindByPk = jest.fn();
const activationFindAll = jest.fn();
const drawFindOne = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  Campaign: { findAll: campaignFindAll, findOne: campaignFindOne, findByPk: campaignFindByPk },
  Activation: { findAll: activationFindAll },
  RewardOffer: {},
  PartnerOrganisation: {},
  PartnerLocation: {},
  RewardOfferLocation: {},
  Draw: { findOne: drawFindOne },
}));

const loggerErrorMock = jest.fn();
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: loggerErrorMock, debug: jest.fn() },
}));

const {
  listMarketplaceCampaigns, getMarketplaceCampaign, composeOps, passesStaticGate,
  buildPublicDesignConfig, previewMarketplaceCampaign, isDrawEnded, __resetMarketplaceCache,
} = await import('../src/services/marketplaceService.js');

const NOW = Date.parse('2026-07-14T04:00:00Z');

const liveActivation = (over = {}) => ({
  allocatedQuantity: 40,
  issuedCount: 10,
  startDate: null,
  endDate: '2026-09-30T00:00:00Z',
  rewardOffer: {
    status: 'active',
    retailValue: '180.00',
    validityStart: null,
    validityEnd: '2026-08-31T00:00:00Z',
    claimExpiryDays: 14,
    redemptionExpiryDays: 60,
    partner: {
      brandName: 'Artelier Studio', tradingName: 'Artelier Pte Ltd',
      publicBlurb: 'Independent art school.', verifiedAt: '2026-01-01T00:00:00Z', partnerSince: 2019,
    },
    offerLocations: [
      { location: { name: 'Artelier @ Bugis', area: 'Central', isActive: true } },
      { location: { name: 'Closed Branch', area: 'West', isActive: false } },
    ],
  },
  ...over,
});

const listedCampaign = (over = {}) => ({
  id: 'cmp-1',
  slug: 'visual-arts-discovery',
  name: 'Visual Arts',
  type: 'lead_generation',
  status: 'active',
  is_active: true,
  min_age: null,
  max_age: null,
  metaPixelId: null,
  tiktokPixelId: null,
  design_config: {
    marketplaceListed: true,
    customerHost: 'redeem',
    category: 'art_creativity',
    ...over.design_config,
  },
  ...over,
});

beforeEach(() => {
  __resetMarketplaceCache();
  campaignFindAll.mockReset();
  campaignFindOne.mockReset();
  campaignFindByPk.mockReset();
  activationFindAll.mockReset();
  drawFindOne.mockReset();
  drawFindOne.mockResolvedValue(null);
});

describe('passesStaticGate', () => {
  test('agent flipping is_active alone can NEVER publish (marketplaceListed is the switch)', () => {
    expect(passesStaticGate(listedCampaign({ design_config: { marketplaceListed: false } }))).toBe(false);
    expect(passesStaticGate(listedCampaign({ design_config: {} }))).toBe(false);
  });

  test('archived/paused lifecycle never publishes even when flagged', () => {
    expect(passesStaticGate(listedCampaign({ status: 'archived' }))).toBe(false);
    expect(passesStaticGate(listedCampaign({ status: 'paused' }))).toBe(false);
    expect(passesStaticGate(listedCampaign({ is_active: false }))).toBe(false);
  });

  test('mktr-host campaigns and unsupported types are excluded', () => {
    expect(passesStaticGate(listedCampaign({ design_config: { marketplaceListed: true, customerHost: 'mktr' } }))).toBe(false);
    expect(passesStaticGate(listedCampaign({ type: 'quiz' }))).toBe(false);
    expect(passesStaticGate(listedCampaign({ type: 'guided_review' }))).toBe(false);
  });

  test('missing slug never publishes; full gate passes', () => {
    expect(passesStaticGate(listedCampaign({ slug: null }))).toBe(false);
    expect(passesStaticGate(listedCampaign())).toBe(true);
  });
});

describe('composeOps', () => {
  test('composes partner/capacity/expiry from the live chain; DECIMAL cast; offer locations only', async () => {
    activationFindAll.mockResolvedValue([liveActivation()]);
    const ops = await composeOps('cmp-1', { now: new Date(NOW) });
    expect(ops.partner.name).toBe('Artelier Studio');
    expect(ops.partner.verified).toBe(true);
    expect(ops.partner.since).toBe(2019);
    expect(ops.partner.locations).toEqual([{ name: 'Artelier @ Bugis', area: 'Central' }]); // inactive filtered
    expect(ops.capacity).toEqual({ total: 40, remaining: 30 });
    expect(ops.retail_value).toBe(180); // Number, not the Sequelize DECIMAL string
    // min(activation.endDate, offer.validityEnd)
    expect(new Date(ops.expiry).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  test('paused offer / expired validity / not-yet-started activation → null', async () => {
    activationFindAll.mockResolvedValue([liveActivation({ rewardOffer: { ...liveActivation().rewardOffer, status: 'paused' } })]);
    expect(await composeOps('cmp-1', { now: new Date(NOW) })).toBeNull();

    activationFindAll.mockResolvedValue([liveActivation({ rewardOffer: { ...liveActivation().rewardOffer, validityEnd: '2026-01-01T00:00:00Z' } })]);
    expect(await composeOps('cmp-1', { now: new Date(NOW) })).toBeNull();

    activationFindAll.mockResolvedValue([liveActivation({ startDate: '2027-01-01T00:00:00Z' })]);
    expect(await composeOps('cmp-1', { now: new Date(NOW) })).toBeNull();
  });

  test('multiple live activations = data corruption → null + error log', async () => {
    activationFindAll.mockResolvedValue([liveActivation(), liveActivation()]);
    expect(await composeOps('cmp-1', { now: new Date(NOW) })).toBeNull();
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  test('only an OPEN draw feeds ops.draw', async () => {
    activationFindAll.mockResolvedValue([liveActivation()]);
    drawFindOne.mockResolvedValue({ closesAt: '2026-08-31', boostClosesAt: '2026-08-24', multiplier: 10, status: 'open' });
    const ops = await composeOps('cmp-1', { now: new Date(NOW) });
    expect(drawFindOne).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'cmp-1', status: 'open' } }));
    expect(ops.draw).toEqual({ closesAt: '2026-08-31', boostClosesAt: '2026-08-24', multiplier: 10 });
  });
});

describe('DTO exclusions (the public-data boundary)', () => {
  test('luckyDraw internals, quiz config and unknown keys never appear', () => {
    const dc = buildPublicDesignConfig({
      marketplaceListed: true,
      customerHost: 'redeem',
      category: 'wellness',
      quiz: { questions: ['secret scoring'] },
      internalNotes: 'never',
      luckyDraw: {
        enabled: true, closesAt: '2026-08-31', winners: 5,
        activationId: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
        termsVersionId: '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b',
        termsHash: 'c'.repeat(64),
      },
    });
    expect(dc.quiz).toBeUndefined();
    expect(dc.internalNotes).toBeUndefined();
    expect(dc.customerHost).toBeUndefined();
    expect(dc.marketplaceListed).toBeUndefined();
    expect(dc.luckyDraw).toEqual({ enabled: true, closesAt: '2026-08-31', multiplier: 10, winners: 5 });
  });

  test('featuredDrop surfaces as a plain boolean (homepage metadata never leaks)', () => {
    const dc = buildPublicDesignConfig({ featuredDrop: { enabled: true, cap: 100, valueLabel: '$50' } });
    expect(dc.featuredDrop).toBe(true);
    expect(buildPublicDesignConfig({ featuredDrop: { enabled: false } }).featuredDrop).toBeUndefined();
  });
});

describe('listMarketplaceCampaigns', () => {
  test('lists only gated campaigns with resolvable ops; sold-out AND zero-allocation drop off', async () => {
    campaignFindAll.mockResolvedValue([
      listedCampaign(),
      listedCampaign({ id: 'cmp-2', slug: 'unlisted', design_config: { marketplaceListed: false } }),
      listedCampaign({ id: 'cmp-3', slug: 'sold-out-offer' }),
      // Zero allocation can never issue a reward (entitlementService requires
      // issued < allocated) — must not appear available.
      listedCampaign({ id: 'cmp-4', slug: 'zero-allocation' }),
    ]);
    activationFindAll.mockImplementation(async ({ where }) => {
      if (where.campaignId === 'cmp-3') return [liveActivation({ allocatedQuantity: 10, issuedCount: 10 })];
      if (where.campaignId === 'cmp-4') return [liveActivation({ allocatedQuantity: 0, issuedCount: 0 })];
      return [liveActivation()];
    });
    const list = await listMarketplaceCampaigns({ now: NOW });
    expect(list.map((c) => c.slug)).toEqual(['visual-arts-discovery']);
    expect(list[0].ops.capacity.remaining).toBe(30);
  });

  test('draws past their entry cutoff drop off the list (intake would 410)', async () => {
    campaignFindAll.mockResolvedValue([
      listedCampaign({
        id: 'cmp-d', slug: 'ended-draw',
        design_config: { marketplaceListed: true, customerHost: 'redeem', luckyDraw: { enabled: true, closesAt: '2026-07-01' } },
      }),
    ]);
    activationFindAll.mockResolvedValue([liveActivation()]);
    const list = await listMarketplaceCampaigns({ now: NOW }); // NOW = 2026-07-14
    expect(list).toEqual([]);
    expect(isDrawEnded({ luckyDraw: { enabled: true, closesAt: '2026-07-01' } }, NOW)).toBe(true);
    expect(isDrawEnded({ luckyDraw: { enabled: true, closesAt: '2026-08-31' } }, NOW)).toBe(false);
  });

  test('stale-on-error serves the last good list within the bound', async () => {
    campaignFindAll.mockResolvedValue([listedCampaign()]);
    activationFindAll.mockResolvedValue([liveActivation()]);
    const first = await listMarketplaceCampaigns({ now: NOW });
    expect(first).toHaveLength(1);
    campaignFindAll.mockRejectedValue(new Error('db down'));
    const second = await listMarketplaceCampaigns({ now: NOW + 120_000 }); // past TTL, inside stale bound
    expect(second).toHaveLength(1);
    await expect(listMarketplaceCampaigns({ now: NOW + 10 * 60_000 })).rejects.toThrow('db down'); // past bound
  });
});

describe('getMarketplaceCampaign', () => {
  test('rejects malformed slugs without touching the DB', async () => {
    expect(await getMarketplaceCampaign('../../etc/passwd')).toBeNull();
    expect(await getMarketplaceCampaign('UPPER')).toBeNull();
    expect(campaignFindOne).not.toHaveBeenCalled();
  });

  test('gated-out campaigns 404 (null); listed ones compose live', async () => {
    campaignFindOne.mockResolvedValue(listedCampaign({ design_config: { marketplaceListed: false } }));
    expect(await getMarketplaceCampaign('visual-arts-discovery')).toBeNull();

    campaignFindOne.mockResolvedValue(listedCampaign());
    activationFindAll.mockResolvedValue([liveActivation()]);
    const dto = await getMarketplaceCampaign('visual-arts-discovery');
    expect(dto.slug).toBe('visual-arts-discovery');
    expect(dto.ops.partner.name).toBe('Artelier Studio');
  });
});

describe('previewMarketplaceCampaign (authenticated designer preview)', () => {
  test('non-admins are scoped to own or staff-public campaigns', async () => {
    campaignFindOne.mockResolvedValue(null);
    activationFindAll.mockResolvedValue([]);
    const result = await previewMarketplaceCampaign('cmp-1', { user: { id: 'agent-1', role: 'agent' } });
    expect(result).toBeNull();
    const where = campaignFindOne.mock.calls[0][0].where;
    // The scoping clause must be present for non-admins (createdBy OR isPublic).
    expect(Object.getOwnPropertySymbols(where).length).toBeGreaterThan(0);
  });

  test('admins preview any campaign without the scoping clause', async () => {
    campaignFindOne.mockResolvedValue(listedCampaign());
    activationFindAll.mockResolvedValue([liveActivation()]);
    const result = await previewMarketplaceCampaign('cmp-1', { user: { id: 'admin-1', role: 'admin' } });
    expect(result.gate.listed).toBe(true);
    const where = campaignFindOne.mock.calls[0][0].where;
    expect(Object.getOwnPropertySymbols(where).length).toBe(0);
  });
});

// ── design_config v2 (Campaign Studio) — publication flag + content are nested ──
describe('v2 documents', () => {
  const v2Design = (over = {}) => ({
    version: 2,
    content: { headline: 'Get started' },
    form: {
      verification: 'whatsapp',
      gates: { sgPr: true, advisorExclusion: false, dncCheck: true },
      terms: { template: 'default', html: '<p>T</p>' },
      fields: [],
    },
    distribution: {
      host: 'redeem',
      marketplace: { listed: true, title: 'Migrated Offer', category: 'dining', valueLine: 'S$10 off', qrLanding: 'offer' },
    },
    ...over,
  });

  test('passesStaticGate honors distribution.marketplace.listed + distribution.host', () => {
    expect(passesStaticGate(listedCampaign({ design_config: v2Design() }))).toBe(true);
    const unlisted = v2Design();
    delete unlisted.distribution.marketplace.listed;
    expect(passesStaticGate(listedCampaign({ design_config: unlisted }))).toBe(false);
    const mktrHost = v2Design();
    mktrHost.distribution.host = 'mktr';
    expect(passesStaticGate(listedCampaign({ design_config: mktrHost }))).toBe(false);
  });

  test('buildPublicDesignConfig flattens a v2 doc to the v1 shape the flow consumes', () => {
    const out = buildPublicDesignConfig(v2Design());
    expect(out.name).toBe('Migrated Offer');
    expect(out.category).toBe('dining');
    expect(out.value_line).toBe('S$10 off');
    expect(out.qr_entry).toBe('detail');
    expect(out.otpChannel).toBe('whatsapp');
    expect(out.sgPrOnly).toBe(true);
    expect(out.dncCheckAtSubmit).toBe(true);
    expect(out.termsContent).toBe('<p>T</p>');
    expect(out.marketplaceListed).toBeUndefined(); // publication flag stays non-public
  });
});
