import { jest } from '@jest/globals';
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
  const User = { findOne: jest.fn(async () => agent) };
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
