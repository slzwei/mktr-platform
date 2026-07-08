import { jest } from '@jest/globals';
import { Op } from 'sequelize';
import '../setup.js';
import { makeBillingService } from '../../src/services/billingService.js';

/**
 * Money-path tests for the REAL billingService via the DI factory.
 * The invariants under test:
 *   - fulfillment grants from the Payment SNAPSHOT, never the webhook fields;
 *   - it is idempotent (a paid row replays the existing assignment, no double-grant);
 *   - an amount/provider-id mismatch is REJECTED (no assignment, payment → failed);
 *   - checkout validates eligibility + price/currency before taking money.
 */

function fakePayment(over = {}) {
  const row = {
    id: 'pay-1',
    agentId: 'agent-1',
    leadPackageId: 'pkg-1',
    leadCount: 20,
    amount: '200.00', // DECIMAL → string, as Sequelize returns it
    currency: 'SGD',
    providerRequestId: 'hp-req-1',
    providerPaymentId: null,
    leadPackageAssignmentId: null,
    status: 'pending',
    ...over,
  };
  row.update = jest.fn(async (u) => Object.assign(row, u));
  return row;
}

function build({
  agent = null,
  pkg = null,
  payment = null,
  assignment = { id: 'asg-1' },
  hitpayThrows = false,
  hitpayResult = { id: 'hp-req-1', url: 'https://hit-pay.com/pay/abc' },
  // Beneficiary tests: resolveAgent is called per party — map mktrLeadsId → user row.
  usersByMktrId = null,
  // History payer-name lookups (User.findAll).
  payerRows = [],
} = {}) {
  const createdPayments = [];
  const Payment = {
    create: jest.fn(async (attrs) => {
      const row = { ...attrs, id: attrs.id || 'pay-1', update: jest.fn(async (u) => Object.assign(row, u)) };
      createdPayments.push(row);
      return row;
    }),
    findOne: jest.fn(async () => payment),
    findAll: jest.fn(async () => []),
  };
  const LeadPackage = { findByPk: jest.fn(async () => pkg) };
  const LeadPackageAssignment = { create: jest.fn(async () => assignment) };
  const User = {
    findOne: jest.fn(async (q) => (usersByMktrId ? (usersByMktrId[q?.where?.mktrLeadsId] ?? null) : agent)),
    findAll: jest.fn(async () => payerRows),
  };
  const Campaign = {};
  const sequelize = { transaction: jest.fn(async (cb) => cb({ LOCK: { UPDATE: 'UPDATE' } })) };
  const hitpay = {
    createPaymentRequest: jest.fn(async () => {
      if (hitpayThrows) throw new Error('hitpay down');
      return hitpayResult;
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const svc = makeBillingService({ Payment, LeadPackage, LeadPackageAssignment, User, Campaign, sequelize, hitpay, logger });
  return { svc, Payment, LeadPackage, LeadPackageAssignment, User, hitpay, logger, createdPayments };
}

const activePkg = (over = {}) => ({
  id: 'pkg-1', name: 'SG Motor — Premium', type: 'premium', status: 'active', isPublic: true,
  price: '200.00', currency: 'SGD', leadCount: 20, campaign: { name: 'Q3 Motor Switch' }, ...over,
});
const okAgent = { id: 'agent-1', firstName: 'A', lastName: 'B', fullName: 'A B', email: 'a@b.co' };

describe('billingService.createCheckout', () => {
  test('invalid_agent when no synced active agent', async () => {
    const { svc, hitpay } = build({ agent: null });
    const r = await svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'pkg-1' });
    expect(r).toEqual({ status: 'invalid_agent' });
    expect(hitpay.createPaymentRequest).not.toHaveBeenCalled();
  });

  test('package_inactive when package missing / not active / not public', async () => {
    expect((await build({ agent: okAgent, pkg: null }).svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'x' })).status).toBe('package_inactive');
    expect((await build({ agent: okAgent, pkg: activePkg({ status: 'draft' }) }).svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'x' })).status).toBe('package_inactive');
    expect((await build({ agent: okAgent, pkg: activePkg({ isPublic: false }) }).svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'x' })).status).toBe('package_inactive');
  });

  test('package_unpriced when price ≤ 0 or non-SGD', async () => {
    expect((await build({ agent: okAgent, pkg: activePkg({ price: '0' }) }).svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'x' })).status).toBe('package_unpriced');
    expect((await build({ agent: okAgent, pkg: activePkg({ currency: 'USD' }) }).svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'x' })).status).toBe('package_unpriced');
  });

  test('created — Payment pending written, HitPay called with referenceNumber=payment.id', async () => {
    const { svc, Payment, hitpay, createdPayments } = build({ agent: okAgent, pkg: activePkg() });
    const r = await svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'pkg-1' });
    expect(r.status).toBe('created');
    expect(r.url).toBe('https://hit-pay.com/pay/abc');
    expect(r.purchaseId).toBe(createdPayments[0].id);
    // snapshot written
    expect(Payment.create).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1', leadPackageId: 'pkg-1', amount: 200, currency: 'SGD', leadCount: 20,
      packageName: 'SG Motor — Premium', campaignName: 'Q3 Motor Switch', status: 'pending', source: 'mktr_leads_app',
    }));
    // HitPay reference = our payment id; providerRequestId stamped back
    expect(hitpay.createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ amount: 200, referenceNumber: createdPayments[0].id }));
    expect(createdPayments[0].update).toHaveBeenCalledWith({ providerRequestId: 'hp-req-1' });
  });

  test('provider_error marks the pending Payment failed (no dangling pending)', async () => {
    const { svc, createdPayments } = build({ agent: okAgent, pkg: activePkg(), hitpayThrows: true });
    const r = await svc.createCheckout({ agentMktrUserId: 'm1', packageId: 'pkg-1' });
    expect(r.status).toBe('provider_error');
    expect(createdPayments[0].update).toHaveBeenCalledWith({ status: 'failed' });
  });
});

