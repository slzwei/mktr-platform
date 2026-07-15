import { jest } from '@jest/globals';
import '../setup.js';
import { makeBillingService } from '../../src/services/billingService.js';

/**
 * Wallet TOP-UP branch of the billing money-path (kind:'wallet_topup').
 * Invariants:
 *  - checkout only accepts the preset whitelist and writes a package-less
 *    Payment snapshot (leadPackageId null, leadCount 0);
 *  - settlement credits the wallet INSIDE the locked transaction and can never
 *    fall into paid_unfulfilled while an agent exists;
 *  - replays (status already 'paid') never double-credit;
 *  - an amount mismatch is rejected BEFORE any wallet credit;
 *  - package purchases (no kind / kind:'package_purchase') never touch the wallet.
 */

function fakePayment(over = {}) {
  const row = {
    id: 'pay-1',
    agentId: 'agent-1',
    leadPackageId: null,
    kind: 'wallet_topup',
    leadCount: 0,
    amount: '100.00',
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

function build({ agent = null, payment = null, hitpayThrows = false } = {}) {
  const createdPayments = [];
  const Payment = {
    create: jest.fn(async (attrs) => {
      const row = { ...attrs, id: 'pay-1', update: jest.fn(async (u) => Object.assign(row, u)) };
      createdPayments.push(row);
      return row;
    }),
    findOne: jest.fn(async () => payment),
    findAll: jest.fn(async () => []),
  };
  const LeadPackage = { findByPk: jest.fn(async () => null) };
  const LeadPackageAssignment = { create: jest.fn(async () => ({ id: 'asg-1' })) };
  const User = { findOne: jest.fn(async () => agent), findAll: jest.fn(async () => []) };
  const sequelize = { transaction: jest.fn(async (cb) => cb({ LOCK: { UPDATE: 'UPDATE' } })) };
  const hitpay = {
    createPaymentRequest: jest.fn(async () => {
      if (hitpayThrows) throw new Error('hitpay down');
      return { id: 'hp-req-1', url: 'https://hit-pay.com/pay/topup' };
    }),
  };
  const walletCredit = jest.fn(async () => ({ id: 'led-1', balanceAfterCents: 10000 }));
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const svc = makeBillingService({ Payment, LeadPackage, LeadPackageAssignment, User, Campaign: {}, sequelize, hitpay, walletCredit, logger });
  return { svc, Payment, LeadPackageAssignment, walletCredit, createdPayments };
}

const okAgent = { id: 'agent-1', firstName: 'A', lastName: 'B', fullName: 'A B', email: 'a@b.co' };
const topupWebhook = (over = {}) => ({
  reference_number: 'pay-1', payment_request_id: 'hp-req-1', payment_id: 'hp-pay-9',
  status: 'completed', amount: '100.00', currency: 'SGD', ...over,
});

describe('billingService.createWalletTopupCheckout', () => {
  test('invalid_agent when no synced active agent', async () => {
    const { svc } = build({ agent: null });
    expect((await svc.createWalletTopupCheckout({ agentMktrUserId: 'm1', amountCents: 10000 })).status).toBe('invalid_agent');
  });

  test('invalid_amount outside the preset whitelist (with presets echoed)', async () => {
    const { svc, Payment } = build({ agent: okAgent });
    for (const amountCents of [9999, 0, -100, 12345, '10000', null, undefined]) {
      const r = await svc.createWalletTopupCheckout({ agentMktrUserId: 'm1', amountCents });
      expect(r.status).toBe('invalid_amount');
      expect(r.presets).toEqual([10000, 50000, 200000]);
    }
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('created — package-less Payment snapshot with kind wallet_topup', async () => {
    const { svc, Payment, createdPayments } = build({ agent: okAgent });
    const r = await svc.createWalletTopupCheckout({ agentMktrUserId: 'm1', amountCents: 50000 });
    expect(r.status).toBe('created');
    expect(Payment.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'wallet_topup', leadPackageId: null, leadCount: 0, amount: '500.00',
      packageName: 'Wallet top-up', status: 'pending', forTeam: false,
    }));
    expect(createdPayments[0].update).toHaveBeenCalledWith({ providerRequestId: 'hp-req-1' });
  });

  test('provider_error marks the pending Payment failed', async () => {
    const { svc, createdPayments } = build({ agent: okAgent, hitpayThrows: true });
    const r = await svc.createWalletTopupCheckout({ agentMktrUserId: 'm1', amountCents: 10000 });
    expect(r.status).toBe('provider_error');
    expect(createdPayments[0].update).toHaveBeenCalledWith({ status: 'failed' });
  });
});

describe('billingService.fulfillFromWebhook — wallet_topup branch', () => {
  test('credits the wallet inside the locked tx and flips the Payment to paid', async () => {
    const payment = fakePayment();
    const { svc, walletCredit, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(topupWebhook());
    expect(r).toEqual({ status: 'fulfilled', walletTopup: true });
    expect(walletCredit).toHaveBeenCalledWith('agent-1', 10000, expect.objectContaining({
      type: 'topup', paymentId: 'pay-1', transaction: expect.anything(),
    }));
    expect(payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paid', providerPaymentId: 'hp-pay-9' }),
      expect.anything()
    );
    // never grants a package assignment
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
  });

  test('replay (already paid) never double-credits', async () => {
    const payment = fakePayment({ status: 'paid' });
    const { svc, walletCredit } = build({ payment });
    const r = await svc.fulfillFromWebhook(topupWebhook());
    expect(r.status).toBe('replay');
    expect(walletCredit).not.toHaveBeenCalled();
  });

  test('amount mismatch is rejected BEFORE any credit (payment → failed)', async () => {
    const payment = fakePayment();
    const { svc, walletCredit } = build({ payment });
    const r = await svc.fulfillFromWebhook(topupWebhook({ amount: '999.00' }));
    expect(r.status).toBe('rejected');
    expect(walletCredit).not.toHaveBeenCalled();
    expect(payment.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), expect.anything());
  });

  test('vanished agent → paid_unfulfilled (money recorded, no credit)', async () => {
    const payment = fakePayment({ agentId: null });
    const { svc, walletCredit } = build({ payment });
    const r = await svc.fulfillFromWebhook(topupWebhook());
    expect(r.status).toBe('paid_unfulfilled');
    expect(walletCredit).not.toHaveBeenCalled();
    expect(payment.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }), expect.anything());
  });

  test('package purchases never touch the wallet (kind default path intact)', async () => {
    const payment = fakePayment({ kind: 'package_purchase', leadPackageId: 'pkg-1', leadCount: 20, amount: '200.00' });
    const { svc, walletCredit, LeadPackageAssignment } = build({ payment });
    const r = await svc.fulfillFromWebhook(topupWebhook({ amount: '200.00' }));
    expect(r.status).toBe('fulfilled');
    expect(walletCredit).not.toHaveBeenCalled();
    expect(LeadPackageAssignment.create).toHaveBeenCalled();
  });
});
