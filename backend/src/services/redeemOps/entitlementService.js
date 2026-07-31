import { Op } from 'sequelize';
import {
  RewardEntitlement, RedemptionEvent, Redemption, Activation, ActivationIssuanceSkip, RewardOffer,
  PartnerOrganisation, Prospect, User, Consumer, Campaign, WaMessageStatus, sequelize,
} from '../../models/index.js';
import { phoneVerificationIsCurrent } from '../consumerService.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeInventoryService } from './inventoryService.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { mintToken, hashToken, tokenHintOf } from './tokens.js';
import { canEmailProspect, makeFulfilmentNotify } from './fulfilmentNotify.js';
import { canWhatsAppProspect, waEnabled, waRecipient } from './whatsappService.js';
import { isSendBlocked } from '../consentService.js';
import { SCREENING_REASONS } from '../screeningConstants.js';
import { makeDrawLink } from './drawLink.js';

const DEFAULT_RESERVATION_DAYS = 30;
const DEFAULT_REDEMPTION_DAYS = 90;
const RESEND_COOLDOWN_MS = 60 * 1000;
// Statuses that hold the per-phone slot (matches uq_re_activation_phone's
// partial WHERE) — expired/cancelled rows free it. Exported for the Lead
// Profile diagnostic, which mirrors issueForProspect's duplicate-phone check.
export const LIVE_PHONE_STATUSES = ['eligible', 'issued', 'redeemed'];

/**
 * kind → the notify deps that send it. EXHAUSTIVE on purpose: the old
 * inline ternaries ended in `: d.notifyReservation`, so any kind the engine
 * did not recognise was silently delivered as a reservation pass. An unknown
 * kind now sends NOTHING and logs — a wrong email to a real customer is worse
 * than a missing one, and the reconciler/Resend exist to recover a gap.
 */
const KIND_SENDERS = {
  pass: { email: 'notifyReservation', wa: 'notifyReservationWa' },
  voucher: { email: 'notifyUnlock', wa: 'notifyUnlockWa' },
  boost_receipt: { email: 'notifyBoostReceipt', wa: 'notifyBoostReceiptWa' },
  handover_receipt: { email: 'notifyHandover', wa: 'notifyHandoverWa' },
};