describe('billingService.fulfillFromWebhook', () => {
  const completed = (over = {}) => ({ reference_number: 'pay-1', payment_request_id: 'hp-req-1', payment_id: 'hp-pay-1', status: 'completed', amount: '200.00', currency: 'SGD', ...over });

  test('ignored when missing reference or not completed', async () => {
    const { svc } = build();
    expect((await svc.fulfillFromWebhook({ status: 'completed' })).status).toBe('ignored');
    expect((await svc.fulfillFromWebhook(completed({ status: 'pending' }))).status).toBe('ignored');
  });

  test('unknown_reference when no payment row', async () => {
    const { svc } = build({ payment: null });
    expect((await svc.fulfillFromWebhook(completed())).status).toBe('unknown_reference');
  });

  test('fulfilled — creates ONE assignment from the snapshot, links + marks paid', async () => {
    const payment = fakePayment();
    const { svc, LeadPackageAssignment, LeadPackage } = build({ payment, assignment: { id: 'asg-9' } });
    LeadPackage.findByPk.mockResolvedValue({ campaignId: null }); // post-commit sweep lookup → skip
    const r = await svc.fulfillFromWebhook(completed());
    expect(r).toMatchObject({ status: 'fulfilled', assignmentId: 'asg-9' });
    // assignment built from the PAYMENT snapshot (leadCount/amount), not the webhook
    expect(LeadPackageAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', leadPackageId: 'pkg-1', leadsTotal: 20, leadsRemaining: 20, priceSnapshot: '200.00', status: 'active' }),
      expect.anything(),
    );
    expect(payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paid', providerPaymentId: 'hp-pay-1', leadPackageAssignmentId: 'asg-9' }),
      expect.anything(),
    );
  });

  test('idempotent replay — an already-paid payment grants NOTHING new', async () => {
    const payment = fakePayment({ status: 'paid', leadPackageAssignmentId: 'asg-existing' });
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(completed());
    expect(r).toEqual({ status: 'replay', assignmentId: 'asg-existing' });
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
  });

  test('amount tamper — webhook amount ≠ snapshot → REJECTED, no assignment, payment failed', async () => {
    const payment = fakePayment();
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(completed({ amount: '1.00' }));
    expect(r.status).toBe('rejected');
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
    expect(payment.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), expect.anything());
  });

  test('provider-id tamper — webhook payment_request_id ≠ snapshot → REJECTED', async () => {
    const payment = fakePayment();
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(completed({ payment_request_id: 'someone-elses' }));
    expect(r.status).toBe('rejected');
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
  });

  test('not_pending — a failed payment is never resurrected', async () => {
    const payment = fakePayment({ status: 'failed' });
    const { svc, LeadPackageAssignment } = build({ payment });
    expect((await svc.fulfillFromWebhook(completed())).status).toBe('not_pending');
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
  });

  test('strict amount — non-canonical (199.995 / 200.001 / 2e2 / "" / -200) is REJECTED', async () => {
    for (const bad of ['199.995', '200.001', '2e2', '', '-200.00']) {
      const payment = fakePayment();
      const { svc, LeadPackageAssignment } = build({ payment });
      const r = await svc.fulfillFromWebhook(completed({ amount: bad }));
      expect(r.status).toBe('rejected');
      expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
    }
  });

  test('strict amount — "200" is the same money as the "200.00" snapshot → fulfils', async () => {
    const payment = fakePayment();
    const { svc, LeadPackage } = build({ payment, assignment: { id: 'asg-200' } });
    LeadPackage.findByPk.mockResolvedValue({ campaignId: null }); // skip post-commit sweep
    expect((await svc.fulfillFromWebhook(completed({ amount: '200' }))).status).toBe('fulfilled');
  });

  test('provider guard — payment HAS providerRequestId but webhook omits it → REJECTED (no fail-open)', async () => {
    const payment = fakePayment(); // providerRequestId: 'hp-req-1'
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(completed({ payment_request_id: undefined, payment_id: undefined }));
    expect(r.status).toBe('rejected');
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
  });

  test('paid_unfulfilled — agent/package deleted mid-flight → PAID (truthful) but no assignment, durable', async () => {
    const payment = fakePayment({ agentId: null }); // FK SET NULL on parent delete
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(completed());
    expect(r.status).toBe('paid_unfulfilled');
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
    expect(payment.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }), expect.anything());
  });
});

