/**
 * QR scan → offer-detail landing (trackerController.marketplaceDetailPath, via
 * trackSlug) — FIRST coverage of the qr_entry branch, including design_config
 * v2 documents (distribution.marketplace.qrLanding 'offer' ↔ v1 'detail').
 */
import { jest } from '@jest/globals';
import './../setup.js';

const findByPk = jest.fn();
jest.unstable_mockModule('../../src/models/index.js', () => ({
  Campaign: { findByPk },
}));
const trackerService = {
  resolveQrTag: jest.fn(),
  recordScan: jest.fn(async () => ({ id: 'scan-1' })),
  createAttribution: jest.fn(async () => ({ token: 'tok', expiresAt: new Date() })),
  generateSessionId: jest.fn(() => 'sid-1'),
  buildRedirectParams: jest.fn(() => 'campaign_id=c1&slug=s'),
  resolveSession: jest.fn(),
};
jest.unstable_mockModule('../../src/services/trackerService.js', () => trackerService);
const passesStaticGate = jest.fn();
jest.unstable_mockModule('../../src/services/marketplaceService.js', () => ({ passesStaticGate }));

const { trackSlug } = await import('../../src/controllers/trackerController.js');

const listedCampaign = (design_config) => ({
  id: 'c1', slug: 'visual-arts', type: 'lead_generation', status: 'active', is_active: true, design_config,
});

function run(host = 'redeem.sg') {
  // asyncHandler swallows the returned promise — resolve when redirect fires.
  return new Promise((resolve, reject) => {
    const res = { set: jest.fn(), cookie: jest.fn() };
    res.redirect = jest.fn((...args) => resolve(res));
    const req = {
      params: { slug: 'qr1' },
      headers: { host, 'x-forwarded-host': host },
      cookies: {},
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    };
    req.get = (name) => req.headers[String(name).toLowerCase()];
    trackSlug(req, res, (err) => reject(err || new Error('next() called without redirect')));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MARKETPLACE_QR_REDIRECT_ENABLED = 'true';
  trackerService.resolveQrTag.mockResolvedValue({ id: 'qr1', campaignId: 'c1' });
  passesStaticGate.mockReturnValue(true);
});
afterEach(() => { delete process.env.MARKETPLACE_QR_REDIRECT_ENABLED; });

describe('qr_entry branch', () => {
  it("v1 qr_entry 'detail' redirects to the offer page", async () => {
    findByPk.mockResolvedValue(listedCampaign({ qr_entry: 'detail' }));
    const res = await run();
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/offers/visual-arts?'));
  });

  it("v1 qr_entry 'direct' keeps the LeadCapture redirect", async () => {
    findByPk.mockResolvedValue(listedCampaign({ qr_entry: 'direct' }));
    const res = await run();
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/LeadCapture?'));
  });

  it("v2 qrLanding 'offer' lands on the offer page (legacy view maps offer→detail)", async () => {
    findByPk.mockResolvedValue(listedCampaign({
      version: 2,
      form: { gates: {}, fields: [] },
      distribution: { host: 'redeem', marketplace: { listed: true, qrLanding: 'offer' } },
    }));
    const res = await run();
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/offers/visual-arts?'));
  });

  it("v2 qrLanding 'form' keeps the LeadCapture redirect", async () => {
    findByPk.mockResolvedValue(listedCampaign({
      version: 2,
      form: { gates: {}, fields: [] },
      distribution: { host: 'redeem', marketplace: { listed: true, qrLanding: 'form' } },
    }));
    const res = await run();
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/LeadCapture?'));
  });

  it('flag off → always LeadCapture', async () => {
    delete process.env.MARKETPLACE_QR_REDIRECT_ENABLED;
    findByPk.mockResolvedValue(listedCampaign({ qr_entry: 'detail' }));
    const res = await run();
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/LeadCapture?'));
  });
});