/** A reward the consultant buys and hands over themselves — no token, no partner leg. */
export const PHYSICAL_FULFILMENT = 'physical_voucher';

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
    RewardEntitlement, RedemptionEvent, Redemption, Activation, ActivationIssuanceSkip, RewardOffer,
    PartnerOrganisation, Prospect, User, Consumer, Campaign, WaMessageStatus, sequelize, logger,
    inventory: makeInventoryService(),
    audit: makeRedeemOpsAuditService(),
    notifyUnlock: null, // injected by entitlementWiring (voucher email) — null-safe
    notifyReservation: null, // injected by entitlementWiring (reservation-pass email) — null-safe
    notifyUnlockWa: null, // injected by entitlementWiring (voucher WhatsApp, PR E) — null-safe
    notifyReservationWa: null, // injected by entitlementWiring (reservation-pass WhatsApp, PR E) — null-safe
    notifyBoostReceipt: null, // injected by entitlementWiring (PR-4 "×N confirmed" email) — null-safe
    notifyBoostReceiptWa: null, // injected by entitlementWiring ("×N confirmed" WhatsApp) — null-safe
    // Physical-voucher handover receipt — the consultant already put the paper
    // voucher in the lead's hand, so this confirms that happened. It carries NO
    // token and NO claim link (there is nothing to present). Null-safe.
    notifyHandover: null,
    notifyHandoverWa: null,
    // Down-funnel CAPI for a physical handover (wired by entitlementWiring).
    // Null-safe: a bare service dispatches nothing, and the redemption sweep
    // still picks the row up.
    onRedemption: null,
    drawLink: null, // PR-4: built AFTER the merge from the service's OWN models (DI-hermetic)
    builders: null, // share/claim-URL builders; defaults lazily to makeFulfilmentNotify()
    isSendBlocked, // PR C: erasure stop at the send choke point (transactional purpose)
    ...overrides,
  };
  // Draw-rail detection built from the service's OWN (possibly DI'd) models —
  // a suite that mocks Activation/Campaign gets a hermetic drawLink for free;
  // an explicit drawLink override still wins.
  if (!d.drawLink) d.drawLink = makeDrawLink({ Activation: d.Activation, Campaign: d.Campaign });
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
    // Bound stamp (plan §2.3, Codex R1 #6): phoneVerifiedFor ties the OTP
    // evidence to the number it was earned for — a staff phone edit must not
    // inherit verified status. Legacy stamps without the binding stay valid.
    return phoneVerificationIsCurrent(prospect) ? prospect.sourceMetadata.phoneVerifiedAt : null;
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
   *
   * `channels` selects which legs to fire; it defaults to BOTH so capture,
   * unlock and the sweep are unchanged. The ops Resend passes a specific set
   * (email / whatsapp / both) so staff can re-send on exactly the channel(s)
   * they chose — one token rotation, the same fresh credential on each leg.
   */
  function queueDelivery({
    entitlement, prospect, kind, presentationToken = null, voucherToken = null,
    drawCtx = null,
    channels = ['whatsapp', 'email'],
  }) {
    if (!KIND_SENDERS[kind]) {
      d.logger.error('redeem_ops.delivery.unknown_kind', { entitlementId: entitlement?.id, kind });
      return false;
    }
    const args = kind === 'voucher'
      ? { entitlement, voucherToken }
      : kind === 'boost_receipt'
        ? { entitlement, drawCtx }
        : kind === 'handover_receipt'
          ? { entitlement }
          : { entitlement, presentationToken, drawCtx };
    const fire = (fn, channel) => {
      const delivery = Promise.resolve()
        .then(async () => {
          // PR C erasure stop: these sends are queued with a point-in-time
          // prospect object, and an erasure can land between the queue and the
          // fire. Reload the row and re-check right before sending — an erased
          // person's voucher/pass must never leave the building. Post-erasure
          // the reloaded row also has null email/phone, so the sender's own
          // guards skip too (defence in depth). isSendBlocked fails OPEN for
          // transactional purpose: a consent-infra hiccup never strands a
          // legitimate voucher. Only persisted prospects are re-checked — an
          // id-less object has no row to reload (and no erasure to observe).
          let target = prospect;
          if (prospect?.id) {
            const fresh = await d.Prospect.findByPk(prospect.id);
            if (fresh) target = fresh;
            if (await d.isSendBlocked(target, { channel, purpose: 'transactional' })) {
              d.logger.info('redeem_ops.delivery.blocked', {
                entitlementId: entitlement.id, channel, reason: 'suppressed_or_erased',
              });
              return { skipped: 'suppressed' };
            }
          }
          return fn({ ...args, prospect: target });
        })
        .then((r) => {
          if (r?.skipped) return null;
          return writeDeliveryReceipt(entitlement.id, kind, r || { sent: false, error: 'no sender result' }, channel);
        })
        .catch((err) => writeDeliveryReceipt(entitlement.id, kind, { sent: false, error: err?.message }, channel));
      pendingDeliveries.add(delivery);
      delivery.finally(() => pendingDeliveries.delete(delivery));
    };

    if (channels.includes('whatsapp')) {
      const waFn = d[KIND_SENDERS[kind].wa];
      if (typeof waFn === 'function') fire(waFn, 'whatsapp');
    }

    if (!channels.includes('email')) return false;
    const fn = d[KIND_SENDERS[kind].email];
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
          // Provider correlation ids (docs/plans/wa-delivery-truth.md):
          // messageId (wamid) keys the wa_message_statuses read-time join;
          // providerMessageId is the SMTP/SES id for the future SES-events
          // leg. Both are scrubbed by PDPA erasure.
          ...(r.messageId ? { messageId: r.messageId } : {}),
          ...(r.templateName ? { templateName: r.templateName } : {}),
          ...(r.providerMessageId ? { providerMessageId: r.providerMessageId, provider: r.provider || null } : {}),
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
      // Screening holds are reward-eligible (screening plan D8): the reward was
      // earned by verified signup; the AI gate withholds AGENT delivery only.
      // Quota / DNC / external holds stay excluded.
      if (prospect?.quarantinedAt && !SCREENING_REASONS.includes(prospect.quarantineReason)) return fail('quarantined');
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

      // A physical voucher only exists once a consultant physically hands it
      // over, so `on_capture` — which mints a voucher token and mails it the
      // instant the lead signs up — would promise a credential nobody can
      // honour and skip the handover entirely. Fail CLOSED and name the fix;
      // this is a misconfiguration, not a lead problem.
      if (offer.fulfilmentMethod === PHYSICAL_FULFILMENT && activation.unlockPolicy === 'on_capture') {
        d.logger.error('redeem_ops.activation.physical_on_capture', {
          activationId: activation.id, offerId: offer.id,
        });
        return fail('physical_requires_agent_unlock');
      }

      const onCapture = activation.unlockPolicy === 'on_capture';
      const reservationDays = offer.claimExpiryDays || DEFAULT_RESERVATION_DAYS;
      const redemptionDays = offer.redemptionExpiryDays || DEFAULT_REDEMPTION_DAYS;

      // Draw rails (PR-4, Codex R1 CX7): the pass must die WITH the boost
      // window — a relative claim window crossing boostClosesAt would let
      // post-cutoff scans "succeed" while earning nothing. Clamp only while
      // the window is still open; a pass minted after it keeps the standard
      // window (it is a plain review pass, no boost to protect).
      // Fail-open to a standard window: a campaign-fetch hiccup must never
      // block issuance — the clamp is protection, not a precondition.
      const drawCtx = await d.drawLink.drawContextForActivation(activation).catch(() => null);
      const relativeExpiryMs = Date.now() + (onCapture ? redemptionDays : reservationDays) * 24 * 3600 * 1000;
      const expiryMs = !onCapture && drawCtx?.boostCutoffMs && drawCtx.boostCutoffMs > Date.now()
        ? Math.min(relativeExpiryMs, drawCtx.boostCutoffMs)
        : relativeExpiryMs;

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

        // Consumer spine: person link at issuance — unconditional (the journey
        // view depends on it). Prefer the prospect's own link; fall back to the
        // phoneKey (consumers.phone = '+'+digits) for pre-spine prospects.
        let entitlementConsumerId = prospect.consumerId || null;
        if (!entitlementConsumerId && phoneKey) {
          entitlementConsumerId = (await d.Consumer.findOne({
            where: { phone: `+${phoneKey}` }, attributes: ['id'], transaction: t,
          }))?.id || null;
        }

        const created = await d.RewardEntitlement.create(
          {
            rewardOfferId: offer.id,
            activationId: activation.id,
            prospectId: prospect.id,
            consumerId: entitlementConsumerId,
            status: onCapture ? 'issued' : 'eligible',
            unlockedAt: onCapture ? new Date() : null,
            unlockedVia: onCapture ? 'auto_on_capture' : null,
            expiresAt: new Date(expiryMs),
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
        drawCtx, // PR-4: draw-voiced pass (template/card/copy) instead of trial voice
      });

      // Raw tokens returned ONCE for delivery (email/link); only hashes persist.
      return {
        entitlement,
        reason: null,
        presentationToken: presentation.raw,
        voucherToken: voucher ? voucher.raw : null,
        emailQueued,
        // A queued draw-pass email IS the lead-confirmation email (the merged
        // Onyx send, 2026-07-25) — the capture controller chains on this flag
        // to skip its own confirmation instead of double-sending. Only the
        // reservation kind qualifies: an on_capture voucher email confirms a
        // reward, not a draw entry.
        drawEmailQueued: Boolean(!onCapture && drawCtx && emailQueued),
      };
    } catch (err) {
      if (err?._soft) return fail(err.message);
      if (err?.name === 'SequelizeUniqueConstraintError') {
        // Two partial uniques can fire: the (activationId, prospectId)
        // idempotency anchor → 'duplicate', or the (activationId, phoneKey)
        // anti-farming guard → 'duplicate_phone' (a concurrent same-phone
        // signup lost the race). The transaction rolled back, so counters are
        // intact either way.
        // Recovery reads mirror the EXACT index that fired — both uniques are
        // per-activation, so the lookup must pin activationId too: a person
        // legitimately holding live rewards on two activations must get THIS
        // activation's row back, not whichever sorts first.
        const constraint = err?.parent?.constraint || err?.original?.constraint || '';
        if (constraint === 'uq_re_activation_phone') {
          const winner = await d.RewardEntitlement.findOne({
            where: {
              activationId: resolvedActivation.id,
              phoneKey: phoneKeyOf(prospect.phone),
              status: { [Op.in]: LIVE_PHONE_STATUSES },
            },
            order: [['createdAt', 'DESC']],
          });
          return { entitlement: winner, reason: 'duplicate_phone' };
        }
        const existing = await d.RewardEntitlement.findOne({
          where: { activationId: resolvedActivation.id, prospectId: prospect.id },
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
   * The acting agent must be the lead's assigned consultant (admin override allowed) —
   * enforced BEFORE the replay/liveness responses, so an unassigned caller gets a bare
   * 403 and can never read replay state (token hint) or probe pause status.
   * Idempotent: an already-unlocked entitlement returns { already: true }, including
   * when a concurrent unlock wins the conditional transition (double-tap race).
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
      // A physical handover lands TERMINAL ('redeemed'), so the live-first
      // query above finds nothing on a double-tap and this would 404 before
      // ever reaching the replay carve-out below. Fall back to the most recent
      // handover so the retry replays idempotently. Deliberately a SECOND
      // query rather than widening the first: adding 'redeemed' to that
      // `[Op.in]` would let an old redeemed row outrank a newer LIVE
      // reservation on createdAt and hijack a legitimate unlock.
      if (!entitlement) {
        entitlement = await d.RewardEntitlement.findOne({
          where: { prospectId: by.prospectId, status: 'redeemed', unlockedVia: { [Op.ne]: null } },
          include: [{ model: d.RewardOffer, as: 'rewardOffer', attributes: ['id', 'fulfilmentMethod'] }],
          order: [['createdAt', 'DESC']],
        });
        if (entitlement && entitlement.rewardOffer?.fulfilmentMethod !== PHYSICAL_FULFILMENT) {
          entitlement = null; // a partner-redeemed voucher is not a handover replay
        }
      }
    }
    if (!entitlement) throw new AppError('Entitlement not found', 404);

    // Assigned-consultant binding comes FIRST (admin override audited via
    // unlockedVia='manual'). Authorization must precede BOTH the replay
    // carve-out and the liveness gate: an unassigned caller may learn nothing
    // about the entitlement — not its already-unlocked state (that response
    // carries the token hint) and not whether its activation is paused.
    const prospect = entitlement.prospectId ? await d.Prospect.findByPk(entitlement.prospectId) : null;
    const isAdmin = agentUser.role === 'admin';
    if (!isAdmin) {
      if (!prospect || prospect.assignedAgentId !== agentUser.id) {
        throw new AppError('Only the assigned consultant can unlock this reward', 403);
      }
    }

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
    // partnerOrganisationId is needed for the physical-handover Redemption row
    // (models/Redemption.js:20 — NOT NULL).
    const activation = await d.Activation.findByPk(entitlement.activationId, {
      attributes: ['id', 'status', 'partnerOrganisationId'],
    });
    if (!activation || activation.status !== 'active') {
      const st = activation?.status || 'missing';
      throw new AppError(
        st === 'paused'
          ? 'Activation is paused — unlocks are temporarily disabled'
          : `Activation is ${st} — this reward can no longer be unlocked`,
        409
      );
    }

    // Draw rails (PR-4, Codex R1 CX22/CX7): "record session" appends boost
    // evidence — it must NOT mint a redeemable voucher (no token, claim page
    // shows "×N confirmed", partner redemption refuses), must NOT overwrite
    // the pass expiry with a redemption window, and must REFUSE truthfully
    // once the boost window has closed rather than confirm an unearned ×N.
    const drawCtx = await d.drawLink.drawContextForEntitlement(entitlement);
    if (drawCtx?.boostCutoffMs && Date.now() >= drawCtx.boostCutoffMs) {
      const err = new AppError(
        `The ×${drawCtx.multiplier} window for "${drawCtx.drawName}" closed on ${drawCtx.boostClosesAt} — this session no longer earns extra entries and must not be recorded as a boost.`,
        409
      );
      err.data = { code: 'DRAW_BOOST_WINDOW_CLOSED', boostClosesAt: drawCtx.boostClosesAt };
      throw err;
    }

    const offer = await d.RewardOffer.findByPk(entitlement.rewardOfferId);
    const redemptionDays = offer?.redemptionExpiryDays || DEFAULT_REDEMPTION_DAYS;
    // Physical handover: the consultant bought the voucher and is putting it in
    // the lead's hand right now, so THIS is the fulfilment — there is no later
    // partner leg to wait for (FairPrice will never call our redemption API).
    // Draw rails win the priority contest: a draw session is boost evidence and
    // must never mint or complete reward value.
    const physical = !drawCtx && offer?.fulfilmentMethod === PHYSICAL_FULFILMENT;
    const voucher = drawCtx || physical ? null : mintToken();

    let raced = false;
    let redemption = null;
    await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(
        {
          // Physical handover is TERMINAL — nothing further can happen to it.
          status: physical ? 'redeemed' : 'issued',
          unlockedAt: new Date(),
          unlockedByUserId: agentUser.id,
          unlockedVia: isAdmin && !prospect ? 'manual' : via,
          // Trial rails mint the redemption voucher + window; draw rails AND
          // physical handovers keep token fields null and the RESERVATION
          // expiry untouched (neither has a partner redemption to time-box —
          // CX22, and for draws the untouched expiry is what makes
          // undoSessionUnlock restoration-free).
          ...(drawCtx || physical
            ? {}
            : {
                tokenHash: voucher.hash,
                tokenHint: tokenHintOf(voucher.raw),
                expiresAt: new Date(Date.now() + redemptionDays * 24 * 3600 * 1000),
              }),
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
        raced = true;
        return;
      }
      await writeEvent(t, {
        entitlementId: entitlement.id, type: 'unlocked',
        actorType: 'agent', actorUserId: agentUser.id,
        metadata: { via, ...(drawCtx ? { draw: true, multiplier: drawCtx.multiplier } : {}) },
      });
      if (physical) {
        // Redemption accounting rides the SAME transaction as the unlock, so a
        // handover is never half-recorded. Only the REDEEMED side is moved:
        // issuance was already consumed at reservation (issueForProspect —
        // inventory.recordIssued + issuedCount+1 while status was 'eligible'),
        // so the `issuedQuantity - redeemedQuantity >= 1` guard in
        // inventory.recordRedeemed is already satisfied and the
        // committed >= allocated >= issued >= redeemed invariant holds.
        // Re-recording issuance here would double-count it.
        redemption = await d.Redemption.create(
          {
            entitlementId: entitlement.id,
            rewardOfferId: entitlement.rewardOfferId,
            activationId: entitlement.activationId,
            partnerOrganisationId: activation.partnerOrganisationId,
            locationId: null, // handed over by the consultant, not at a partner site
            method: 'agent_handover',
            actorType: 'agent',
            actorUserId: agentUser.id,
            notes: null,
          },
          { transaction: t }
        );
        await d.inventory.recordRedeemed({
          offerId: entitlement.rewardOfferId, activationId: entitlement.activationId,
          entitlementId: entitlement.id, redemptionId: redemption.id,
          actorType: 'agent', actorUser: agentUser, transaction: t,
        });
        await d.sequelize.query(
          `UPDATE activations SET "redeemedCount" = "redeemedCount" + 1, "updatedAt" = NOW()
            WHERE id = :id`,
          { replacements: { id: entitlement.activationId }, transaction: t }
        );
        await writeEvent(t, {
          entitlementId: entitlement.id, redemptionId: redemption.id, type: 'redeemed',
          actorType: 'agent', actorUserId: agentUser.id,
          metadata: { method: 'agent_handover', locationId: null },
        });
      }
    });
    if (raced) {
      // The conditional transition lost. A concurrent unlock WINNING is the
      // idempotent case (the double-tap race) — report it as a replay, not a
      // scary 409; the caller is already authorized above. Everything else
      // (expiry passed, activation went non-active at commit time) stays 409.
      await entitlement.reload();
      if (['issued', 'redeemed'].includes(entitlement.status)) {
        return { entitlement, already: true, voucherToken: null, emailQueued: false, drawBoost: drawCtx ? { multiplier: drawCtx.multiplier } : null };
      }
      throw new AppError('Reservation expired, already unlocked, or its activation is no longer active', 409);
    }

    await entitlement.reload();
    // Fire-and-forget delivery (receipt-tracked): voucher for trial rails,
    // the "×N confirmed" receipt for draw rails (F13 — never the partner-
    // redemption voucher email a draw entrant can do nothing with).
    const emailQueued = drawCtx
      ? queueDelivery({ entitlement, prospect, kind: 'boost_receipt', drawCtx })
      : physical
        ? queueDelivery({ entitlement, prospect, kind: 'handover_receipt' })
        : queueDelivery({ entitlement, prospect, kind: 'voucher', voucherToken: voucher.raw });
    // A handover IS the conversion. The CAPI sweep already selects every
    // status='redeemed' row (redemptionOutcomeService.sweepUnmarkedRedemptions),
    // so this event fires with or without us — dispatching here just makes it
    // prompt instead of up-to-a-sweep late. Deterministic event id ⇒ the two
    // paths dedupe. Fire-and-forget: ad reporting never blocks a handover.
    if (physical && typeof d.onRedemption === 'function') {
      Promise.resolve(d.onRedemption({ entitlement, redemption })).catch((err) => {
        d.logger.warn('redeem_ops.handover.capi_dispatch_failed', {
          entitlementId: entitlement.id, error: err?.message,
        });
      });
    }
    return {
      entitlement, already: false, voucherToken: drawCtx || physical ? null : voucher.raw, emailQueued,
      handover: physical ? { redemptionId: redemption?.id || null } : null,
      drawBoost: drawCtx ? { multiplier: drawCtx.multiplier, boostClosesAt: drawCtx.boostClosesAt } : null,
    };
  }

  /**
   * Undo a recorded draw session (PR-4, Codex R1 CX23 + decision D2
   * "reversible"). Draw rails ONLY — trial vouchers are money-shaped and keep
   * their existing cancel/void paths. Race-free vs seal BY THE WINDOW RULE:
   * undo refuses at/after boostClosesAt, and seal can only run at/after it,
   * so the two can never interleave. Append-only: the reversal is an
   * `unlock_reversed` event carrying the superseded unlock's event id —
   * collectBoostEvidence skips superseded unlocks, and a LATER genuine
   * re-scan mints a fresh unlocked event that boosts again. The status flip
   * issued→eligible is restoration-free because the draw unlock never touched
   * token fields or expiry.
   */
  async function undoSessionUnlock(id, user, { reason = null } = {}, requestId = null) {
    const entitlement = await d.RewardEntitlement.findByPk(id);
    if (!entitlement) throw new AppError('Entitlement not found', 404);
    const drawCtx = await d.drawLink.drawContextForEntitlement(entitlement);
    if (!drawCtx) {
      throw new AppError('Undo applies to lucky-draw session records only — use Cancel/Void for partner vouchers', 409);
    }
    if (entitlement.status !== 'issued') {
      throw new AppError(`Entitlement is ${entitlement.status} — nothing to undo`, 409);
    }
    if (drawCtx.boostCutoffMs && Date.now() >= drawCtx.boostCutoffMs) {
      const err = new AppError(
        `The boost window closed on ${drawCtx.boostClosesAt} — the pool is sealing/sealed and session records can no longer be undone.`,
        409
      );
      err.data = { code: 'DRAW_BOOST_WINDOW_CLOSED' };
      throw err;
    }

    const lastUnlock = await d.RedemptionEvent.findOne({
      where: { entitlementId: id, type: 'unlocked' },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      attributes: ['id'],
    });

    let undone = false;
    await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(
        { status: 'eligible', unlockedAt: null, unlockedByUserId: null, unlockedVia: null },
        { where: { id, status: 'issued' }, transaction: t }
      );
      if (count === 0) return; // raced a redemption/cancel — report below
      await writeEvent(t, {
        entitlementId: id, type: 'unlock_reversed', actorType: 'staff', actorUserId: user?.id || null,
        metadata: {
          supersedesEventId: lastUnlock?.id || null,
          ...(reason ? { reason: String(reason).slice(0, 200) } : {}),
        },
      });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'entitlement.session_undone', entityType: 'reward_entitlement',
        entityId: id, reason, requestId, transaction: t,
      });
      undone = true;
    });
    if (!undone) {
      throw new AppError('Entitlement changed state — nothing was undone', 409);
    }
    await entitlement.reload();
    return { entitlement, supersededEventId: lastUnlock?.id || null };
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

    // A physical handover is terminal, so without this it could never be
    // re-sent — and it is the one kind the reconciler cannot recover either
    // (reconcileMissedDeliveries sweeps only eligible/issued), which makes
    // Resend its ONLY recovery path. Rotates no token: there isn't one.
    const resendOffer = await d.RewardOffer.findByPk(entitlement.rewardOfferId, {
      attributes: ['id', 'fulfilmentMethod'],
    });
    const isHandover = entitlement.status === 'redeemed'
      && resendOffer?.fulfilmentMethod === PHYSICAL_FULFILMENT
      && entitlement.unlockedVia !== null;
    let kind = entitlement.status === 'eligible' ? 'pass'
      : entitlement.status === 'issued' ? 'voucher'
        : isHandover ? 'handover_receipt' : null;
    if (!kind) throw new AppError(`Entitlement is ${entitlement.status}`, 409);
    // Draw rails (PR-4/CX22): a recorded session holds NO voucher — rotating
    // tokenHash and mailing partner-redemption copy would mint the credential
    // CX22 forbids. Its resend is the informational ×N BOOST RECEIPT: no
    // token, no rotation, same audit shape (wa-delivery-truth — the capped
    // 131049 receipt needed exactly this recovery). Classification fails
    // CLOSED: a draw-lookup error on an issued row must retry later, never
    // fall through to minting a voucher for what might be a draw session.
    const resendDrawCtx = await d.drawLink.drawContextForEntitlement(entitlement).catch((err) => {
      if (kind === 'voucher') {
        throw new AppError(`Draw classification failed (${err?.message || 'lookup error'}) — retry shortly`, 503);
      }
      return null;
    });
    if (kind === 'voucher' && resendDrawCtx) kind = 'boost_receipt';
    if ((kind === 'boost_receipt' || kind === 'handover_receipt') && channel === 'link') {
      throw new AppError(
        kind === 'handover_receipt'
          ? 'A handed-over physical voucher has no credential to share — resend the receipt by email or WhatsApp'
          : 'A recorded draw session has no credential to share — resend the receipt by email or WhatsApp',
        409
      );
    }
    // handover_receipt is exempt: expiresAt on a handed-over row is the old
    // RESERVATION window (left untouched at handover), so it goes stale while
    // the receipt stays perfectly valid — the voucher is already in their hand.
    if (kind !== 'handover_receipt' && entitlement.expiresAt && new Date(entitlement.expiresAt) <= new Date()) {
      throw new AppError('Reward has expired — nothing to resend', 409);
    }

    const prospect = entitlement.prospectId ? await d.Prospect.findByPk(entitlement.prospectId) : null;
    // 'both' resends on email AND WhatsApp with one token rotation. Each
    // requested leg must be deliverable (the ops menu only offers a leg when
    // its row flag says so, so this is defence-in-depth).
    const wantEmail = channel === 'email' || channel === 'both';
    const wantWa = channel === 'whatsapp' || channel === 'both';
    if (wantEmail && !canEmailProspect(prospect)) {
      throw new AppError('No usable email on file — use WhatsApp or the copy-link option instead', 409);
    }
    if (wantWa && !(waEnabled() && (await canWhatsAppProspect(prospect)))) {
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
    const resendAction = kind === 'pass' ? 'resend_pass'
      : kind === 'boost_receipt' ? 'resend_boost'
        : kind === 'handover_receipt' ? 'resend_handover' : 'resend_voucher';
    const clash = recent.some((e) => {
      const m = e.metadata || {};
      if (e.type === 'manual_override') return m.action === resendAction || (m.action === 'auto_resend' && m.kind === kind);
      return m.kind === kind;
    });
    if (clash) {
      throw new AppError('A delivery for this reward was attempted less than a minute ago — wait and retry', 429);
    }

    // boost_receipt carries NO credential — nothing to mint or rotate; the
    // audit trail still gets its manual_override + audit rows.
    // Neither receipt kind carries a credential — nothing to mint or rotate;
    // the audit trail still gets its manual_override + audit rows.
    const fresh = kind === 'boost_receipt' || kind === 'handover_receipt' ? null : mintToken();
    await d.sequelize.transaction(async (t) => {
      if (fresh) {
        const fields = kind === 'pass'
          ? { presentationTokenHash: fresh.hash }
          : { tokenHash: fresh.hash, tokenHint: tokenHintOf(fresh.raw) };
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
      // PR C: the share bundle embeds the person's name + raw phone and skips
      // queueDelivery's erasure fence — re-check on a FRESH row here (the
      // stale `prospect` was loaded before the token rotation).
      const freshProspect = entitlement.prospectId
        ? await d.Prospect.findByPk(entitlement.prospectId)
        : prospect;
      if (await d.isSendBlocked(freshProspect || prospect, { channel: 'all', purpose: 'transactional' })) {
        throw new AppError('This customer was erased (PDPA) — nothing can be shared', 410);
      }
      const bundle = await builders().buildShareBundle({
        entitlement, prospect: freshProspect || prospect, kind, rawToken: fresh.raw,
      });
      return { entitlement, kind, channel, emailQueued: false, ...bundle };
    }
    // boost_receipt rides the same call: fresh is null so both tokens stay
    // null, and queueDelivery's kind switch selects {entitlement, drawCtx}.
    const emailQueued = queueDelivery({
      entitlement, prospect, kind,
      presentationToken: kind === 'pass' && fresh ? fresh.raw : null,
      voucherToken: kind === 'voucher' && fresh ? fresh.raw : null,
      drawCtx: resendDrawCtx,
      channels: [wantWa ? 'whatsapp' : null, wantEmail ? 'email' : null].filter(Boolean),
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
          // Screening holds included (D8) — same eligibility as the hook.
          [Op.or]: [{ quarantinedAt: null }, { quarantineReason: { [Op.in]: SCREENING_REASONS } }],
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
        // One bad row must not abort the sweep — but the skip ledger only
        // records typed refusals, so an unlogged throw here would make a
        // systemic failure invisible.
        const r = await issueForProspect(prospect, { via: 'sweep' }).catch((err) => {
          d.logger.warn('redeem_ops.entitlement.reconcile_failed', { prospectId: prospect.id, error: err?.message });
          return null;
        });
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
   * credential we cannot deliver). Issued DRAW sessions are token-free by
   * design: their recovery is the "×N confirmed" boost receipt, never a
   * voucher mint, and draw classification fails closed (skip, retry next
   * sweep) so a lookup error can never reclassify a draw rail.
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
        // Draw classification comes BEFORE the kind decision, and it fails
        // CLOSED: an issued draw session's missed delivery is the ×N boost
        // receipt — recovering it as a voucher would mint the redeemable
        // credential draw rails must never carry (the 2026-07-25 clobber
        // outage nearly did exactly that). A lookup error skips the row
        // (retried next sweep) rather than risking that misclassification.
        let drawCtx;
        try {
          drawCtx = await d.drawLink.drawContextForEntitlement(ent);
        } catch (err) {
          d.logger.warn('redeem_ops.delivery.recover_draw_lookup_failed', { id: ent.id, error: err?.message });
          continue;
        }
        const kind = ent.status === 'eligible' ? 'pass' : drawCtx ? 'boost_receipt' : 'voucher';
        const fn = kind === 'voucher' ? d.notifyUnlock : kind === 'boost_receipt' ? d.notifyBoostReceipt : d.notifyReservation;
        if (typeof fn !== 'function') continue; // unwired — never rotate undeliverably
        if (!canEmailProspect(ent.prospect)) continue; // link-channel-only customer
        const stateSince = kind === 'pass' ? ent.createdAt : (ent.unlockedAt || ent.createdAt);
        if (new Date(stateSince) > cutoff) continue; // give the in-flight send its window

        const receipts = await d.RedemptionEvent.findAll({
          where: { entitlementId: ent.id, type: { [Op.in]: ['notified', 'notify_failed'] } },
          order: [['createdAt', 'DESC']],
          limit: 20,
        });
        const forKind = receipts.filter((e) => e.metadata?.kind === kind && (e.metadata?.channel || 'email') === 'email');
        if (forKind.some((e) => e.type === 'notified')) continue; // delivered
        if (forKind.length >= maxAttempts) continue; // gave up — visible on the console

        // boost_receipt carries NO credential — nothing to rotate. Its resend
        // is the informational "×N confirmed" email plus the same audit row;
        // pass/voucher keep the rotate-inside-a-guarded-transaction shape.
        const fresh = kind === 'boost_receipt' ? null : mintToken();
        if (fresh) {
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
        } else {
          await writeEvent(null, {
            entitlementId: ent.id, type: 'manual_override', actorType: 'system',
            metadata: { action: 'auto_resend', kind, channel: 'email' },
          });
        }
        queueDelivery({
          entitlement: ent, prospect: ent.prospect, kind,
          presentationToken: kind === 'pass' && fresh ? fresh.raw : null,
          voucherToken: kind === 'voucher' && fresh ? fresh.raw : null,
          drawCtx,
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
        // The redemption backing a redeemed row — its id is what the Void
        // action reverses (POST /redemptions/:id/reverse), which flips the
        // entitlement to cancelled and frees the one-live-reward-per-phone slot.
        { model: d.Redemption, as: 'redemption', attributes: ['id', 'status', 'redeemedAt'], required: false },
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
    // Post-acceptance truth (wa-delivery-truth): join the Meta status inbox by
    // wamid so the console can distinguish accepted from delivered/failed.
    const wamids = [...new Set(
      [...latestReceipt.values()].map((e) => e.metadata?.messageId).filter(Boolean)
    )];
    const statusByWamid = new Map();
    if (wamids.length) {
      for (const s of await d.WaMessageStatus.findAll({ where: { wamid: { [Op.in]: wamids } } })) {
        statusByWamid.set(s.wamid, s);
      }
    }
    const receiptView = (e) => {
      if (!e) return null;
      const s = e.metadata?.messageId ? statusByWamid.get(e.metadata.messageId) : null;
      return {
        kind: e.metadata?.kind || null,
        at: e.createdAt,
        ok: e.type === 'notified',
        delivery: s
          ? { status: s.status, at: s.occurredAt, errorCode: s.errorCode, errorTitle: s.errorTitle }
          : null,
      };
    };

    // Draw-linkage per activation (PR-4) — one lookup per distinct activation,
    // so the console can voice draw rows ("Session ×N") and offer Undo.
    const drawByActivation = new Map();
    for (const actId of [...new Set(rows.map((r) => r.activationId))]) {
      drawByActivation.set(actId, await d.drawLink.drawContextForActivation(actId).catch(() => null));
    }

    // Mask phones by default (redemptions.verify unmasks at the console)
    const nowMs = Date.now();
    const masked = rows.map((r) => {
      const j = r.toJSON();
      j.emailDeliverable = canEmailProspect(j.prospect);
      const dctx = drawByActivation.get(j.activationId) || null;
      j.drawLinked = !!dctx;
      j.drawMultiplier = dctx?.multiplier || null;
      j.canUndoSession = !!dctx && j.status === 'issued'
        && (!dctx.boostCutoffMs || nowMs < dctx.boostCutoffMs);
      // Capability only (waEnabled + a WA-able phone; no ledger read in the
      // bulk list projection) — the ledger-based send-time gate (erasure-only
      // for transactional, 3sites) stays authoritative. Flag off ⇒ false
      // everywhere, so the console never offers a channel that can't fire.
      j.whatsappDeliverable = waEnabled() && Boolean(waRecipient(j.prospect?.phone));
      j.delivery = {
        email: receiptView(latestReceipt.get(`${j.id}:email`)),
        whatsapp: receiptView(latestReceipt.get(`${j.id}:whatsapp`)),
      };
      if (j.prospect) {
        if (j.prospect.phone) j.prospect.phone = `••••${String(j.prospect.phone).slice(-4)}`;
        delete j.prospect.email;
      }
      // Surface the redemption id (+ whether it is already reversed) so the
      // console can offer Void on redeemed rows without a second fetch.
      j.redemptionId = j.redemption?.id || null;
      j.redemptionReversed = j.redemption?.status === 'reversed';
      delete j.redemption;
      return j;
    });
    return { entitlements: masked, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
  }

  /**
   * Cancel every LIVE entitlement of a prospect INSIDE the caller's
   * transaction (PR-2, Codex R1 CX13): prospect deletion previously SET-NULL
   * orphaned live passes — still scannable, phone slot still held, inventory
   * never returned. Called from prospectService.deleteProspect so the cancel
   * commits (or rolls back) WITH the delete; bulk delete loops single and
   * inherits. Mirrors cancelEntitlement's effects row-for-row (status flip +
   * inventory reversal + issuedCount decrement + redemption_event) with
   * actorType 'system' — no audit-console actor exists for a cascade.
   */
  async function cancelLiveEntitlementsForProspectTx(prospectId, t, { reason = 'prospect_deleted' } = {}) {
    const live = await d.RewardEntitlement.findAll({
      where: { prospectId, status: { [Op.in]: ['eligible', 'issued'] } },
      transaction: t,
      lock: t.LOCK ? t.LOCK.UPDATE : undefined,
    });
    let cancelled = 0;
    for (const ent of live) {
      const [count] = await d.RewardEntitlement.update(
        { status: 'cancelled' },
        { where: { id: ent.id, status: { [Op.in]: ['eligible', 'issued'] } }, transaction: t }
      );
      if (count === 0) continue; // raced a redemption/cancel — leave as-is
      await d.inventory.reverseIssued({
        offerId: ent.rewardOfferId, activationId: ent.activationId,
        entitlementId: ent.id, type: 'cancelled', actorType: 'system', reason, transaction: t,
      });
      await d.sequelize.query(
        `UPDATE activations SET "issuedCount" = "issuedCount" - 1, "updatedAt" = NOW()
          WHERE id = :id AND "issuedCount" > 0`,
        { replacements: { id: ent.activationId }, transaction: t }
      );
      await writeEvent(t, {
        entitlementId: ent.id, type: 'manual_override', actorType: 'system',
        metadata: { action: 'cancelled', reason },
      });
      cancelled += 1;
    }
    return { cancelled };
  }

  return {
    issueForProspect, unlockEntitlement, undoSessionUnlock, issueManual, cancelEntitlement, resendDelivery,
    expireReservations, reconcileMissedLeads, reconcileMissedDeliveries, purgeIssuanceSkips,
    listEntitlements, verificationStampOf,
    cancelLiveEntitlementsForProspectTx,
    queueDelivery, // exported for tests: the per-channel fan-out contract (PR E)
  };
}

const _default = makeEntitlementService();
export const cancelLiveEntitlementsForProspectTx = (...a) => _default.cancelLiveEntitlementsForProspectTx(...a);
export const undoSessionUnlock = (...a) => _default.undoSessionUnlock(...a);
export default _default;