describe('billingService status/history/catalog', () => {
  test('getPurchaseStatus maps internal status + self-scopes by agent', async () => {
    const payment = { status: 'paid' };
    const { svc, Payment } = build({ agent: okAgent, payment });
    const r = await svc.getPurchaseStatus({ agentMktrUserId: 'm1', purchaseId: 'pay-1' });
    expect(r).toEqual({ status: 'paid' });
    expect(Payment.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pay-1', agentId: 'agent-1' }, attributes: ['status'] }));
  });

  test('getPurchaseStatus → failed for unknown agent', async () => {
    const { svc } = build({ agent: null });
    expect((await svc.getPurchaseStatus({ agentMktrUserId: 'm1', purchaseId: 'pay-1' })).status).toBe('failed');
  });

  test('catalog filters to active/public/priced-SGD and exposes checkoutMode', async () => {
    const { svc, LeadPackage } = build();
    LeadPackage.findAll = jest.fn(async () => [
      { id: 'p1', name: 'A', type: 'premium', leadCount: 20, price: '200.00', currency: 'SGD', isPublic: true, campaign: { name: 'C' } },
      { id: 'p2', name: 'B', type: 'basic', leadCount: 10, price: '0', currency: 'SGD', isPublic: true, campaign: null }, // unpriced → dropped
      { id: 'p3', name: 'C', type: 'basic', leadCount: 5, price: '90', currency: 'USD', isPublic: true, campaign: null }, // non-SGD → dropped
    ]);
    const svc2 = makeBillingService({
      LeadPackage, Campaign: {}, Payment: {}, LeadPackageAssignment: {}, User: {},
      sequelize: {}, hitpay: {}, logger: { info() {}, warn() {}, error() {} },
    });
    const r = await svc2.getCatalog();
    expect(r.packages.map((p) => p.id)).toEqual(['p1']);
    expect(r.packages[0]).toMatchObject({ name: 'A', leadCount: 20, price: 200, currency: 'SGD', campaignName: 'C', isRecommended: false });
    expect(['in_app', 'web', 'off']).toContain(r.checkoutMode);
  });
});

describe('billingService catalog — campaign grouping (migration 044)', () => {
  const catalogSvc = (rows) => {
    const LeadPackage = { findAll: jest.fn(async () => rows) };
    const svc = makeBillingService({
      LeadPackage, Campaign: {}, Payment: {}, LeadPackageAssignment: {}, User: {},
      sequelize: {}, hitpay: {}, logger: { info() {}, warn() {}, error() {} },
    });
    return { svc, LeadPackage };
  };

  // Raw rows as Sequelize returns them: DECIMAL → string, campaign via the include.
  const careShield = {
    id: 'c-care', name: 'CPF CareShield Life — Free Luggage', description: 'Warm CareShield reviews.',
    giftName: '20″ cabin luggage', giftPriceFromMktr: '25.00', giftNote: null,
    agentNotes: ['Mention the luggage.', '  Collect from Ubi.  ', '', 7, null],
  };
  const alwaysOn = {
    id: 'c-life', name: 'Always-On Life', description: '   ',
    giftName: null, giftPriceFromMktr: null, giftNote: null, agentNotes: null,
  };
  const rows = [
    { id: 'p1', name: 'CareShield — Premium', type: 'premium', leadCount: 20, price: '200.00', currency: 'SGD', isRecommended: true, campaignId: 'c-care', campaign: careShield },
    { id: 'p2', name: 'Travel — Custom', type: 'custom', leadCount: 15, price: '165.00', currency: 'SGD', campaignId: null, campaign: null },
    { id: 'p3', name: 'Life — Starter', type: 'basic', leadCount: 10, price: '90.00', currency: 'SGD', campaignId: 'c-life', campaign: alwaysOn },
    { id: 'p4', name: 'CareShield — Starter', type: 'basic', leadCount: 10, price: '90.00', currency: 'SGD', campaignId: 'c-care', campaign: careShield },
    // Non-buyable rows must vanish from ALL three views (and can empty a campaign out entirely).
    { id: 'p5', name: 'CareShield — Draft', type: 'basic', leadCount: 5, price: '0', currency: 'SGD', campaignId: 'c-care', campaign: careShield },
    { id: 'p6', name: 'US only', type: 'basic', leadCount: 5, price: '50.00', currency: 'USD', campaignId: 'c-usd', campaign: { id: 'c-usd', name: 'USD Campaign' } },
  ];

  test('groups buyables by campaign (first-occurrence order) + splits generalPackages + keeps the legacy flat list verbatim', async () => {
    const { svc } = catalogSvc(rows);
    const r = await svc.getCatalog();

    // Legacy flat list: every buyable, original (newest-first) order, unchanged shape.
    expect(r.packages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(r.packages[0]).toMatchObject({ campaignName: 'CPF CareShield Life — Free Luggage', isRecommended: true });

    // Campaign-grouped view.
    expect(r.campaigns.map((c) => c.id)).toEqual(['c-care', 'c-life']); // c-usd never appears — no buyable package
    expect(r.campaigns[0].packages.map((p) => p.id)).toEqual(['p1', 'p4']);
    expect(r.campaigns[1].packages.map((p) => p.id)).toEqual(['p3']);
    expect(r.generalPackages.map((p) => p.id)).toEqual(['p2']);
  });

  test('gift + notes + description mapping: priced gift, sanitized notes, blank description → null', async () => {
    const { svc } = catalogSvc(rows);
    const r = await svc.getCatalog();

    expect(r.campaigns[0].description).toBe('Warm CareShield reviews.');
    expect(r.campaigns[0].gift).toEqual({ name: '20″ cabin luggage', priceFromMktr: 25, note: null });
    expect(r.campaigns[0].notes).toEqual(['Mention the luggage.', 'Collect from Ubi.']);

    // Description-only campaign: blank description → null, no gift, notes [].
    expect(r.campaigns[1]).toMatchObject({ description: null, gift: null, notes: [] });
  });

  test('gift degradations: 0/absent price → priceFromMktr null; blank name → gift null; note trimmed', async () => {
    const voucher = {
      id: 'c-motor', name: 'Q3 Motor Switch', description: 'Motor renewals.',
      giftName: 'S$10 NTUC FairPrice voucher', giftPriceFromMktr: '0', giftNote: '  Codes are emailed after purchase.  ',
      agentNotes: ['Confirm the outlet preference.'],
    };
    const blankGift = { id: 'c-blank', name: 'Blank Gift', description: null, giftName: '   ', giftPriceFromMktr: '25.00', giftNote: 'x', agentNotes: [] };
    const { svc } = catalogSvc([
      { id: 'q1', name: 'Motor — Premium', type: 'premium', leadCount: 20, price: '200.00', currency: 'SGD', campaignId: 'c-motor', campaign: voucher },
      { id: 'q2', name: 'Blank — Basic', type: 'basic', leadCount: 5, price: '45.00', currency: 'SGD', campaignId: 'c-blank', campaign: blankGift },
    ]);
    const r = await svc.getCatalog();
    expect(r.campaigns[0].gift).toEqual({ name: 'S$10 NTUC FairPrice voucher', priceFromMktr: null, note: 'Codes are emailed after purchase.' });
    expect(r.campaigns[1].gift).toBeNull(); // blank name kills the gift regardless of other fields
  });

  test('the buyability filter stays in the DB where + query shape carries the 044 campaign attributes', async () => {
    const { svc, LeadPackage } = catalogSvc([]);
    await svc.getCatalog();
    expect(LeadPackage.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'active', isPublic: true },
      order: [['createdAt', 'DESC']],
      include: [expect.objectContaining({
        as: 'campaign',
        attributes: ['id', 'name', 'description', 'giftName', 'giftPriceFromMktr', 'giftNote', 'agentNotes'],
      })],
    }));
  });
});

