import { Op, Transaction } from 'sequelize';
import { PROSPECT_UPDATE_FIELDS } from './prospectShared.js';
import {
  buildLeadDeletedPayload,
  destinationForAgent,
  normalizePhone,
} from './prospectHelpers.js';

/**
 * Prospect MUTATION ops (P-split of prospectService): the staff-edit surface —
 * updateProspect (the H3/H4 hot zone: transactional demographics revisions,
 * the conditional won-transition), deleteProspect (transactional-outbox
 * lead.deleted + entitlement teardown), scheduleFollowUp, and the bulk delete
 * fan-out. Same DI shape as the sibling make*Ops factories: `d` is the
 * service dep container, `m` the models. Extracted verbatim — behaviour is
 * covered by prospects/prospectDemographicsRevision/prospectWonGuard suites.
 */
export function makeProspectMutationOps({ d, m }) {
  /**
   * Update a prospect. Handles status-change-to-won commission logic.
   */
  async function updateProspect(id, body, user) {
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { id, ...scopeFilter };

    const prospect = await m.Prospect.findOne({
      where: whereConditions,
      include: [{ association: 'assignedAgent', attributes: ['firstName', 'lastName', 'email'] }],
    });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    // PR C: an erased row is a legal skeleton — staff edits must not be able
    // to re-attach PII to it (a re-signup creates a fresh row instead).
    if (prospect.sourceMetadata?.erased === true) {
      throw new d.AppError('This lead was erased (PDPA) and can no longer be edited', 410);
    }

    const oldStatus = prospect.leadStatus;
    const oldAssignedAgentId = prospect.assignedAgentId;
    const oldAssignedAgent = prospect.assignedAgent;

    const safeUpdates = Object.fromEntries(Object.entries(body).filter(([k]) => PROSPECT_UPDATE_FIELDS.includes(k)));

    // Identity-integrity on phone edits (plan §2.3, Codex R1 #6): normalize
    // exactly like capture, and strip the OTP verification stamp — it is bound
    // to the OLD number via phoneVerifiedFor, so it must not survive the edit
    // (entitlement issuance independently re-checks the binding).
    const oldPhone = prospect.phone;
    if (safeUpdates.phone !== undefined && safeUpdates.phone !== null) {
      const trimmed = String(safeUpdates.phone).trim();
      // Blank clears the number — and the person link goes with it (R2 #4).
      safeUpdates.phone = trimmed ? normalizePhone(trimmed) : null;
    }
    const phoneChanged = safeUpdates.phone !== undefined && safeUpdates.phone !== oldPhone;
    const emailChanged = safeUpdates.email !== undefined && safeUpdates.email !== prospect.email;
    // The strip itself happens ATOMICALLY inside the managed transaction via
    // prospectJsonPatch.removePaths — the old whole-object spread-save could
    // delete marker/fact keys landed by other writers between this read and
    // the save (plan google-ads-signal-levers §4.3).
    const strippingVerification = Boolean(phoneChanged && prospect.sourceMetadata?.phoneVerifiedAt);
    if (phoneChanged && !safeUpdates.phone) {
      // Phone cleared entirely: no number, no person link (recompute below
      // only handles E.164 values; the reconciler's empty-phone step is the
      // backstop).
      safeUpdates.consumerId = null;
    }

    // Won-transition precondition (Codex R1 #5, H4): a lead may only be marked
    // won while assigned to a REAL assignee — an internal agent that isn't the
    // System Agent, or an external (mktr-leads) agent. A null assignedAgentId
    // is just as unassigned as the System Agent, so it rejects too. This early
    // check only shapes the friendly 400 for obvious requests — ENFORCEMENT is
    // the conditional UPDATE below, which re-checks under the row's write lock.
    const becomingWon = oldStatus !== 'won' && safeUpdates.leadStatus === 'won';
    let systemAgentId = null;
    if (becomingWon) {
      systemAgentId = await d.getSystemAgentId();
      const hasRealInternalAgent =
        prospect.assignedAgentId && prospect.assignedAgentId !== systemAgentId;
      if (!hasRealInternalAgent && !prospect.externalAgentId) {
        throw new d.AppError('Lead must be assigned to a real agent before marking as won', 400);
      }
    }

    // H3: a demographics edit writes the fields, the revision bump, the fact
    // snapshot, and the outbox row in ONE transaction. The bump is
    // column-relative with RETURNING — never computed from the possibly-stale
    // loaded instance — and the snapshot is built from the RETURNED persisted
    // row. Two concurrent edits serialize on the row lock and mint DISTINCT
    // revisions, so the map-job unique index can no longer collapse two
    // different payloads into one revision and publish stale facts. A failed
    // outbox write now rolls the edit back (all-or-nothing) instead of
    // committing fields the enrichment pipeline never hears about.
    const editingDemographics = safeUpdates.demographics !== undefined;
    const mappedStatusTransition =
      ['qualified', 'won'].includes(safeUpdates.leadStatus) && safeUpdates.leadStatus !== oldStatus;
    const adminOccurredAt = new Date().toISOString();
    const updatePayload = becomingWon ? { ...safeUpdates, conversionDate: new Date() } : safeUpdates;

    // H4: a won-transition is enforced AT MUTATION TIME — the UPDATE's WHERE
    // re-checks the assignment under the row's write lock, so a concurrent
    // unassignment that commits after our unlocked read above can never
    // produce a won-and-unassigned row. Zero affected rows = the state moved
    // under us = reject with the same 400 as the precheck.
    const applyProspectWrite = async (transaction = null) => {
      const opts = transaction ? { transaction } : {};
      if (!becomingWon) {
        await prospect.update(updatePayload, opts);
        return;
      }
      const [affected] = await m.Prospect.update(updatePayload, {
        ...opts,
        where: {
          id: prospect.id,
          [Op.or]: [
            {
              [Op.and]: [
                { assignedAgentId: { [Op.not]: null } },
                { assignedAgentId: { [Op.ne]: systemAgentId } },
              ],
            },
            { externalAgentId: { [Op.not]: null } },
          ],
        },
      });
      if (affected === 0) {
        throw new d.AppError('Lead must be assigned to a real agent before marking as won', 400);
      }
      await prospect.reload(opts);
    };

    // ONE managed transaction for the edits that must be atomic with their
    // side-writes: demographics (enrichment outbox, H3), phone changes
    // (verification-stamp strip), and mapped status transitions (durable
    // outcome facts — plan google-ads-signal-levers §4.3). Inside it the row
    // is LOCK-RELOADED and the erased flag RE-CHECKED: the pre-transaction
    // check above races a concurrent erasure, and a stale phone edit must
    // never re-attach a number to a freshly scrubbed row (410, same as the
    // pre-check).
    const needsTxn = editingDemographics || phoneChanged || mappedStatusTransition;
    try {
      if (needsTxn) {
        await d.sequelize.transaction(async (t) => {
          // Lock via a fresh minimal fetch — reloading `prospect` would carry
          // its eager assignedAgent include, and FOR UPDATE cannot lock the
          // nullable side of an outer join.
          const locked = await m.Prospect.findByPk(prospect.id, {
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
          if (!locked) {
            throw new d.AppError('Prospect not found or access denied', 404);
          }
          if (locked.sourceMetadata?.erased === true) {
            throw new d.AppError('This lead was erased (PDPA) and can no longer be edited', 410);
          }
          await applyProspectWrite(t);
          if (strippingVerification) {
            await d.removeSourceMetadataPaths(
              prospect.id,
              [['phoneVerifiedAt'], ['phoneVerifiedFor']],
              { transaction: t }
            );
          }
          if (mappedStatusTransition) {
            // Durable outcome facts land IN the status transaction (write-once,
            // first-wins; a `won` records both keys with one timestamp) — the
            // worker re-sends from these, so a crash after commit can never
            // lose the outcome (plan §4.3).
            const factKeys = d.eventKeysForStatus(safeUpdates.leadStatus);
            if (factKeys.length) {
              await d.mergeSourceMetadataFirstWins(
                prospect.id,
                ['outcomes'],
                Object.fromEntries(factKeys.map((k) => [k, adminOccurredAt])),
                { transaction: t }
              );
            }
          }
          if (!editingDemographics) return;
          const [rows] = await d.sequelize.query(
            `UPDATE prospects
                SET "enrichmentRevision" = COALESCE("enrichmentRevision", 1) + 1
              WHERE id = :id
              RETURNING "enrichmentRevision", "demographics"`,
            { replacements: { id: prospect.id }, transaction: t }
          );
          const row = rows?.[0];
          if (!row) throw new d.AppError('Prospect not found or access denied', 404);
          prospect.enrichmentRevision = row.enrichmentRevision;
          // FORM section only: quiz/profile artifacts are capture-immutable —
          // absent sections mean "leave those artifacts alone" (§5.1). Cleared
          // demographics still supersede (zero-fact snapshots at revision > 1).
          const snapshot = d.buildFactSnapshot({
            demographics: row.demographics || {},
          });
          await d.enqueueMapJobsTx(t, {
            prospectId: prospect.id,
            formRevision: row.enrichmentRevision,
            snapshot,
          });
        });
      } else {
        await applyProspectWrite();
      }
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        // (campaignId, phone) partial unique — the edited number already has a
        // signup in this campaign.
        throw new d.AppError('Another lead in this campaign already has this phone number.', 409);
      }
      throw err;
    }
    if (editingDemographics) d.drainMapJobs({ limit: 2 }).catch(() => {});

    // Consumer-spine projection upkeep: recompute BOTH phones' consumers from
    // rows (assign, never adjust) — this also relinks this row's consumerId.
    // Best-effort by design; the reconciler heals any miss.
    if ((phoneChanged || emailChanged) && prospect.leadSource !== 'call_bot') {
      await d.recomputeConsumersByPhone([oldPhone, prospect.phone].filter(Boolean));
      await prospect.reload().catch(() => {});
    }

    // Enrichment choke points (docs/plans/consumer-profile-enrichment.md §5,
    // §6.3). (a) demographics — handled ABOVE inside the edit transaction (H3).
    // (b) prospect lifecycle fields feed the score/DTO — bump the owner's
    //     input version so the profile goes dirty (no observation write here).
    if (safeUpdates.leadStatus !== undefined && safeUpdates.leadStatus !== oldStatus && prospect.consumerId) {
      try {
        await d.sequelize.transaction(async (t) => {
          await d.bumpEnrichmentInputTx(t, prospect.consumerId);
        });
      } catch (enrichErr) {
        d.logger.warn('[enrichment] leadStatus input bump failed', {
          error: enrichErr?.message || String(enrichErr),
        });
      }
    }

    // (Reassignment / unassignment is handled exclusively by assignProspect — see the
    // PROSPECT_UPDATE_FIELDS note — so PUT no longer needs unassignment side-effects.)

    // Down-funnel CAPI for admin-recorded outcomes (plan Phase 3): qualified
    // and won set in the mktr CRM fire the SAME processLeadOutcome the Lyfe +
    // mktr-leads webhooks use — post-commit, fire-and-forget. Its
    // mark-on-success markers dedup across all three paths, and a repeat
    // transition never re-enters (oldStatus is already terminal).
    if (['qualified', 'won'].includes(safeUpdates.leadStatus) && oldStatus !== safeUpdates.leadStatus) {
      try {
        const hook = d.processLeadOutcome({
          external_id: prospect.id,
          new_status: safeUpdates.leadStatus,
          occurred_at: adminOccurredAt,
        });
        if (hook && typeof hook.catch === 'function') {
          hook.catch((err) =>
            d.logger.error('[CAPI] admin lead-outcome hook error', { error: err?.message || String(err) })
          );
        }
      } catch (err) {
        d.logger.error('[CAPI] admin lead-outcome hook error', { error: err?.message || String(err) });
      }
    }

    return prospect;
  }

  /**
   * Delete a prospect, scoped to user access.
   */
  async function deleteProspect(id, user) {
    const scopeFilter = await d.buildProspectWhere(user);

    // Fire lead.deleted to the mktr-leads mirror so the deletion propagates (the
    // receiver soft-deletes its copy; otherwise the lead is orphaned on the
    // agent's page). Transactional outbox: persist the delivery row INSIDE the
    // same (managed) txn as the destroy so they commit together — no crash window
    // that re-creates the orphan. The prospect is row-locked for the txn so a
    // concurrent reassignment can't shift the destination under us. The managed
    // txn auto-commits on resolve / auto-rolls-back (and rethrows) on a throw, so
    // a hard error => delete fails + admin retries, with NO orphan/partial state.
    let deliveryPairs = [];
    let deletedPhone = null;
    let deletedSource = null;
    await d.sequelize.transaction(async (t) => {
      const prospect = await m.Prospect.findOne({
        where: { id, ...scopeFilter },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!prospect) {
        throw new d.AppError('Prospect not found or access denied', 404);
      }
      deletedPhone = prospect.phone;
      deletedSource = prospect.leadSource;

      // Only the mktr-leads receiver handles lead.deleted. Held / unassigned /
      // System-Agent (no assignee) or a non-mktr_leads destination => no mirrored
      // row to clean => skip the emit.
      let destination = null;
      if (prospect.assignedAgentId) {
        const agent = await m.User.findByPk(prospect.assignedAgentId, {
          attributes: ['id', 'lyfeId', 'mktrLeadsId'],
          transaction: t,
        });
        destination = destinationForAgent(agent);
      }

      // Live reward passes die WITH their prospect (PR-2, Codex R1 CX13): the
      // SET-NULL FK alone left orphaned, still-scannable passes holding the
      // phone's anti-farm slot and never returning inventory. Same tx as the
      // destroy — all-or-nothing.
      await d.cancelLiveEntitlementsForProspectTx(prospect.id, t, { reason: 'prospect_deleted' });

      if (destination === 'mktr_leads') {
        deliveryPairs = await d.persistEventDeliveries(
          'lead.deleted',
          () => buildLeadDeletedPayload(prospect),
          { destination },
          t
        );
        // BEST-EFFORT (unlike releaseHeldProspect's fail-closed rollback): an empty
        // set means webhooks are disabled or no subscriber is tagged. Deleting is an
        // admin cleanup action that must NOT be blocked on mirror delivery — proceed.
        if (deliveryPairs.length === 0) {
          d.logger.warn('[Webhook] lead.deleted not queued (webhooks off / no subscriber) — deleting anyway', {
            prospectId: prospect.id,
          });
        }
      }

      // Enrichment: a deleted signup CASCADE-deletes its observations, which
      // changes the owner's resolved facts — dirty their profile in the same
      // txn (plan §6.3 choke list; erased consumers are skipped by the bump).
      if (prospect.consumerId) {
        await d.bumpEnrichmentInputTx(t, prospect.consumerId);
      }
      await prospect.destroy({ transaction: t });
    });

    d.flushDeliveries(deliveryPairs); // post-commit, fire-and-forget

    // Consumer-spine projection upkeep (assign-from-rows; best-effort — the
    // reconciler heals). call_bot rows never linked, so nothing to recompute.
    if (deletedPhone && deletedSource !== 'call_bot') {
      await d.recomputeConsumersByPhone([deletedPhone]);
    }
  }

  /**
   * Schedule a follow-up for a prospect.
   */
  async function scheduleFollowUp(id, { nextFollowUpDate, notes }, user) {
    if (!nextFollowUpDate) {
      throw new d.AppError('Next follow-up date is required', 400);
    }

    const scopeWhere = await d.buildProspectWhere(user);
    const prospect = await m.Prospect.findOne({ where: { id, ...scopeWhere } });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    const updateData = {
      nextFollowUpDate: new Date(nextFollowUpDate),
      lastContactDate: new Date(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    const previous = prospect.toJSON();
    await prospect.update(updateData);

    await m.ProspectActivity.create({
      prospectId: prospect.id,
      type: 'updated',
      actorUserId: user?.id || null,
      description: `Prospect updated by ${user?.role || 'system'}`,
      metadata: { before: previous, after: prospect.toJSON() },
    });

    return prospect;
  }

  /**
   * Bulk delete prospects (web admin). Fan-out over the hardened single delete — each row
   * keeps its transactional-outbox lead.deleted (mktr-leads-owned rows only; a Lyfe-owned
   * row's app copy is orphaned, the same documented limitation as single delete). One bad
   * row never aborts the rest.
   */
  async function bulkDeleteProspects(prospectIds, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || prospectIds.length === 0) {
      throw new d.AppError('Prospect IDs array is required', 400);
    }
    const requestedIds = [...new Set(prospectIds)];

    const counts = { deleted: 0, notFound: 0, failed: 0 };
    for (const id of requestedIds) {
      try {
        await deleteProspect(id, user);
        counts.deleted += 1;
      } catch (err) {
        if (err?.statusCode === 404) {
          counts.notFound += 1;
        } else {
          counts.failed += 1;
          d.logger.error('[bulk-delete] delete failed', { prospectId: id, error: err?.message || String(err) });
        }
      }
    }
    return counts;
  }

  return { updateProspect, deleteProspect, scheduleFollowUp, bulkDeleteProspects };
}
