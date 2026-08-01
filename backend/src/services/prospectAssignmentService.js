/**
 * Assignment lifecycle (P4-3 seam 3): single + bulk admin assignment —
 * charging, webhook dispatch, held-release fencing. Same DI shape as the
 * parent factory.
 */
import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import { SCREENING_REASONS } from './screeningConstants.js';
import { destinationForAgent, externalIdForDestination, buildLeadAssignedPayload, buildLeadUnassignedPayload, withBatchContext } from './prospectHelpers.js';
import { RELEASABLE_HOLD_REASONS } from './prospectShared.js';

export function makeAssignmentOps({ d, m }) {
  /**
   * Assign a single prospect to an agent. Returns { prospect, agent } for email side-effect.
   * `opts.batch` ({ id, size }, pre-validated) rides into the delivery webhooks so the
   * receiving app can coalesce a bulk fan-out's pushes into one summary.
   */
  async function assignProspect(prospectId, agentId, user, opts = {}) {
    const { batch = null } = opts;
    const prospect = await m.Prospect.findByPk(prospectId);
    if (!prospect) {
      throw new d.AppError('Prospect not found', 404);
    }

    const previousAgentId = prospect.assignedAgentId;

    // ── Unassign ──
    if (!agentId) {
      await prospect.update({ assignedAgentId: null });

      await m.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'assigned',
        actorUserId: user?.id || null,
        description: 'Unassigned from agent',
        metadata: { previousAgentId },
      });

      // Fire lead.unassigned webhook — but NOT for a HELD (quarantined) lead: Lyfe never
      // received a lead.created for it (the create webhook was suppressed), so an
      // unassigned event would reference a lead Lyfe does not know about.
      if (!prospect.quarantinedAt) {
        // Destination + external id come from the PREVIOUS agent (the assignment
        // is already null). Sourceless previous agent -> null -> default-denied.
        let prevDestination = null;
        let previousAgentExternalId = null;
        if (previousAgentId) {
          const prevAgent = await m.User.findByPk(previousAgentId, {
            attributes: ['id', 'lyfeId', 'mktrLeadsId'],
          });
          prevDestination = destinationForAgent(prevAgent);
          previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);
        }
        d.dispatchEvent('lead.unassigned', () => buildLeadUnassignedPayload(prospect, previousAgentExternalId), {
          destination: prevDestination,
        });
      }

      return { prospect, agent: null, prospectWithCampaign: prospect };
    }

    // ── Assign ──
    const agent = await m.User.findOne({
      where: { id: agentId, role: 'agent', isActive: true },
    });

    if (!agent) {
      throw new d.AppError('Invalid or inactive agent', 400);
    }

    // An external hold (no funded MKTR Leads buyer) must NEVER be manually released to an
    // internal agent / Lyfe — it was captured for the external buyer pool and can only be
    // delivered via the external channel (or a dedicated conversion flow, not built yet).
    // The auto release-sweep is already fenced off these holds; close the manual path too.
    if (prospect.quarantineReason === 'no_funded_external_buyer') {
      throw new d.AppError(
        'This lead is held for the MKTR Leads (external) buyer pool and cannot be manually assigned to an internal agent.',
        409
      );
    }

    // DNC fence: a lead held by the DNC gate must NOT be manually released (that would
    // bypass scrubbing and hand a Do-Not-Call number to an adviser). It releases itself
    // automatically once the DNC check clears (gate / backfill). assignProspect's claim
    // below is reason-blind, so this guard is the fence.
    if (prospect.quarantineReason === 'dnc_pending' || prospect.quarantineReason === 'dnc_registered') {
      throw new d.AppError(
        'This lead is held by the DNC (Do Not Call) gate and cannot be manually assigned — it releases automatically once the DNC check clears.',
        409
      );
    }

    // A manual admin assign is an EXEMPT route (decision a): it always delivers and does
    // a best-effort deduct. If the prospect is currently HELD, this is a RELEASE — clear
    // the hold ATOMICALLY (so a double-click / concurrent sweep can't deliver twice) and
    // fire lead.assigned. Always lead.assigned, never lead.created: both receivers UPSERT
    // on assigned (insert if unknown, re-point + un-hide if known), whereas a duplicate
    // lead.created is a silent no-op — so a returned-to-held lead released via
    // lead.created would never re-surface in the agent's app.
    if (prospect.quarantinedAt) {
      // Screening override bookkeeping (plan §9.5) — captured BEFORE the claim
      // clears quarantineReason. A capture-charged, un-refunded screening lead
      // must not be deducted AGAIN on release (Codex #2); a refunded one
      // (screening_failed override) deducts normally like any release.
      const screeningOverride = SCREENING_REASONS.includes(prospect.quarantineReason);
      const screeningCaptureCharged =
        screeningOverride &&
        prospect.screeningMetadata?.alreadyCharged === true &&
        prospect.screeningMetadata?.chargeRefunded !== true;

      // Release + delivery intent are ONE transaction (transactional outbox —
      // the same contract as releaseHeldProspect / returnProspectToHeld):
      // either the hold clears AND the pending delivery rows exist, or
      // neither. A crash between the state flip and the dispatch can no
      // longer strand a released-but-never-queued lead; if the process dies
      // after commit but before the flush, recoverPendingRetries() sends the
      // committed rows.
      const releaseDestination = destinationForAgent(agent);
      const t = await d.sequelize.transaction();
      let released = false;
      let prospectWithCampaign = null;
      let deliveryPairs = [];
      try {
        const [releaseRows] = await d.sequelize.query(
          `UPDATE prospects
              SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
                  "quarantinedAt" = NULL, "quarantineReason" = NULL, "updatedAt" = NOW()
            WHERE id = :prospectId AND "quarantinedAt" IS NOT NULL
            RETURNING id`,
          { replacements: { agentId, prospectId: prospect.id }, transaction: t }
        );
        released = Array.isArray(releaseRows) && releaseRows.length > 0;

        if (released) {
          await prospect.reload({ transaction: t });

          await m.ProspectActivity.create({
            prospectId: prospect.id,
            type: 'assigned',
            actorUserId: user?.id || null,
            description: `Released from hold and assigned to ${agent.firstName} ${agent.lastName}`.trim(),
            metadata: {
              assignedAgentId: agentId,
              previousAgentId,
              released: true,
              ...(screeningOverride ? { screeningOverride: true } : {}),
            },
          }, { transaction: t });

          prospectWithCampaign = await m.Prospect.findByPk(prospect.id, {
            include: [
              { association: 'campaign', attributes: ['id', 'name'] },
              { association: 'qrTag', attributes: ['id', 'slug'] },
            ],
            transaction: t,
          });

          deliveryPairs = await d.persistEventDeliveries(
            'lead.assigned',
            () =>
              withBatchContext(
                buildLeadAssignedPayload(prospect, agent, prospectWithCampaign, {
                  qrTag: prospectWithCampaign?.qrTag || null,
                  routingMode: 'direct',
                }),
                batch
              ),
            { destination: releaseDestination },
            t
          );
          // Fail closed (mirrors releaseHeldProspect and the bulk pre-flight):
          // never release a held lead into a destinationed app we cannot
          // durably deliver to — roll back so it stays held and visible
          // instead of vanishing. A destination-less (local-only) agent
          // expects no delivery and passes.
          if (releaseDestination && deliveryPairs.length === 0) {
            await t.rollback();
            await prospect.reload();
            throw new d.AppError(
              "Lead delivery is not configured for this agent's app (webhooks disabled or no subscriber) — releasing this held lead would strand it. Fix webhook configuration and retry.",
              409
            );
          }
        }

        await t.commit();
      } catch (err) {
        if (!t.finished) await t.rollback().catch(() => {});
        throw err;
      }

      if (!released) {
        // Lost the race — already released elsewhere. Do not double-deliver, and return
        // agent:null so the controller does not email an agent about a lead a concurrent
        // release/sweep already assigned (possibly to a different agent).
        await prospect.reload();
        return { prospect, agent: null, prospectWithCampaign: prospect };
      }

      // Post-commit side-effects — never block or roll back the durable release.
      if (!screeningCaptureCharged) {
        await d
          .deductLeadCredit({ agentId, campaignId: prospect.campaignId || null })
          .catch((err) => d.logger.error('Failed to deduct credit', { error: err?.message || String(err) }));
      }
      d.flushDeliveries(deliveryPairs);

      return { prospect, agent, prospectWithCampaign };
    }

    // ── Normal reassign (not held) ──
    await prospect.update({
      assignedAgentId: agentId,
      lastContactDate: new Date(),
    });

    await m.ProspectActivity.create({
      prospectId: prospect.id,
      type: 'assigned',
      actorUserId: user?.id || null,
      description: `Assigned to agent ${agent.firstName} ${agent.lastName}`.trim(),
      metadata: { assignedAgentId: agentId, previousAgentId },
    });

    await d
      .deductLeadCredit({ agentId, campaignId: prospect.campaignId || null })
      .catch((err) => d.logger.error('Failed to deduct credit', { error: err?.message || String(err) }));

    const prospectWithCampaign = await m.Prospect.findByPk(prospect.id, {
      include: [
        { association: 'campaign', attributes: ['id', 'name'] },
        { association: 'qrTag', attributes: ['id', 'slug'] },
      ],
    });

    // Fire lead.assigned webhook to the NEW owner's app.
    const newDestination = destinationForAgent(agent);
    d.dispatchEvent(
      'lead.assigned',
      () =>
        withBatchContext(
          buildLeadAssignedPayload(prospect, agent, prospectWithCampaign, {
            qrTag: prospectWithCampaign?.qrTag || null,
            routingMode: 'direct',
          }),
          batch
        ),
      { destination: newDestination }
    );

    // Cross-app reassignment: if the PREVIOUS owner lived in a different app, that app
    // still holds a copy of this lead that would otherwise linger. Tell it to release the
    // lead (lead.unassigned -> the receiver marks it disputed). A SAME-app reassignment
    // needs nothing extra — the receiver re-points the single shared row when it handles
    // lead.assigned, so firing unassigned there would wrongly dispute the now-reassigned row.
    if (previousAgentId && previousAgentId !== agentId) {
      const prevAgent = await m.User.findByPk(previousAgentId, {
        attributes: ['id', 'lyfeId', 'mktrLeadsId'],
      });
      const prevDestination = destinationForAgent(prevAgent);
      if (prevDestination && prevDestination !== newDestination) {
        const previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);
        d.dispatchEvent('lead.unassigned', () => buildLeadUnassignedPayload(prospect, previousAgentExternalId), {
          destination: prevDestination,
        });
      }
    }

    return { prospect, agent, prospectWithCampaign };
  }
  /**
   * Bulk assign prospects to an agent. Returns { affectedCount, releasedCount, skipped, agent }
   * — counts feed the controller's email side-effect and the UI's skip-accounting toast.
   */
  async function bulkAssignProspects(prospectIds, agentId, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || !agentId) {
      throw new d.AppError('Prospect IDs array and agent ID are required', 400);
    }
    const requestedIds = [...new Set(prospectIds)];

    const agent = await m.User.findOne({
      where: {
        id: agentId,
        role: 'agent',
        isActive: true,
      },
    });

    if (!agent) {
      throw new d.AppError('Invalid or inactive agent', 400);
    }

    // Pre-flight (bulk-only): assignment mutates rows first and delivers after, so refuse
    // to run when delivery is IMPOSSIBLE (webhooks disabled / no subscriber tagged for the
    // agent's app) — otherwise the whole batch would be stranded: assigned in MKTR, never
    // surfaced in the agent's app. Transient send failures are fine (the persistent
    // delivery queue retries); this guards misconfiguration only. A destination-less
    // (local-only) agent passes: no delivery is expected, matching single-assign.
    const newDestination = destinationForAgent(agent);
    if (!(await d.hasDeliverableSubscriber('lead.assigned', newDestination))) {
      throw new d.AppError(
        "Lead delivery is not configured for this agent's app (webhooks disabled or no subscriber) — bulk assign would strand the leads. Fix webhook configuration and retry.",
        409
      );
    }

    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = {
      id: { [Op.in]: requestedIds },
      ...scopeFilter,
      [Op.and]: [
        // HELD rows are eligible only for the releasable reasons — bulk assign then acts
        // as a RELEASE (the quarantine is cleared in the same atomic UPDATE below, and
        // lead.assigned upserts at the receiver). Fenced reasons (external buyer pool,
        // DNC gate) stay excluded, mirroring single-assign's guards.
        { [Op.or]: [{ quarantinedAt: null }, { quarantineReason: { [Op.in]: RELEASABLE_HOLD_REASONS } }] },
        // Skip rows already assigned to THIS agent (IS DISTINCT FROM semantics —
        // a bare Op.ne would also exclude unassigned NULL rows). Re-assigning a
        // no-op row used to double-charge the agent for a lead they already held.
        { [Op.or]: [{ assignedAgentId: null }, { assignedAgentId: { [Op.ne]: agentId } }] },
        // External-buyer-owned rows are fenced: assignedAgentId and
        // externalAgentId are mutually exclusive owners, and writing the
        // internal FK without clearing the external one would double-own the
        // lead. Transfers from the external pool are not a bulk operation.
        { externalAgentId: null },
      ],
    };

    // Lock the candidate rows and update them inside ONE transaction so the webhook side
    // sees a consistent picture: a concurrent (re)assignment of the same lead cannot slip
    // between our read and our write (which would otherwise mis-attribute or skip a
    // cross-app release and leave the other app holding an active copy). RETURNING stays the
    // source of truth for WHICH rows changed, so per-campaign credit counting is exact. We
    // lock WITHOUT the campaign include — FOR UPDATE cannot be applied to the nullable side
    // of an outer join — and fetch campaign data for the payloads inside the same
    // transaction: the delivery rows are persisted IN-transaction too (transactional
    // outbox, same contract as releaseHeldProspect), so the state flip and the delivery
    // intent commit or roll back together — a crash after commit can no longer strand
    // the batch (recoverPendingRetries flushes committed rows), and a crash before it
    // leaves every lead exactly where it was.
    let result = [0, []];
    const lockedById = new Map();
    let requestedRows = [];
    let deliveryPairs = [];
    let full = [];
    let batch = null;
    await d.sequelize.transaction(async (transaction) => {
      const locked = await m.Prospect.findAll({
        where: whereConditions,
        // quarantineReason + screeningMetadata ride along so the deduct below
        // can skip capture-charged screening releases (double-charge guard §9.5).
        attributes: ['id', 'assignedAgentId', 'campaignId', 'quarantinedAt', 'quarantineReason', 'screeningMetadata'],
        transaction,
        lock: true,
      });
      for (const row of locked) lockedById.set(row.id, row);
      result = await m.Prospect.update(
        // Release + assign is ONE atomic write: clearing the hold here means a concurrent
        // release (external dispatch / double-submit) blocks on the row lock, re-reads
        // quarantinedAt IS NULL, and matches nothing — never a second delivery.
        { assignedAgentId: agentId, lastContactDate: new Date(), quarantinedAt: null, quarantineReason: null },
        // Update exactly the locked set; RETURNING reports the rows actually changed.
        { where: { id: { [Op.in]: [...lockedById.keys()] } }, returning: ['id', 'campaignId'], transaction }
      );
      // Snapshot every requested (in-scope) row for skip classification, same txn so the
      // classification matches what the locked UPDATE saw.
      requestedRows = await m.Prospect.findAll({
        where: { id: { [Op.in]: requestedIds }, ...scopeFilter },
        attributes: ['id', 'assignedAgentId', 'externalAgentId', 'quarantinedAt', 'quarantineReason'],
        transaction,
      });

      // Persist the delivery intent for every newly-assigned lead (bulk-assign previously
      // fired NO webhook at all, then fired fire-and-forget AFTER the commit — either way
      // a crash stranded the batch). Mirror the single-assign path: lead.assigned to the
      // new owner, plus — for a CROSS-app reassignment — lead.unassigned to the previous
      // owner so its copy in the other app doesn't linger. One batch context for the whole
      // fan-out: the mktr-leads receiver coalesces the N per-lead pushes into a single
      // "{size} leads assigned to you" summary (Lyfe ignores batch for now).
      const affectedNow = result[0];
      const rowsNow = result[1] || [];
      if (affectedNow > 0) {
        batch = affectedNow > 1 ? { id: randomUUID(), size: affectedNow } : null;
        const affectedIds = rowsNow.map((row) => row.id);
        full = await m.Prospect.findAll({
          where: { id: { [Op.in]: affectedIds } },
          include: [
            { association: 'campaign', attributes: ['id', 'name'] },
            { association: 'qrTag', attributes: ['id', 'slug'] },
          ],
          transaction,
        });

        const prevOwnerIds = [
          ...new Set(
            affectedIds
              .map((id) => lockedById.get(id)?.assignedAgentId)
              .filter((prevId) => prevId && prevId !== agentId)
          ),
        ];
        const prevAgentById = new Map();
        if (prevOwnerIds.length > 0) {
          const prevAgents = await m.User.findAll({
            where: { id: { [Op.in]: prevOwnerIds } },
            attributes: ['id', 'lyfeId', 'mktrLeadsId'],
            transaction,
          });
          for (const a of prevAgents) prevAgentById.set(a.id, a);
        }

        for (const p of full) {
          const pairs = await d.persistEventDeliveries(
            'lead.assigned',
            () =>
              withBatchContext(
                buildLeadAssignedPayload(p, agent, p, { qrTag: p.qrTag || null, routingMode: 'direct' }),
                batch
              ),
            { destination: newDestination },
            transaction
          );
          // Fail closed: the pre-flight above vouched a subscriber existed; if it
          // vanished mid-flight (disabled between the check and this write), roll the
          // whole batch back — assigned-in-MKTR-but-never-surfaced is the exact state
          // this outbox exists to prevent. Destination-less agents expect no delivery.
          if (newDestination && pairs.length === 0) {
            throw new d.AppError(
              "Lead delivery is not configured for this agent's app (webhooks disabled or no subscriber) — bulk assign would strand the leads. Fix webhook configuration and retry.",
              409
            );
          }
          deliveryPairs.push(...pairs);

          const prevId = lockedById.get(p.id)?.assignedAgentId;
          const prevAgent = prevId && prevId !== agentId ? prevAgentById.get(prevId) : null;
          if (prevAgent) {
            const prevDestination = destinationForAgent(prevAgent);
            if (prevDestination && prevDestination !== newDestination) {
              const previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);
              const unPairs = await d.persistEventDeliveries(
                'lead.unassigned',
                () => buildLeadUnassignedPayload(p, previousAgentExternalId),
                { destination: prevDestination },
                transaction
              );
              deliveryPairs.push(...unPairs);
            }
          }
        }
      }
    });

    const affectedCount = result[0];
    const affectedRows = result[1] || [];

    // Skip accounting for the UI toast: classify every requested id that did NOT change.
    // (Post-UPDATE snapshot: affected rows are classified off the pre-UPDATE lock set.)
    const requestedById = new Map(requestedRows.map((r) => [r.id, r]));
    const skipped = { notFound: 0, alreadyAssigned: 0, heldFenced: 0, externalOwned: 0 };
    let releasedCount = 0;
    for (const id of requestedIds) {
      if (lockedById.has(id)) {
        if (lockedById.get(id).quarantinedAt) releasedCount += 1;
        continue;
      }
      const row = requestedById.get(id);
      if (!row) skipped.notFound += 1;
      else if (row.externalAgentId) skipped.externalOwned += 1;
      else if (row.quarantinedAt && !RELEASABLE_HOLD_REASONS.includes(row.quarantineReason)) skipped.heldFenced += 1;
      else skipped.alreadyAssigned += 1;
    }
    if (affectedCount > 0) {
      const countsByCampaign = new Map();
      for (const row of affectedRows) {
        // Capture-charged, un-refunded screening leads already paid at capture
        // — releasing them must not deduct a second credit (Codex #2).
        const pre = lockedById.get(row.id);
        const screeningCaptureCharged =
          pre &&
          SCREENING_REASONS.includes(pre.quarantineReason) &&
          pre.screeningMetadata?.alreadyCharged === true &&
          pre.screeningMetadata?.chargeRefunded !== true;
        if (screeningCaptureCharged) continue;
        const cId = row.campaignId || null;
        countsByCampaign.set(cId, (countsByCampaign.get(cId) || 0) + 1);
      }
      for (const [cId, count] of countsByCampaign) {
        await d
          .deductLeadCredit({ agentId, campaignId: cId, amount: count })
          .catch((err) => d.logger.error('Failed to deduct credits', { error: err?.message || String(err) }));
      }

      // The delivery rows committed with the assignment — send them now.
      d.flushDeliveries(deliveryPairs);

      // Log a ProspectActivity per newly-assigned lead so BULK assignment lands on the unified
      // timeline too — single-assign already logs (assignProspect), this path historically wrote
      // none, so bulk-assigned leads were missing their "assigned" event. Best-effort (post-commit,
      // like the credit deduction above) — never fail the assignment over an audit-row write.
      await m.ProspectActivity.bulkCreate(
        full.map((p) => {
          const lockedRow = lockedById.get(p.id);
          const prevId = lockedRow?.assignedAgentId;
          return {
            prospectId: p.id,
            type: 'assigned',
            actorUserId: user?.id || null,
            description: `Assigned to ${agent.firstName} ${agent.lastName}`.trim(),
            // Flag a reassignment (a prior owner existed) as a BOOLEAN so the timeline renders
            // 'reassigned' — never expose who held it before. `released` marks a row that was
            // HELD when the bulk assign claimed it (audit parity with single-release).
            metadata: {
              assignedAgentId: agent.id,
              via: 'bulk_assign',
              ...(prevId && prevId !== agentId ? { reassigned: true } : {}),
              ...(lockedRow?.quarantinedAt ? { released: true } : {}),
            },
          };
        })
      ).catch((err) => d.logger.error('Failed to log bulk-assign activity', { error: err?.message || String(err) }));
    }

    return { affectedCount, releasedCount, skipped, agent };
  }

  return { assignProspect, bulkAssignProspects };
}