describe('billingService — beneficiary purchases (manager buy-for-team, migration 043)', () => {
  const okManager = { id: 'mgr-1', firstName: 'M', lastName: 'G', fullName: 'M G', email: 'm@g.co' };
  const okMember = { id: 'ben-1', firstName: 'B', lastName: 'N', fullName: 'Ben N', email: 'b@n.co' };

  it('snapshots beneficiary + forTeam + name at checkout', async () => {
    const { svc, createdPayments } = build({
      pkg: activePkg(),
      usersByMktrId: { 'mu-mgr': okManager, 'mu-ben': okMember },
    });
    const r = await svc.createCheckout({
      agentMktrUserId: 'mu-mgr',
      packageId: 'pkg-1',
      beneficiaryMktrUserId: 'mu-ben',
    });
    expect(r.status).toBe('created');
    expect(createdPayments[0]).toMatchObject({
      agentId: 'mgr-1',
      beneficiaryUserId: 'ben-1',
      forTeam: true,
      beneficiaryName: 'Ben N',
    });
  });

  it('rejects an unknown beneficiary (typed, before any Payment row exists)', async () => {
    const { svc, Payment } = build({ pkg: activePkg(), usersByMktrId: { 'mu-mgr': okManager } });
    const r = await svc.createCheckout({
      agentMktrUserId: 'mu-mgr',
      packageId: 'pkg-1',
      beneficiaryMktrUserId: 'mu-ghost',
    });
    expect(r.status).toBe('invalid_beneficiary');
    expect(Payment.create).not.toHaveBeenCalled();
  });

  it('a same-person beneficiary collapses to a plain self purchase', async () => {
    const { svc, createdPayments } = build({ pkg: activePkg(), usersByMktrId: { 'mu-mgr': okManager } });
    const r = await svc.createCheckout({
      agentMktrUserId: 'mu-mgr',
      packageId: 'pkg-1',
      beneficiaryMktrUserId: 'mu-mgr',
    });
    expect(r.status).toBe('created');
    expect(createdPayments[0]).toMatchObject({ forTeam: false, beneficiaryUserId: null, beneficiaryName: null });
  });

  it('fulfillment grants the assignment to the BENEFICIARY, never the payer', async () => {
    const payment = fakePayment({ agentId: 'mgr-1', beneficiaryUserId: 'ben-1', forTeam: true });
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook({
      reference_number: 'pay-1',
      payment_request_id: 'hp-req-1',
      status: 'completed',
      amount: '200.00',
      currency: 'SGD',
    });
    expect(r.status).toBe('fulfilled');
    expect(LeadPackageAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'ben-1' }),
      expect.anything(),
    );
  });

  it('a team purchase whose beneficiary vanished lands paid_unfulfilled — NO payer fallback', async () => {
    // forTeam survives the FK SET NULL: the marker is what blocks the silent payer credit.
    const payment = fakePayment({ agentId: 'mgr-1', beneficiaryUserId: null, forTeam: true });
    const { svc, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook({
      reference_number: 'pay-1',
      payment_request_id: 'hp-req-1',
      status: 'completed',
      amount: '200.00',
      currency: 'SGD',
    });
    expect(r.status).toBe('paid_unfulfilled');
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
    expect(payment.status).toBe('paid'); // the money is recorded truthfully
  });

  it('history carries directions: self / for_team (+beneficiaryName) / from_manager (+payerName)', async () => {
    const rows = [
      { id: 'p1', agentId: 'mgr-1', forTeam: false, beneficiaryUserId: null, beneficiaryName: null, packageName: 'A', leadCount: 10, amount: '90.00', currency: 'SGD', status: 'paid', createdAt: new Date('2026-07-01') },
      { id: 'p2', agentId: 'mgr-1', forTeam: true, beneficiaryUserId: 'ben-1', beneficiaryName: 'Ben N', packageName: 'B', leadCount: 20, amount: '200.00', currency: 'SGD', status: 'paid', createdAt: new Date('2026-07-02') },
      { id: 'p3', agentId: 'boss-9', forTeam: true, beneficiaryUserId: 'mgr-1', beneficiaryName: 'M G', packageName: 'C', leadCount: 5, amount: '50.00', currency: 'SGD', status: 'paid', createdAt: new Date('2026-07-03') },
    ];
    const { svc, Payment } = build({
      usersByMktrId: { 'mu-mgr': okManager },
      payerRows: [{ id: 'boss-9', fullName: 'Big Boss', firstName: 'Big', lastName: 'Boss' }],
    });
    Payment.findAll.mockResolvedValue(rows);
    const r = await svc.getHistory({ agentMktrUserId: 'mu-mgr' });
    const byId = Object.fromEntries(r.purchases.map((p) => [p.id, p]));
    expect(byId.p1).toMatchObject({ direction: 'self', beneficiaryName: null, payerName: null });
    expect(byId.p2).toMatchObject({ direction: 'for_team', beneficiaryName: 'Ben N' });
    expect(byId.p3).toMatchObject({ direction: 'from_manager', payerName: 'Big Boss' });
  });
});

