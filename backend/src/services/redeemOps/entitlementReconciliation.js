/**
 * The entitlement RECONCILIATION sweeps (P3-2).
 *
 * Lifted out of entitlementService verbatim: reservation expiry, the
 * missed-lead sweep, the missed-delivery sweep, and skip-log retention.
 *
 * These share one shape — each is a periodic, best-effort catch-up that finds
 * rows a live path should have handled and handles them now — and each depends
 * on a live path to do the actual work, so issueForProspect, queueDelivery and
 * writeEvent are injected rather than imported. Behaviour is unchanged,
 * including every fail-closed guard (a bare instance with no notify deps wired
 * still returns 0 rather than rotating a token it cannot deliver).
 */
import { Op } from 'sequelize';
import { SCREENING_REASONS } from '../screeningConstants.js';
import { mintToken, tokenHintOf } from './tokens.js';
import { canEmailProspect } from './fulfilmentNotify.js';

/**
 * @param {object} args
 * @param {object} args.d The entitlement service's dependency object.
 * @param {Function} args.issueForProspect The live issuance path (missed-lead sweep).
 * @param {Function} args.queueDelivery The delivery fan-out (missed-delivery sweep).
 * @param {Function} args.writeEvent The redemption_events writer.
 * @returns {{ purgeIssuanceSkips: Function, expireReservations: Function,
 *   reconcileMissedLeads: Function, reconcileMissedDeliveries: Function }}
 */
export function makeEntitlementReconciliation({ d, issueForProspect, queueDelivery, writeEvent }) {
  /** Retention for the skip log — called from the fulfilment sweep. */
  async function purgeIssuanceSkips({ days = 30 } = {}) {
    const removed = await d.ActivationIssuanceSkip.destroy({
      where: { createdAt: { [Op.lt]: new Date(Date.now() - days * 24 * 3600 * 1000) } },
    });
    if (removed > 0) d.logger.info('redeem_ops.issuance.skips_purged', { removed });
    return removed;
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

  return { purgeIssuanceSkips, expireReservations, reconcileMissedLeads, reconcileMissedDeliveries };
}
