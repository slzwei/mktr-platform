import { Op } from 'sequelize';
import {
  RewardEntitlement, RedemptionEvent, Redemption, Activation, ActivationIssuanceSkip, RewardOffer,
  PartnerOrganisation, Prospect, User, Consumer, Campaign, WaMessageStatus, sequelize,
} from '../../models/index.js';
import { phoneVerificationIsCurrent } from '../consumerService.js';
import { AppError } from '../../middleware/appError.js';
import { logger } from '../../utils/logger.js';
import { makeInventoryService } from './inventoryService.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { mintToken, hashToken, tokenHintOf } from './tokens.js';
import { canEmailProspect, makeFulfilmentNotify } from './fulfilmentNotify.js';
import { canWhatsAppProspect, waEnabled } from './whatsappService.js';
import { isSendBlocked } from '../consentService.js';
import { SCREENING_REASONS } from '../screeningConstants.js';
import { makeDrawLink } from './drawLink.js';
import { makeEntitlementDelivery, flushDeliveries } from './entitlementDelivery.js';
import { makeEntitlementQuery } from './entitlementQuery.js';
import { makeEntitlementReconciliation } from './entitlementReconciliation.js';
import { makeRedemptionEventWriter } from './redemptionEvents.js';

export { flushDeliveries };

const DEFAULT_RESERVATION_DAYS = 30;
const DEFAULT_REDEMPTION_DAYS = 90;
const RESEND_COOLDOWN_MS = 60 * 1000;
// Statuses that hold the per-phone slot (matches uq_re_activation_phone's
// partial WHERE) — expired/cancelled rows free it. Exported for the Lead
// Profile diagnostic, which mirrors issueForProspect's duplicate-phone check.
export const LIVE_PHONE_STATUSES = ['eligible', 'issued', 'redeemed'];

export const PHYSICAL_FULFILMENT = 'physical_voucher';

/**
 * Anti-farming dedupe key: digits-only phone (`+65 9123 4567` → `6591234567`).
 * Null for missing/garbage values so junk can never occupy a slot.
 */
export function phoneKeyOf(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

// The delivery fan-out and its in-flight barrier live in entitlementDelivery.js
// (P3-2); flushDeliveries is re-exported above so the public API is unchanged.

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

  // Shared with redemptionService via redemptionEvents.js (P3-2). 'system' is
  // this engine's default actor: sweeps, hooks and cascades have no human.
  const writeEvent = makeRedemptionEventWriter(d, 'system');

  // The delivery fan-out (P3-2). Every issuance/unlock/resend path calls it.
  const { queueDelivery, writeDeliveryReceipt } = makeEntitlementDelivery({ d });
  // The masked list projection (P3-2) — a pure read, nothing else calls it.
  const { listEntitlements } = makeEntitlementQuery({ d });

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




  /**
   * Issue (reserve) for a captured lead. Returns the entitlement or null with a
   * reason — NEVER throws into the capture path (the hook wraps it anyway).
   * `activationId` (manual path) pins the EXACT activation staff selected —
   * without it, issueManual could issue/email a different activation than the
   * audit row claims (Codex blocker, 2026-07-16).
   */
  async function issueForProspect(prospect, { via = 'hook', activationId = null, overrideVerification = false } = {}) {
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
      // The stamp is server-written and is the anti-farming gate. The ONLY way
      // past it is an authorized, reasoned override from issueManual (P2-7) —
      // never a fabricated stamp on the prospect JSON.
      if (!verificationStampOf(prospect) && !overrideVerification) return fail('phone_not_verified');

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

  /**
   * Manual issue by redemption_ops (requires an existing lead).
   *
   * The phone-verification stamp is the core anti-farming gate, and it is
   * SERVER-stamped for exactly that reason. This path used to synthesize
   * `phoneVerifiedAt: … || new Date()` onto the prospect JSON before issuing,
   * which defeated the gate SILENTLY: capability-gated and audited, yes, but
   * nothing in the request said "issue to an unverified phone" and nothing in
   * the audit trail recorded that it had happened (P2-7).
   *
   * Now the bypass is a deliberate, reasoned act — `overrideVerification: true`
   * plus a reason — and it lands in the audit `after`. Without it the real
   * stamp decides, so an unverified phone is refused like any other.
   */
  async function issueManual({ activationId, prospectId, overrideVerification = false, overrideReason = null }, user, requestId = null) {
    const activation = await d.Activation.findByPk(activationId, {
      include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
    });
    if (!activation) throw new AppError('Activation not found', 404);
    const prospect = await d.Prospect.findByPk(prospectId);
    if (!prospect) throw new AppError('Lead not found', 404);

    // activationId is threaded through so the SELECTED activation is the one
    // issued + emailed + audited (issueForProspect would otherwise re-resolve
    // by the prospect's campaign and could pick a different activation).
    const reason = String(overrideReason || '').trim();
    if (overrideVerification && !reason) {
      throw new AppError('A reason is required to override phone verification', 400);
    }
    const alreadyVerified = Boolean(verificationStampOf(prospect));
    if (overrideVerification && !alreadyVerified) {
      d.logger?.warn?.('[RedeemOps] manual issue overriding phone verification', {
        prospectId, activationId, actorUserId: user?.id, reason,
      });
    }

    // The prospect is passed THROUGH — never with a fabricated stamp. The
    // override is carried as an explicit flag so issueForProspect's gate can
    // see an authorized decision rather than a forged fact.
    const result = await issueForProspect(
      prospect.toJSON(),
      { via: 'manual', activationId, overrideVerification: overrideVerification === true }
    );
    if (!result.entitlement) throw new AppError(`Cannot issue: ${result.reason}`, 409);
    if (result.reason === 'duplicate_phone') {
      // The returned entitlement belongs to ANOTHER prospect with the same
      // phone — never report that as a successful manual issue.
      throw new AppError('Cannot issue: duplicate_phone — this phone already holds a live reward for this activation', 409);
    }
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'entitlement.issued_manual', entityType: 'reward_entitlement',
      entityId: result.entitlement.id,
      after: {
        activationId, prospectId,
        // Record the bypass, not just the issue: "who minted a reward for an
        // unverified phone, and why" must be answerable from the audit alone.
        overrideVerification: overrideVerification === true,
        ...(overrideVerification === true ? { overrideReason: reason, phoneWasVerified: alreadyVerified } : {}),
      },
      ...(overrideVerification === true ? { reason } : {}),
      requestId,
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

  // The catch-up sweeps (P3-2). They drive the live paths above, so those are
  // injected — the sweeps never re-implement issuance or delivery.
  const { purgeIssuanceSkips, expireReservations, reconcileMissedLeads, reconcileMissedDeliveries } =
    makeEntitlementReconciliation({ d, issueForProspect, queueDelivery, writeEvent });

  return {
    issueForProspect, unlockEntitlement, undoSessionUnlock, issueManual, cancelEntitlement, resendDelivery,
    expireReservations, reconcileMissedLeads, reconcileMissedDeliveries, purgeIssuanceSkips,
    listEntitlements,
    cancelLiveEntitlementsForProspectTx,
    queueDelivery, // exported for tests: the per-channel fan-out contract (PR E)
  };
}

const _default = makeEntitlementService();
export const cancelLiveEntitlementsForProspectTx = (...a) => _default.cancelLiveEntitlementsForProspectTx(...a);
export const undoSessionUnlock = (...a) => _default.undoSessionUnlock(...a);
export default _default;