describe('billingService.getDocument', () => {
  const UUID = '3f2a9c1b-7d4e-4a2b-9c1d-8e5f6a7b8c9d';
  const docBuilder = () =>
    jest.fn(async ({ payment }) => ({
      docType: payment.status === 'pending' ? 'invoice' : 'receipt',
      filename: 'MKTR-Receipt-3F2A9C1B.pdf',
      buffer: Buffer.from('%PDF-fake'),
    }));

  test('invalid_agent when no synced active agent', async () => {
    const { svc } = build({ agent: null });
    expect((await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID })).status).toBe('invalid_agent');
  });

  test('not_found for a malformed purchaseId — never reaches the DB', async () => {
    const { svc, Payment } = build({ agent: okAgent });
    for (const bad of ['pay-1', '', "x' OR 1=1", null, undefined, 123]) {
      expect((await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: bad })).status).toBe('not_found');
    }
    expect(Payment.findOne).not.toHaveBeenCalled();
  });

  test('history-scoped lookup: WHERE id + (payer OR beneficiary); miss → not_found', async () => {
    const { svc, Payment } = build({ agent: okAgent, payment: null });
    const r = await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID });
    expect(r.status).toBe('not_found');
    const where = Payment.findOne.mock.calls[0][0].where;
    expect(where.id).toBe(UUID);
    expect(where[Op.or]).toEqual([{ agentId: 'agent-1' }, { beneficiaryUserId: 'agent-1' }]);
  });

  test('beneficiary caller gets the document, BILLED TO the resolved PAYER', async () => {
    // Caller agent-1 is the BENEFICIARY of a manager-funded purchase (paid by mgr-9).
    const payment = fakePayment({ status: 'paid', agentId: 'mgr-9', beneficiaryUserId: 'agent-1', forTeam: true, beneficiaryName: 'A B' });
    const payer = { id: 'mgr-9', firstName: 'M', lastName: 'G', fullName: 'M G', email: 'm@g.co' };
    const buildDoc = docBuilder();
    const base = build({ agent: okAgent, payment });
    const User = { ...base.User, findByPk: jest.fn(async () => payer) };
    const svc = makeBillingService({
      Payment: base.Payment, LeadPackage: {}, LeadPackageAssignment: {}, User, Campaign: {},
      sequelize: {}, hitpay: {}, buildPurchaseDocument: buildDoc, logger: { info() {}, warn() {}, error() {} },
    });
    const r = await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID });
    expect(r.status).toBe('ok');
    expect(User.findByPk).toHaveBeenCalledWith('mgr-9', expect.anything());
    expect(buildDoc).toHaveBeenCalledWith({ payment, agent: payer });
  });

  test('beneficiary document survives a vanished payer (renderer fallback, never blocked)', async () => {
    const payment = fakePayment({ status: 'paid', agentId: null, beneficiaryUserId: 'agent-1', forTeam: true });
    const buildDoc = docBuilder();
    const base = build({ agent: okAgent, payment });
    const User = { ...base.User, findByPk: jest.fn() };
    const svc = makeBillingService({
      Payment: base.Payment, LeadPackage: {}, LeadPackageAssignment: {}, User, Campaign: {},
      sequelize: {}, hitpay: {}, buildPurchaseDocument: buildDoc, logger: { info() {}, warn() {}, error() {} },
    });
    const r = await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID });
    expect(r.status).toBe('ok');
    expect(User.findByPk).not.toHaveBeenCalled(); // agentId is null — nothing to resolve
    expect(buildDoc).toHaveBeenCalledWith({ payment, agent: null });
  });

  test('unsupported_status for failed/expired/comp — no PDF built', async () => {
    for (const status of ['failed', 'expired', 'comp']) {
      const buildDoc = docBuilder();
      const base = build({ agent: okAgent, payment: fakePayment({ status }) });
      const svc = makeBillingService({
        Payment: base.Payment, LeadPackage: {}, LeadPackageAssignment: {}, User: base.User, Campaign: {},
        sequelize: {}, hitpay: {}, buildPurchaseDocument: buildDoc, logger: { info() {}, warn() {}, error() {} },
      });
      expect((await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID })).status).toBe('unsupported_status');
      expect(buildDoc).not.toHaveBeenCalled();
    }
  });

  test('ok — paid → receipt rendered to base64; builder gets the payment + live agent', async () => {
    const payment = fakePayment({ status: 'paid' });
    const buildDoc = docBuilder();
    const base = build({ agent: okAgent, payment });
    const svc = makeBillingService({
      Payment: base.Payment, LeadPackage: {}, LeadPackageAssignment: {}, User: base.User, Campaign: {},
      sequelize: {}, hitpay: {}, buildPurchaseDocument: buildDoc, logger: { info() {}, warn() {}, error() {} },
    });
    const r = await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID });
    expect(r).toEqual({
      status: 'ok',
      docType: 'receipt',
      filename: 'MKTR-Receipt-3F2A9C1B.pdf',
      pdfBase64: Buffer.from('%PDF-fake').toString('base64'),
    });
    expect(buildDoc).toHaveBeenCalledWith({ payment, agent: okAgent });
  });

  test('ok — pending → invoice docType', async () => {
    const base = build({ agent: okAgent, payment: fakePayment({ status: 'pending' }) });
    const svc = makeBillingService({
      Payment: base.Payment, LeadPackage: {}, LeadPackageAssignment: {}, User: base.User, Campaign: {},
      sequelize: {}, hitpay: {}, buildPurchaseDocument: docBuilder(), logger: { info() {}, warn() {}, error() {} },
    });
    expect((await svc.getDocument({ agentMktrUserId: 'm1', purchaseId: UUID })).docType).toBe('invoice');
  });
});
