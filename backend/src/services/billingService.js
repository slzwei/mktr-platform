/**
 * Lead-package billing (HitPay one-time checkout). Puts a PAID, idempotent gate in
 * front of LeadPackageAssignment creation — drawdown (chargeLeadCredit) is untouched.
 *
 * Money-path invariants:
 *  1. Fulfillment grants from OUR Payment row's snapshots, never from webhook fields.
 *  2. Idempotent: the webhook locks the Payment row (FOR UPDATE) and only a pending
 *     row is flipped → exactly one assignment; replays return the existing one.
 *  3. Server-side amount/currency guard, snapshot vs webhook compared in integer cents.
 *  4. The caller returns 200 only on a durable outcome; a thrown error → 5xx → HitPay retries.
 *
 * DI-factory (house pattern) so it unit-tests without a DB or network.
 */
import { Op } from 'sequelize';
import { Payment, LeadPackage, LeadPackageAssignment, User, Campaign, sequelize } from '../models/index.js';
import * as hitpay from './hitpayClient.js';
import { buildPurchaseDocument, docTypeForStatus } from './billingDocumentService.js';
import { logger } from '../utils/logger.js';

const VALID_CHECKOUT_MODES = ['in_app', 'web', 'off'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict money string → integer cents. Rejects non-canonical input (exponent, >2 decimals,
 * sign, NaN, missing) by returning NaN so it FAILS the equality guard — never float-rounds a
 * fractional cent into a match (e.g. '199.995' must NOT equal '200.00'). The snapshot we write
 * is always canonical ('200.00'); the webhook must be too.
 */
function toCents(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

/** Internal Payment.status → the app's PurchaseStatus (pending|paid|failed|...). */
function toPurchaseStatus(s) {
  if (s === 'paid') return 'paid';
  if (s === 'pending') return 'pending';
  if (s === 'refunded') return 'refunded';
  return 'failed'; // failed | expired | comp
}

export function makeBillingService(overrides = {}) {
  const d = { Payment, LeadPackage, LeadPackageAssignment, User, Campaign, sequelize, hitpay, buildPurchaseDocument, logger, ...overrides };

  /** Server-controlled in-app-checkout kill switch (App-Store mitigation). */
  function checkoutMode() {
    const m = String(process.env.BILLING_CHECKOUT_MODE || 'in_app').toLowerCase();
    return VALID_CHECKOUT_MODES.includes(m) ? m : 'in_app';
  }

  /**
   * Resolve the buying agent — the SAME proven self-scope guard as the rest of the
   * mktr-leads surface (getExternalAgentPackages / assignPackageExternal): mktrLeadsId
   * + role:'agent' + isActive. To enforce "approved only", add approvalStatus:'approved'
   * once the mktr-leads mirror is confirmed to stamp it (else it blocks the cohort).
   */
  async function resolveAgent(agentMktrUserId) {
    if (!agentMktrUserId || typeof agentMktrUserId !== 'string') return null;
    return d.User.findOne({
      where: { mktrLeadsId: agentMktrUserId, role: 'agent', isActive: true },
      attributes: ['id', 'firstName', 'lastName', 'fullName', 'email'],
    });
  }

  /** Buyable catalog (active + public + priced in SGD) + the checkout kill switch. */
  async function getCatalog() {
    const packages = await d.LeadPackage.findAll({
      where: { status: 'active', isPublic: true },
      include: [{ model: d.Campaign, as: 'campaign', attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
    });
    const buyable = packages
      .filter((p) => Number(p.price) > 0 && (p.currency || 'SGD') === 'SGD')
      .map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type ?? null,
        leadCount: p.leadCount,
        price: Number(p.price),
        currency: p.currency || 'SGD',
        campaignName: p.campaign?.name ?? null,
        // false until the admin-flag column ships (catalog still works — app hides "featured" when none).
        isRecommended: p.isRecommended === true,
      }));
    return { packages: buyable, checkoutMode: checkoutMode() };
  }

  /**
   * Create a pending Payment + a HitPay payment request. The Payment.id is the HitPay
   * reference_number, so the webhook correlates back by PK. Typed outcomes:
   * created | invalid_agent | invalid_beneficiary | package_inactive | package_unpriced
   * | provider_error.
   *
   * beneficiaryMktrUserId (optional): a mktr-leads MANAGER buying FOR a team member —
   * the payer stays agentMktrUserId, the grant goes to the beneficiary. Team membership
   * is validated by the mktr-agent-store broker (the only caller with the Supabase
   * truth); here both parties just have to be live local buyers.
   */
  async function createCheckout({ agentMktrUserId, packageId, beneficiaryMktrUserId }) {
    if (!agentMktrUserId || !packageId) return { status: 'invalid_agent' };
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return { status: 'invalid_agent' };

    // Same-person "beneficiary" collapses to a plain self purchase.
    let beneficiary = null;
    if (beneficiaryMktrUserId && beneficiaryMktrUserId !== agentMktrUserId) {
      beneficiary = await resolveAgent(beneficiaryMktrUserId);
      if (!beneficiary) return { status: 'invalid_beneficiary' };
    }

    const pkg = await d.LeadPackage.findByPk(packageId, {
      include: [{ model: d.Campaign, as: 'campaign', attributes: ['name'] }],
    });
    if (!pkg || pkg.status !== 'active' || !pkg.isPublic) return { status: 'package_inactive' };
    const price = Number(pkg.price);
    if (!(price > 0) || (pkg.currency || 'SGD') !== 'SGD') return { status: 'package_unpriced' };

    // Pending Payment first so its id is the HitPay reference_number + the idempotency anchor.
    // Beneficiary is SNAPSHOTTED here (id + immutable forTeam marker + display name):
    // fulfillment grants from these fields, never from webhook input.
    const payment = await d.Payment.create({
      agentId: agent.id,
      beneficiaryUserId: beneficiary ? beneficiary.id : null,
      forTeam: !!beneficiary,
      beneficiaryName: beneficiary
        ? beneficiary.fullName || `${beneficiary.firstName || ''} ${beneficiary.lastName || ''}`.trim() || null
        : null,
      leadPackageId: pkg.id,
      provider: 'hitpay',
      amount: price,
      currency: 'SGD',
      leadCount: pkg.leadCount,
      packageName: pkg.name,
      campaignName: pkg.campaign?.name ?? null,
      status: 'pending',
      source: 'mktr_leads_app',
    });

    try {
      const { id, url } = await d.hitpay.createPaymentRequest({
        amount: price,
        referenceNumber: payment.id,
        name: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || undefined,
        email: agent.email || undefined,
        redirectUrl: process.env.HITPAY_REDIRECT_URL || undefined,
        webhookUrl: process.env.HITPAY_WEBHOOK_URL || undefined,
        purpose: pkg.name,
      });
      await payment.update({ providerRequestId: id });
      d.logger.info('[billing] checkout.created', { purchaseId: payment.id, agentId: agent.id, beneficiaryId: beneficiary?.id ?? null, packageId: pkg.id, amount: price });
      return { status: 'created', url, purchaseId: payment.id };
    } catch (err) {
      await payment.update({ status: 'failed' }).catch(() => {});
      d.logger.error('[billing] checkout HitPay create failed', { purchaseId: payment.id, error: err?.message || String(err) });
      return { status: 'provider_error' };
    }
  }

  /** Poll one of the agent's OWN purchases (self-scoped). */
  async function getPurchaseStatus({ agentMktrUserId, purchaseId }) {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent || !purchaseId) return { status: 'failed' };
    const payment = await d.Payment.findOne({ where: { id: purchaseId, agentId: agent.id }, attributes: ['status'] });
    if (!payment) return { status: 'failed' };
    return { status: toPurchaseStatus(payment.status) };
  }

  /**
   * The caller's purchase history (newest 50): rows they PAID for plus team
   * purchases that CREDITED them. Each row carries a direction so the app can
   * label it — 'self' | 'for_team' (payer view, + beneficiaryName snapshot) |
   * 'from_manager' (grantee view, + payerName resolved best-effort).
   */
  async function getHistory({ agentMktrUserId }) {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return { purchases: [] };
    const rows = await d.Payment.findAll({
      where: { [Op.or]: [{ agentId: agent.id }, { beneficiaryUserId: agent.id }] },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });

    // Payer names for the rows that credited the caller (manager-funded).
    const payerIds = [
      ...new Set(
        rows
          .filter((p) => p.forTeam && String(p.beneficiaryUserId) === String(agent.id) && p.agentId)
          .map((p) => p.agentId),
      ),
    ];
    const payerNames = new Map();
    if (payerIds.length > 0) {
      const payers = await d.User.findAll({
        where: { id: payerIds },
        attributes: ['id', 'firstName', 'lastName', 'fullName'],
      }).catch(() => []);
      for (const u of payers) {
        payerNames.set(String(u.id), u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || null);
      }
    }

    const purchases = rows.map((p) => {
      const direction = !p.forTeam ? 'self' : String(p.agentId) === String(agent.id) ? 'for_team' : 'from_manager';
      return {
        id: p.id,
        packageName: p.packageName || 'Lead package',
        leadCount: p.leadCount,
        amount: Number(p.amount),
        currency: p.currency || 'SGD',
        status: toPurchaseStatus(p.status),
        createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
        direction,
        beneficiaryName: direction === 'for_team' ? (p.beneficiaryName ?? null) : null,
        payerName: direction === 'from_manager' ? (payerNames.get(String(p.agentId)) ?? null) : null,
      };
    });
    return { purchases };
  }

  /**
   * One purchase from the caller's history as a branded PDF: receipt for
   * paid/refunded, invoice for pending. Scope matches getHistory exactly — the
   * caller must be the PAYER or (for team purchases) the BENEFICIARY, so every
   * documentable history row resolves. Typed outcomes — ok | invalid_agent |
   * not_found | unsupported_status. purchaseId is validated as a UUID up front so
   * a malformed id is a typed miss, not a Sequelize error.
   */
  async function getDocument({ agentMktrUserId, purchaseId }) {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return { status: 'invalid_agent' };
    if (typeof purchaseId !== 'string' || !UUID_RE.test(purchaseId)) return { status: 'not_found' };
    const payment = await d.Payment.findOne({
      where: { id: purchaseId, [Op.or]: [{ agentId: agent.id }, { beneficiaryUserId: agent.id }] },
    });
    if (!payment) return { status: 'not_found' };
    if (!docTypeForStatus(payment.status)) return { status: 'unsupported_status' };
    // BILLED TO is always the PAYER. When the caller is the beneficiary, resolve the
    // payer row best-effort (same as getHistory's payerNames) — a vanished payer
    // degrades to the renderer's generic fallback, never blocks the document.
    let payer = agent;
    if (String(payment.agentId ?? '') !== String(agent.id)) {
      payer = payment.agentId
        ? await d.User.findByPk(payment.agentId, { attributes: ['id', 'firstName', 'lastName', 'fullName', 'email'] }).catch(() => null)
        : null;
    }
    const { docType, filename, buffer } = await d.buildPurchaseDocument({ payment, agent: payer });
    return { status: 'ok', docType, filename, pdfBase64: buffer.toString('base64') };
  }

  /**
   * Fulfill a verified, completed HitPay webhook. One transaction; the Payment row is
   * the idempotency anchor (FOR UPDATE lock + only-pending flip). Grants from snapshots.
   * Returns a typed status so the caller can pick 200 (durable) vs 5xx (retryable).
   */
  async function fulfillFromWebhook(payload) {
    const ref = payload?.reference_number ?? payload?.referenceNumber ?? null;
    const providerRequestId = payload?.payment_request_id ?? payload?.id ?? null;
    const providerPaymentId = payload?.payment_id ?? payload?.id ?? null;
    const rawStatus = String(payload?.status ?? '').toLowerCase();
    const completed = ['completed', 'paid', 'succeeded'].includes(rawStatus);
    const wAmount = payload?.amount;
    const wCurrency = String(payload?.currency ?? 'SGD').toUpperCase();

    if (!ref) {
      d.logger.warn('[billing] webhook missing reference_number');
      return { status: 'ignored' };
    }
    if (!completed) {
      d.logger.info('[billing] webhook non-completed status', { ref, rawStatus });
      return { status: 'ignored' };
    }

    const result = await d.sequelize.transaction(async (t) => {
      const payment = await d.Payment.findOne({ where: { id: ref }, transaction: t, lock: t.LOCK.UPDATE });
      if (!payment) {
        d.logger.warn('[billing] webhook unknown reference', { ref });
        return { status: 'unknown_reference' };
      }
      if (payment.status === 'paid') {
        d.logger.info('[billing] webhook.replay', { ref, assignmentId: payment.leadPackageAssignmentId });
        return { status: 'replay', assignmentId: payment.leadPackageAssignmentId };
      }
      if (payment.status !== 'pending') {
        d.logger.warn('[billing] webhook for non-pending payment', { ref, status: payment.status });
        return { status: 'not_pending' };
      }

      // Anti-tamper: grant ONLY when the webhook matches the snapshot we wrote at checkout.
      // If we stored a providerRequestId, the webhook's MUST exist and match (no fail-open on a
      // missing webhook id). The rare null-stored case (checkout write-back didn't land) is allowed
      // — the signed reference (our UUID) + the amount guard still protect it — but logged.
      let providerOk;
      if (payment.providerRequestId) {
        providerOk = String(payment.providerRequestId) === String(providerRequestId ?? '');
      } else {
        providerOk = true;
        d.logger.warn('[billing] fulfilling a payment with no stored providerRequestId', { ref });
      }
      const snapCents = toCents(payment.amount);
      const amountOk = Number.isFinite(snapCents) && toCents(wAmount) === snapCents;
      const currencyOk = wCurrency === String(payment.currency).toUpperCase();
      if (!providerOk || !amountOk || !currencyOk) {
        await payment.update({ status: 'failed', rawWebhook: payload }, { transaction: t });
        d.logger.error('[billing] amount.mismatch', { ref, providerOk, amountOk, currencyOk, webhookAmount: wAmount, snapshotAmount: payment.amount });
        return { status: 'rejected' };
      }

      // The GRANTEE: the snapshotted beneficiary for a team purchase, else the payer.
      // forTeam is immutable and survives the beneficiary FK SET NULL, so an explicit
      // team purchase NEVER silently falls back to crediting the payer.
      const granteeId = payment.forTeam ? payment.beneficiaryUserId : payment.agentId;

      // Parent (grantee/package) deleted between checkout and settlement → can't build the
      // assignment (NOT NULL FKs) — or a team purchase's beneficiary vanished. Don't 500
      // forever: record the money as PAID (truthful) but UNFULFILLED, for manual review /
      // the reconciliation sweep (paid-without-assignment).
      if (!granteeId || !payment.leadPackageId) {
        await payment.update(
          { status: 'paid', providerPaymentId: providerPaymentId ? String(providerPaymentId) : payment.providerPaymentId, rawWebhook: payload },
          { transaction: t },
        );
        d.logger.error('[billing] fulfillment.unfulfillable — paid but grantee/package missing; manual review', { ref, agentId: payment.agentId, beneficiaryUserId: payment.beneficiaryUserId, forTeam: payment.forTeam === true, leadPackageId: payment.leadPackageId });
        return { status: 'paid_unfulfilled' };
      }

      const assignment = await d.LeadPackageAssignment.create(
        {
          agentId: granteeId,
          leadPackageId: payment.leadPackageId,
          leadsTotal: payment.leadCount,
          leadsRemaining: payment.leadCount,
          priceSnapshot: payment.amount,
          status: 'active',
          purchaseDate: new Date(),
        },
        { transaction: t },
      );

      await payment.update(
        {
          status: 'paid',
          providerPaymentId: providerPaymentId ? String(providerPaymentId) : payment.providerPaymentId,
          leadPackageAssignmentId: assignment.id,
          rawWebhook: payload,
        },
        { transaction: t },
      );

      d.logger.info('[billing] fulfillment.paid', { ref, agentId: payment.agentId, granteeId, forTeam: payment.forTeam === true, assignmentId: assignment.id, leadCount: payment.leadCount });
      return { status: 'fulfilled', assignmentId: assignment.id, leadPackageId: payment.leadPackageId };
    });

    // Post-commit: new funded package → campaign sweep (no-op today; retained as the re-enable hook).
    if (result.status === 'fulfilled' && result.leadPackageId) {
      const pkg = await d.LeadPackage.findByPk(result.leadPackageId, { attributes: ['campaignId'] }).catch(() => null);
      if (pkg?.campaignId) {
        import('./releaseSweep.js')
          .then((m) => m.sweepCampaign(pkg.campaignId))
          .catch((e) => d.logger.error('[billing] releaseSweep trigger failed', { error: e?.message || String(e) }));
      }
    }
    return result;
  }

  return { getCatalog, createCheckout, getPurchaseStatus, getHistory, getDocument, fulfillFromWebhook, checkoutMode };
}

// --- Backward-compatible named exports (house pattern) ---
const _default = makeBillingService();
export const getCatalog = _default.getCatalog;
export const createCheckout = _default.createCheckout;
export const getPurchaseStatus = _default.getPurchaseStatus;
export const getHistory = _default.getHistory;
export const getDocument = _default.getDocument;
export const fulfillFromWebhook = _default.fulfillFromWebhook;
