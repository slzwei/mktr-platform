/**
 * The masked entitlement LIST projection (P3-2).
 *
 * Lifted out of entitlementService verbatim. It is the one pure read in that
 * file — no state transitions, no sends, no sweeps — and it was the easiest
 * 130 lines to separate: nothing else in the service calls it.
 *
 * Behaviour is unchanged, including the masking rules that decide what a given
 * caller is allowed to see.
 */
import { Op } from 'sequelize';
import { canEmailProspect } from './fulfilmentNotify.js';
import { waEnabled, waRecipient } from './whatsappService.js';
import { maskPhoneDots } from '../phoneMask.js';
import { escapeLike } from '../../utils/escapeLike.js';

/**
 * @param {object} args
 * @param {object} args.d The entitlement service's dependency object.
 * @returns {{ listEntitlements: Function }}
 */
export function makeEntitlementQuery({ d }) {
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
      const like = `%${escapeLike(term)}%`;
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
    const drawByActivation = new Map(
      await Promise.all(
        [...new Set(rows.map((r) => r.activationId))].map(async (actId) => [
          actId,
          await d.drawLink.drawContextForActivation(actId).catch(() => null),
        ])
      )
    );

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
        if (j.prospect.phone) j.prospect.phone = maskPhoneDots(j.prospect.phone);
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

  return { listEntitlements };
}
