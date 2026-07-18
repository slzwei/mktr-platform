import { Op } from 'sequelize';
import {
  RewardEntitlement, RedemptionEvent, Activation, ActivationIssuanceSkip, RewardOffer,
  PartnerOrganisation, Prospect, User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeInventoryService } from './inventoryService.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { mintToken, hashToken, tokenHintOf } from './tokens.js';
import { canEmailProspect, makeFulfilmentNotify } from './fulfilmentNotify.js';
import { canWhatsAppProspect, waEnabled, waRecipient } from './whatsappService.js';

const DEFAULT_RESERVATION_DAYS = 30;
const DEFAULT_REDEMPTION_DAYS = 90;
const RESEND_COOLDOWN_MS = 60 * 1000;
// Statuses that hold the per-phone slot (matches uq_re_activation_phone's
// partial WHERE) — expired/cancelled rows free it.
const LIVE_PHONE_STATUSES = ['eligible', 'issued', 'redeemed'];

/**
 * Anti-farming dedupe key: digits-only phone (`+65 9123 4567` → `6591234567`).
 * Null for missing/garbage values so junk can never occupy a slot.
 */
export function phoneKeyOf(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

// In-flight fire-and-forget deliveries (all service instances share this).
// flushDeliveries() lets tests — and anything else that needs a barrier —
// await every queued email + receipt write deterministically.
const pendingDeliveries = new Set();
export async function flushDeliveries() {
  while (pendingDeliveries.size > 0) {
    await Promise.allSettled([...pendingDeliveries]);
  }
}

/**
 * Reward entitlements (docs/redeem-ops/MKTR_INTEGRATION.md §2, ERD.md §3.16).
 *
 * Issuance is at-least-once (capture hook + reconciliation sweep) made
 * exactly-once by the partial unique (activationId, prospectId) anchor.
 * Preconditions (anti-farming): server-stamped phone verification on the
 * prospect, not quarantined, activation ACTIVE with allocation remaining.
 *
 * unlockPolicy='agent_unlock' (default): capture creates a locked RESERVATION
 * (presentation-pass token only); the lead's assigned consultant unlocks at the
 * physical meeting (scan or button) which mints the voucher token.
 *
 * DELIVERY lives in this service (single choke point — hook-, sweep-, and
 * manual-issued entitlements all deliver): fresh issuance and unlock queue the
 * reservation/voucher email post-commit via the null-safe notify deps, and
 * every attempt writes a `notified`/`notify_failed` receipt event. Wire the
 * deps with makeWiredEntitlementService (entitlementWiring.js) — a bare
 * instance sends nothing by design (tests, flag-off).
 */
export function makeEntitlementService(overrides = {}) {
  const d = {
    RewardEntitlement, RedemptionEvent, Activation, ActivationIssuanceSkip, RewardOffer,
    PartnerOrganisation, Prospect, User, sequelize, logger,
    inventory: makeInventoryService(),
    audit: makeRedeemOpsAuditService(),
    notifyUnlock: null, // injected by entitlementWiring (voucher email) — null-safe
    notifyReservation: null, // injected by entitlementWiring (reservation-pass email) — null-safe
    notifyUnlockWa: null, // injected by entitlementWiring (voucher WhatsApp, PR E) — null-safe
    notifyReservationWa: null, // injected by entitlementWiring (reservation-pass WhatsApp, PR E) — null-safe
    builders: null, // share/claim-URL builders; defaults lazily to makeFulfilmentNotify()
    ...overrides,
  };
  const builders = () => {
    if (!d.builders) d.builders = makeFulfilmentNotify();
    return d.builders;
  };

  async function writeEvent(t, evt) {
    return d.RedemptionEvent.create(
      {
        entitlementId: evt.entitlementId,
        redemptionId: evt.redemptionId || null,
        type: evt.type,
        metadata: evt.metadata || null,
        actorType: evt.actorType || 'system',
        actorUserId: evt.actorUserId || null,
      },
      { transaction: t }
    );
  }

  function verificationStampOf(prospect) {
    return prospect?.sourceMetadata?.phoneVerifiedAt || null;
  }

  /**
   * Persist + log one skipped issuance (migration 076). Awaited by callers —
   * it's the FAILURE path (one ~1ms INSERT, never the capture hot path) and
   * awaiting makes the skip ledger deterministic; errors are swallowed so a
   * broken skip log can never fail issuance handling itself.
   * `no_active_activation` rows carry only the campaignId (there IS no
   * activation) — that's the detached-funnel signature the console surfaces.
   */
  async function recordSkip({ prospect, activation = null, reason, via }) {
    const campaignId = activation?.campaignId || prospect?.campaignId || null;
    const actId = activation?.id || null;
    d.logger.info('redeem_ops.issuance.skipped', { reason, via, campaignId, activationId: actId });
    try {
      await d.ActivationIssuanceSkip.create({ campaignId, activationId: actId, reason, via });
    } catch (err) {
      d.logger.warn('redeem_ops.issuance.skip_record_failed', { reason, error: err?.message });
    }
  }

  /** Retention for the skip log — called from the fulfilment sweep. */
  async function purgeIssuanceSkips({ days = 30 } = {}) {
    const removed = await d.ActivationIssuanceSkip.destroy({
      where: { createdAt: { [Op.lt]: new Date(Date.now() - days * 24 * 3600 * 1000) } },
    });
    if (removed > 0) d.logger.info('redeem_ops.issuance.skips_purged', { removed });
    return removed;
  }

  /**
   * Post-commit, fire-and-forget delivery + truthful per-channel receipts.
   * Email and WhatsApp (PR E) are INDEPENDENT legs — one failing/skipping can
   * never block or fail the other, and each writes its own receipt tagged with
   * its channel. The boolean return keeps PR A's contract: "a fresh EMAIL
   * attempt was scheduled" (the `emailQueued` the routes surface) — WhatsApp
   * never affects it. The WhatsApp sender self-guards flag/consent/phone via
   * `skipped` results (no receipt on a skip: nothing was attempted), so a
   * no-email Retell lead still gets its WhatsApp leg — the email guard below
   * deliberately gates only the email leg.
   */
  function queueDelivery({ entitlement, prospect, kind, presentationToken = null, voucherToken = null }) {
    const args = kind === 'voucher'
      ? { entitlement, prospect, voucherToken }
      : { entitlement, prospect, presentationToken };
    const fire = (fn, channel) => {
      const delivery = Promise.resolve()
        .then(() => fn(args))
        .then((r) => {
          if (r?.skipped) return null;
          return writeDeliveryReceipt(entitlement.id, kind, r || { sent: false, error: 'no sender result' }, channel);
        })
        .catch((err) => writeDeliveryReceipt(entitlement.id, kind, { sent: false, error: err?.message }, channel));
      pendingDeliveries.add(delivery);
      delivery.finally(() => pendingDeliveries.delete(delivery));
    };

    const waFn = kind === 'voucher' ? d.notifyUnlockWa : d.notifyReservationWa;
    if (typeof waFn === 'function') fire(waFn, 'whatsapp');

    const fn = kind === 'voucher' ? d.notifyUnlock : d.notifyReservation;
    if (typeof fn !== 'function' || !canEmailProspect(prospect)) return false;
    fire(fn, 'email');
    return true;
  }

  async function writeDeliveryReceipt(entitlementId, kind, r, channel = 'email') {
    try {
      await d.RedemptionEvent.create({
        entitlementId,
        type: r.sent ? 'notified' : 'notify_failed',
        actorType: 'system',
        metadata: {
          kind,
          channel,
          to: r.to || null, // already masked by the sender
          ...(r.error ? { error: String(r.error).slice(0, 200) } : {}),
        },
      });
    } catch (err) {
      d.logger.error('redeem_ops.delivery.receipt_failed', { entitlementId, channel, error: err?.message });
    }
  }

  /**
   * Issue (reserve) for a captured lead. Returns the entitlement or null with a
   * reason — NEVER throws into the capture path (the hook wraps it anyway).
   * `activationId` (manual path) pins the EXACT activation staff selected —
   * without it, issueManual could issue/email a different activation than the
   * audit row claims (Codex blocker, 2026-07-16).
   */
  async function issueForProspect(prospect, { via = 'hook', activationId = null } = {}) {
    // Function-scoped so the unique-constraint catch can attribute skips.
    let resolvedActivation = null;
    // Skip recording (migration 076): every funnel-relevant refusal writes one
    // fire-and-forget row + a structured log line — that's what the activation
    // detail's 24h breakdown reads. 'duplicate' (idempotent replays) and
    // 'no_campaign' (non-funnel lead) are deliberate noise exclusions.
    const fail = async (reason, activation = resolvedActivation) => {
      await recordSkip({ prospect, activation, reason, via });
      return { entitlement: null, reason };
    };
    try {
      if (!activationId && !prospect?.campaignId) return { entitlement: null, reason: 'no_campaign' };
      if (prospect?.quarantinedAt) return fail('quarantined');
      if (!verificationStampOf(prospect)) return fail('phone_not_verified');

      let activation;
      if (activationId) {
        activation = await d.Activation.findOne({
          where: { id: activationId, status: 'active' },
          include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
        });
        if (!activation) return fail('activation_not_active');
      } else {
        activation = await d.Activation.findOne({
          where: { campaignId: prospect.campaignId, status: 'active' },
          include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
        });
        if (!activation) return fail('no_active_activation');
      }
      resolvedActivation = activation;

      const existing = await d.RewardEntitlement.findOne({
        where: { activationId: activation.id, prospectId: prospect.id },
      });
      if (existing) return { entitlement: existing, reason: 'duplicate' };

      // Anti-farming (migration 075): one LIVE reward per phone per activation.
      // Hook/sweep issuance REQUIRES a phone key — a null key would bypass the
      // dedupe entirely (OTP-verified leads always have one; this guards the
      // theoretical hole). Manual issue without a phone stays allowed (audited
      // escape hatch; NULL keys never collide). The pre-check is UX — the
      // partial unique index is the authoritative guard (see the catch below).
      const phoneKey = phoneKeyOf(prospect.phone);
      if (!phoneKey && via !== 'manual') return fail('no_phone');
      if (phoneKey) {
        const livePhone = await d.RewardEntitlement.findOne({
          where: { activationId: activation.id, phoneKey, status: { [Op.in]: LIVE_PHONE_STATUSES } },
          order: [['createdAt', 'DESC']],
        });
        if (livePhone) {
          await recordSkip({ prospect, activation, reason: 'duplicate_phone', via });
          return { entitlement: livePhone, reason: 'duplicate_phone' };
        }
      }

      const offer = activation.rewardOffer;
      // Liveness gates (PR C): a paused/ended offer or an activation past its
      // endDate must not issue. Pre-checks give the typed reason; the
      // transaction predicates below stay authoritative under races.
      if (!offer || offer.status !== 'active') return fail('offer_not_active');
      if (activation.endDate && new Date(activation.endDate) <= new Date()) return fail('activation_ended');

      const onCapture = activation.unlockPolicy === 'on_capture';
      const reservationDays = offer.claimExpiryDays || DEFAULT_RESERVATION_DAYS;
      const redemptionDays = offer.redemptionExpiryDays || DEFAULT_REDEMPTION_DAYS;

      const presentation = mintToken();
      const voucher = onCapture ? mintToken() : null;

      const entitlement = await d.sequelize.transaction(async (t) => {
        // Activation-level guard: issuedCount < allocatedQuantity + still
        // active + not past endDate — one conditional statement, race-proof.
        // A 0-row result surfaces as the generic 'allocation_exhausted' soft
        // reason: the pre-checks above already classified the common cases;
        // this only catches ms-window races.
        const [rows] = await d.sequelize.query(
          `UPDATE activations
              SET "issuedCount" = "issuedCount" + 1, "updatedAt" = NOW()
            WHERE id = :id AND "issuedCount" < "allocatedQuantity" AND status = 'active'
              AND ("endDate" IS NULL OR "endDate" > NOW())
            RETURNING id`,
          { replacements: { id: activation.id }, transaction: t }
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          throw Object.assign(new Error('allocation_exhausted'), { _soft: true });
        }
        // Offer-level counter + ledger
        await d.inventory.recordIssued({
          offerId: offer.id, activationId: activation.id, transaction: t,
        });

        const created = await d.RewardEntitlement.create(
          {
            rewardOfferId: offer.id,
            activationId: activation.id,
            prospectId: prospect.id,
            status: onCapture ? 'issued' : 'eligible',
            unlockedAt: onCapture ? new Date() : null,
            unlockedVia: onCapture ? 'auto_on_capture' : null,
            expiresAt: new Date(Date.now() + (onCapture ? redemptionDays : reservationDays) * 24 * 3600 * 1000),
            presentationTokenHash: presentation.hash,
            tokenHash: voucher ? voucher.hash : null,
            tokenHint: voucher ? tokenHintOf(voucher.raw) : null,
            issuedVia: via,
            phoneKey,
          },
          { transaction: t }
        );
        await writeEvent(t, { entitlementId: created.id, type: 'reserved', metadata: { via, unlockPolicy: activation.unlockPolicy } });
        if (onCapture) {
          await writeEvent(t, { entitlementId: created.id, type: 'unlocked', metadata: { via: 'auto_on_capture' } });
        }
        return created;
      });

      // Post-commit delivery: reservation pass (agent_unlock) or voucher
      // (on_capture) — fire-and-forget, receipt-tracked. This is the single
      // delivery choke point for hook, sweep AND manual issuance.
      const emailQueued = queueDelivery({
        entitlement,
        prospect,
        kind: onCapture ? 'voucher' : 'pass',
        presentationToken: onCapture ? null : presentation.raw,
        voucherToken: voucher ? voucher.raw : null,
      });

      // Raw tokens returned ONCE for delivery (email/link); only hashes persist.
      return {
        entitlement,
        reason: null,
        presentationToken: presentation.raw,
        voucherToken: voucher ? voucher.raw : null,
        emailQueued,
      };
    } catch (err) {
      if (err?._soft) return fail(err.message);
      if (err?.name === 'SequelizeUniqueConstraintError') {
        // Two partial uniques can fire: the (activationId, prospectId)
        // idempotency anchor → 'duplicate', or the (activationId, phoneKey)
        // anti-farming guard → 'duplicate_phone' (a concurrent same-phone
        // signup lost the race). The transaction rolled back, so counters are
        // intact either way.
        const constraint = err?.parent?.constraint || err?.original?.constraint || '';
        if (constraint === 'uq_re_activation_phone') {
          const winner = await d.RewardEntitlement.findOne({
            where: { phoneKey: phoneKeyOf(prospect.phone), status: { [Op.in]: LIVE_PHONE_STATUSES } },
            order: [['createdAt', 'DESC']],
          });
          return { entitlement: winner, reason: 'duplicate_phone' };
        }
        const existing = await d.RewardEntitlement.findOne({
          where: { prospectId: prospect.id },
          order: [['createdAt', 'DESC']],
        });
        return { entitlement: existing, reason: 'duplicate' };
      }
      throw err;
    }
  }

  /**
   * Consultant unlock at the physical meeting (MKTR_INTEGRATION.md §2).
   * `by` = { presentationToken } (scan — proves presence) or { prospectId } (button).
   * The acting agent must be the lead's assigned consultant (admin override allowed).
   * Idempotent: an already-unlocked entitlement returns { already: true }.
   * `emailQueued` means a FRESH voucher email was scheduled by THIS call —
   * always false on replay (no duplicate mail) and when no usable email exists.
   */
  async function unlockEntitlement(by, agentUser, via = 'agent_scan') {
    let entitlement;
    if (by.presentationToken) {
      entitlement = await d.RewardEntitlement.findOne({
        where: { presentationTokenHash: hashToken(by.presentationToken) },
      });
    } else if (by.prospectId) {
      entitlement = await d.RewardEntitlement.findOne({
        where: { prospectId: by.prospectId, status: { [Op.in]: ['eligible', 'issued'] } },
        order: [['createdAt', 'DESC']],
      });
    }
    if (!entitlement) throw new AppError('Entitlement not found', 404);

    if (['issued', 'redeemed'].includes(entitlement.status)) {
      // Deliberate carve-out: replay stays idempotent even if the activation
      // has since paused — THAT unlock already happened.
      return { entitlement, already: true, voucherToken: null, emailQueued: false };
    }
    if (entitlement.status !== 'eligible') {
      throw new AppError(`Entitlement is ${entitlement.status}`, 409);
    }

    // Liveness gate (PR C — the funnel doc promised this; now it's true):
    // pause is a full brake, completed/cancelled are terminal. Typed 409s
    // here are UX; the transaction predicate below is authoritative.
    const activation = await d.Activation.findByPk(entitlement.activationId, { attributes: ['id', 'status'] });
    if (!activation || activation.status !== 'active') {
      const st = activation?.status || 'missing';
      throw new AppError(
        st === 'paused'
          ? 'Activation is paused — unlocks are temporarily disabled'
          : `Activation is ${st} — this reward can no longer be unlocked`,
        409
      );
    }

    // Assigned-consultant binding (admin override audited via unlockedVia='manual')
    const prospect = entitlement.prospectId ? await d.Prospect.findByPk(entitlement.prospectId) : null;
    const isAdmin = agentUser.role === 'admin';
    if (!isAdmin) {
      if (!prospect || prospect.assignedAgentId !== agentUser.id) {
        throw new AppError('Only the assigned consultant can unlock this reward', 403);
      }
    }

    const offer = await d.RewardOffer.findByPk(entitlement.rewardOfferId);
    const redemptionDays = offer?.redemptionExpiryDays || DEFAULT_REDEMPTION_DAYS;
    const voucher = mintToken();

    await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(
        {
          status: 'issued',
          unlockedAt: new Date(),
          unlockedByUserId: agentUser.id,
          unlockedVia: isAdmin && !prospect ? 'manual' : via,
          tokenHash: voucher.hash,
          tokenHint: tokenHintOf(voucher.raw),
          expiresAt: new Date(Date.now() + redemptionDays * 24 * 3600 * 1000),
        },
        {
          where: {
            id: entitlement.id,
            status: 'eligible', // conditional transition — replay-safe
            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
            // Activation must STILL be active at commit time — a pause racing
            // this unlock loses here, not just at the pre-check (TOCTOU).
            activationId: {
              [Op.in]: d.sequelize.literal(
                `(SELECT id FROM activations WHERE id = '${entitlement.activationId}' AND status = 'active')`
              ),
            },
          },
          transaction: t,
        }
      );
      if (count === 0) {
        throw new AppError('Reservation expired, already unlocked, or its activation is no longer active', 409);
      }
      await writeEvent(t, {
        entitlementId: entitlement.id, type: 'unlocked',
        actorType: 'agent', actorUserId: agentUser.id, metadata: { via },
      });
    });

    await entitlement.reload();
    // Fire-and-forget voucher email (receipt-tracked)
    const emailQueued = queueDelivery({
      entitlement, prospect, kind: 'voucher', voucherToken: voucher.raw,
    });
    return { entitlement, already: false, voucherToken: voucher.raw, emailQueued };
  }

  /** Manual issue by redemption_ops (requires an existing lead). */
  async function issueManual({ activationId, prospectId }, user, requestId = null) {
    const activation = await d.Activation.findByPk(activationId, {
      include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
    });
    if (!activation) throw new AppError('Activation not found', 404);
    const prospect = await d.Prospect.findByPk(prospectId);
    if (!prospect) throw new AppError('Lead not found', 404);

    // activationId is threaded through so the SELECTED activation is the one
    // issued + emailed + audited (issueForProspect would otherwise re-resolve
    // by the prospect's campaign and could pick a different activation).
    const result = await issueForProspect(
      { ...prospect.toJSON(), sourceMetadata: { ...(prospect.sourceMetadata || {}), phoneVerifiedAt: prospect.sourceMetadata?.phoneVerifiedAt || new Date().toISOString() } },
      { via: 'manual', activationId }
    );
    if (!result.entitlement) throw new AppError(`Cannot issue: ${result.reason}`, 409);
    if (result.reason === 'duplicate_phone') {
      // The returned entitlement belongs to ANOTHER prospect with the same
      // phone — never report that as a successful manual issue.
      throw new AppError('Cannot issue: duplicate_phone — this phone already holds a live reward for this activation', 409);
    }
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'entitlement.issued_manual', entityType: 'reward_entitlement',
      entityId: result.entitlement.id, after: { activationId, prospectId }, requestId,
    });
    return result;
  }

  /**
   * Ops resend / share (docs/plans/trial-reward-funnel-hardening-prompt.md PR A).
   * Re-mints the CURRENT credential (pass while eligible, voucher once issued)
   * as an ATOMIC conditional transition — racing unlock/redeem/expiry loses
   * cleanly with a typed 409 instead of rotating hashes for the wrong state.
   * channel 'email' re-sends via the notify seam; channel 'whatsapp' (PR E)
   * validates WhatsApp deliverability then re-sends via the same seam; channel
   * 'link' returns the branded /r/ url + WhatsApp-paste bundle ONCE (the
   * no-email path). Because the token ROTATES, email+whatsapp resends fan out
   * to every wired channel (the un-picked channel's old link would otherwise
   * die silently) — the picked channel is what was VALIDATED and is recorded
   * in the manual_override metadata. The OLD credential of that kind stops
   * working — deliberate.
   */
  async function resendDelivery(id, user, { channel = 'email' } = {}, requestId = null) {
    const entitlement = await d.RewardEntitlement.findByPk(id);
    if (!entitlement) throw new AppError('Entitlement not found', 404);

    const kind = entitlement.status === 'eligible' ? 'pass'
      : entitlement.status === 'issued' ? 'voucher' : null;
    if (!kind) throw new AppError(`Entitlement is ${entitlement.status}`, 409);
    if (entitlement.expiresAt && new Date(entitlement.expiresAt) <= new Date()) {
      throw new AppError('Reward has expired — nothing to resend', 409);
    }

    const prospect = entitlement.prospectId ? await d.Prospect.findByPk(entitlement.prospectId) : null;
    if (channel === 'email' && !canEmailProspect(prospect)) {
      throw new AppError('No usable email on file — use the copy-link option instead', 409);
    }
    if (channel === 'whatsapp' && !(waEnabled() && canWhatsAppProspect(prospect))) {
      throw new AppError('WhatsApp delivery is not available for this customer — use email or the copy-link option', 409);
    }

    // Per-entitlement cooldown: any delivery/rotation for this kind in the
    // last 60s → 429 (the global per-IP limiter is no protection here).
    const recent = await d.RedemptionEvent.findAll({
      where: {
        entitlementId: id,
        createdAt: { [Op.gt]: new Date(Date.now() - RESEND_COOLDOWN_MS) },
        type: { [Op.in]: ['notified', 'notify_failed', 'manual_override'] },
      },
      order: [['createdAt', 'DESC']],
      limit: 10,
    });
    const resendAction = kind === 'pass' ? 'resend_pass' : 'resend_voucher';
    const clash = recent.some((e) => {
      const m = e.metadata || {};
      if (e.type === 'manual_override') return m.action === resendAction || (m.action === 'auto_resend' && m.kind === kind);
      return m.kind === kind;
    });
    if (clash) {
      throw new AppError('A delivery for this reward was attempted less than a minute ago — wait and retry', 429);
    }

    const fresh = mintToken();
    const fields = kind === 'pass'
      ? { presentationTokenHash: fresh.hash }
      : { tokenHash: fresh.hash, tokenHint: tokenHintOf(fresh.raw) };
    await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(fields, {
        where: {
          id,
          status: entitlement.status, // conditional — unlock/redeem/cancel races lose here
          [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: d.sequelize.literal('NOW()') } }],
        },
        transaction: t,
      });
      if (count === 0) {
        throw new AppError('Reward state changed (unlocked, redeemed or expired) — refresh and retry', 409);
      }
      await writeEvent(t, {
        entitlementId: id, type: 'manual_override', actorType: 'staff', actorUserId: user.id,
        metadata: { action: resendAction, channel },
      });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'entitlement.resend_delivery', entityType: 'reward_entitlement',
        entityId: id, after: { kind, channel }, requestId, transaction: t,
      });
    });
    await entitlement.reload();

    if (channel === 'link') {
      const bundle = await builders().buildShareBundle({ entitlement, prospect, kind, rawToken: fresh.raw });
      return { entitlement, kind, channel, emailQueued: false, ...bundle };
    }
    const emailQueued = queueDelivery({
      entitlement, prospect, kind,
      presentationToken: kind === 'pass' ? fresh.raw : null,
      voucherToken: kind === 'voucher' ? fresh.raw : null,
    });
    return { entitlement, kind, channel, emailQueued };
  }

  async function cancelEntitlement(id, user, reason, requestId = null) {
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required', 400);
    const entitlement = await d.RewardEntitlement.findByPk(id);
    if (!entitlement) throw new AppError('Entitlement not found', 404);
    if (!['eligible', 'issued'].includes(entitlement.status)) {
      throw new AppError(`Entitlement is ${entitlement.status}`, 409);
    }
    await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(
        { status: 'cancelled' },
        { where: { id, status: { [Op.in]: ['eligible', 'issued'] } }, transaction: t }
      );
      if (count === 0) throw new AppError('Entitlement changed state — retry', 409);
      await d.inventory.reverseIssued({
        offerId: entitlement.rewardOfferId, activationId: entitlement.activationId,
        entitlementId: id, type: 'cancelled', actorType: 'staff', reason, transaction: t,
      });
      await d.sequelize.query(
        `UPDATE activations SET "issuedCount" = "issuedCount" - 1, "updatedAt" = NOW()
          WHERE id = :id AND "issuedCount" > 0`,
        { replacements: { id: entitlement.activationId }, transaction: t }
      );
      await writeEvent(t, {
        entitlementId: id, type: 'manual_override', actorType: 'staff', actorUserId: user.id,
        metadata: { action: 'cancelled', reason },
      });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'entitlement.cancelled', entityType: 'reward_entitlement',
        entityId: id, reason, requestId, transaction: t,
      });
    });
    await entitlement.reload();
    return entitlement;
  }

  /** Reservation-expiry sweep — expired reservations return inventory to the pool. */
  async function expireReservations() {
    const stale = await d.RewardEntitlement.findAll({
      where: { status: 'eligible', expiresAt: { [Op.lt]: new Date() } },
      limit: 200,
    });
    let expired = 0;
    for (const ent of stale) {
      try {
        await d.sequelize.transaction(async (t) => {
          const [count] = await d.RewardEntitlement.update(
            { status: 'expired' },
            { where: { id: ent.id, status: 'eligible' }, transaction: t }
          );
          if (count === 0) return;
          await d.inventory.reverseIssued({
            offerId: ent.rewardOfferId, activationId: ent.activationId,
            entitlementId: ent.id, type: 'expired', transaction: t,
          });
          await d.sequelize.query(
            `UPDATE activations SET "issuedCount" = "issuedCount" - 1, "updatedAt" = NOW()
              WHERE id = :id AND "issuedCount" > 0`,
            { replacements: { id: ent.activationId }, transaction: t }
          );
          await writeEvent(t, { entitlementId: ent.id, type: 'expired' });
          expired += 1;
        });
      } catch (err) {
        d.logger.warn('redeem_ops.entitlement.expire_failed', { id: ent.id, error: err?.message });
      }
    }
    if (expired > 0) d.logger.info('redeem_ops.entitlements.expired', { expired });
    return expired;
  }

  /**
   * Reconciliation sweep (at-least-once backstop for the capture hook): recent
   * verified, unquarantined leads on ACTIVE activation campaigns lacking an
   * entitlement get one. The unique anchor dedupes against hook races.
   * On a WIRED instance, issueForProspect delivers the pass itself — sweep-
   * issued entitlements are no longer silently undeliverable (defect 2).
   */
  async function reconcileMissedLeads({ sinceHours = 48 } = {}) {
    const activations = await d.Activation.findAll({
      where: { status: 'active', campaignId: { [Op.ne]: null } },
      attributes: ['id', 'campaignId'],
    });
    let issued = 0;
    for (const activation of activations) {
      const prospects = await d.Prospect.findAll({
        where: {
          campaignId: activation.campaignId,
          quarantinedAt: null,
          createdAt: { [Op.gt]: new Date(Date.now() - sinceHours * 3600 * 1000) },
          id: {
            [Op.notIn]: d.sequelize.literal(
              `(SELECT "prospectId" FROM reward_entitlements WHERE "activationId" = '${activation.id}' AND "prospectId" IS NOT NULL)`
            ),
          },
        },
        limit: 100,
      });
      for (const prospect of prospects) {
        const r = await issueForProspect(prospect, { via: 'sweep' }).catch(() => null);
        if (r?.entitlement && r.reason === null) issued += 1;
      }
    }
    if (issued > 0) d.logger.info('redeem_ops.entitlements.reconciled', { issued });
    return issued;
  }

  /**
   * Delivery-recovery sweep (Codex blocker, 2026-07-16): an entitlement whose
   * email never got a `notified` receipt (crash between commit and send, SMTP
   * failure) is otherwise stranded FOREVER — the raw token is gone and
   * reconcileMissedLeads skips existing rows. Re-mint atomically and retry, up
   * to `maxAttempts` per kind; rows younger than `minAgeMinutes` are skipped so
   * an in-flight fire-and-forget send isn't pointlessly rotated. Requires the
   * notify deps to be wired — a bare instance returns 0 (never rotate a
   * credential we cannot deliver).
   */
  async function reconcileMissedDeliveries({ maxAttempts = 3, minAgeMinutes = 10 } = {}) {
    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);
    const candidates = await d.RewardEntitlement.findAll({
      where: {
        status: { [Op.in]: ['eligible', 'issued'] },
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
      },
      include: [{ model: d.Prospect, as: 'prospect' }],
      order: [['createdAt', 'ASC']],
      limit: 200,
    });
    let recovered = 0;
    for (const ent of candidates) {
      try {
        const kind = ent.status === 'eligible' ? 'pass' : 'voucher';
        const fn = kind === 'voucher' ? d.notifyUnlock : d.notifyReservation;
        if (typeof fn !== 'function') continue; // unwired — never rotate undeliverably
        if (!canEmailProspect(ent.prospect)) continue; // link-channel-only customer
        const stateSince = kind === 'voucher' ? (ent.unlockedAt || ent.createdAt) : ent.createdAt;
        if (new Date(stateSince) > cutoff) continue; // give the in-flight send its window

        const receipts = await d.RedemptionEvent.findAll({
          where: { entitlementId: ent.id, type: { [Op.in]: ['notified', 'notify_failed'] } },
          order: [['createdAt', 'DESC']],
          limit: 20,
        });
        const forKind = receipts.filter((e) => e.metadata?.kind === kind && (e.metadata?.channel || 'email') === 'email');
        if (forKind.some((e) => e.type === 'notified')) continue; // delivered
        if (forKind.length >= maxAttempts) continue; // gave up — visible on the console

        const fresh = mintToken();
        const fields = kind === 'pass'
          ? { presentationTokenHash: fresh.hash }
          : { tokenHash: fresh.hash, tokenHint: tokenHintOf(fresh.raw) };
        let rotated = false;
        await d.sequelize.transaction(async (t) => {
          const [count] = await d.RewardEntitlement.update(fields, {
            where: {
              id: ent.id,
              status: ent.status,
              [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: d.sequelize.literal('NOW()') } }],
            },
            transaction: t,
          });
          if (count === 0) return;
          rotated = true;
          await writeEvent(t, {
            entitlementId: ent.id, type: 'manual_override', actorType: 'system',
            metadata: { action: 'auto_resend', kind, channel: 'email' },
          });
        });
        if (!rotated) continue;
        await ent.reload();
        queueDelivery({
          entitlement: ent, prospect: ent.prospect, kind,
          presentationToken: kind === 'pass' ? fresh.raw : null,
          voucherToken: kind === 'voucher' ? fresh.raw : null,
        });
        recovered += 1;
      } catch (err) {
        d.logger.warn('redeem_ops.delivery.recover_failed', { id: ent.id, error: err?.message });
      }
    }
    if (recovered > 0) d.logger.info('redeem_ops.deliveries.recovered', { recovered });
    return recovered;
  }

  /** Ops listing (staff view — lead PII via JOIN at read time, never copied). */
  async function listEntitlements(query = {}) {
    const where = {};
    if (query.activationId) where.activationId = String(query.activationId);
    if (query.status) where.status = String(query.status);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
    // Console search: holder name or phone (the verify console legitimately
    // handles identity, so the search itself may use the raw phone).
    const prospectWhere = {};
    if (query.search) {
      const term = String(query.search).trim();
      const like = `%${term}%`;
      prospectWhere[Op.or] = [
        { firstName: { [Op.iLike]: like } },
        { lastName: { [Op.iLike]: like } },
        { phone: { [Op.like]: like.replace(/\s+/g, '') } },
      ];
    }
    const { rows, count } = await d.RewardEntitlement.findAndCountAll({
      where,
      include: [
        {
          model: d.Prospect,
          as: 'prospect',
          // email is selected ONLY to compute emailDeliverable — it is
          // stripped below and never serialized to the console.
          attributes: ['id', 'firstName', 'lastName', 'phone', 'email'],
          ...(query.search ? { where: prospectWhere, required: true } : {}),
        },
        { model: d.RewardOffer, as: 'rewardOffer', attributes: ['id', 'title'] },
        {
          model: d.Activation,
          as: 'activation',
          attributes: ['id', 'campaignNameSnapshot'],
          // Partner name captions each campaign stack on the console.
          include: [{ model: d.PartnerOrganisation, as: 'partner', attributes: ['id', 'tradingName', 'legalName'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit, offset: (page - 1) * limit,
    });

    // Latest delivery receipt per (entitlement, channel) — one batched query.
    const ids = rows.map((r) => r.id);
    const receiptRows = ids.length
      ? await d.RedemptionEvent.findAll({
          where: {
            entitlementId: { [Op.in]: ids },
            type: { [Op.in]: ['notified', 'notify_failed'] },
          },
          order: [['createdAt', 'DESC']],
        })
      : [];
    const latestReceipt = new Map();
    for (const e of receiptRows) {
      const key = `${e.entitlementId}:${e.metadata?.channel || 'email'}`;
      if (!latestReceipt.has(key)) latestReceipt.set(key, e); // DESC → first is latest
    }

    // Mask phones by default (redemptions.verify unmasks at the console)
    const masked = rows.map((r) => {
      const j = r.toJSON();
      j.emailDeliverable = canEmailProspect(j.prospect);
      // Capability only (the list projection carries no sourceMetadata, so the
      // D2 consent arm can't be evaluated here) — send-time canWhatsAppProspect
      // stays authoritative. Flag off ⇒ false everywhere, so the console never
      // offers a channel that can't fire.
      j.whatsappDeliverable = waEnabled() && Boolean(waRecipient(j.prospect?.phone));
      const em = latestReceipt.get(`${j.id}:email`);
      const wa = latestReceipt.get(`${j.id}:whatsapp`);
      j.delivery = {
        email: em ? { kind: em.metadata?.kind || null, at: em.createdAt, ok: em.type === 'notified' } : null,
        whatsapp: wa ? { kind: wa.metadata?.kind || null, at: wa.createdAt, ok: wa.type === 'notified' } : null,
      };
      if (j.prospect) {
        if (j.prospect.phone) j.prospect.phone = `••••${String(j.prospect.phone).slice(-4)}`;
        delete j.prospect.email;
      }
      return j;
    });
    return { entitlements: masked, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
  }

  return {
    issueForProspect, unlockEntitlement, issueManual, cancelEntitlement, resendDelivery,
    expireReservations, reconcileMissedLeads, reconcileMissedDeliveries, purgeIssuanceSkips,
    listEntitlements, verificationStampOf,
    queueDelivery, // exported for tests: the per-channel fan-out contract (PR E)
  };
}

const _default = makeEntitlementService();
export default _default;
