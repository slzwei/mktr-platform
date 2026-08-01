/**
 * Held-queue / orphan operations (P4-3 seam 2): the external + web-admin
 * held-lead lifecycle — list, release, external reassign, return-to-held.
 * Receives the parent factory's (d, m), the shared idempotency ops, and
 * assignProspect (the one cross-seam dependency: external reassign delegates
 * to the assignment lifecycle).
 */
import { Op } from 'sequelize';
import { destinationForAgent, externalIdForDestination, buildLeadAssignedPayload, buildLeadUnassignedPayload, buildHeldLeadEnrichment, withBatchContext } from './prospectHelpers.js';
import { signupSourceLabel } from '../utils/sourceLabel.js';

export function makeHeldQueueOps({ d, m, idem, assignProspect }) {
  // The System-Agent routing fallback is only a true orphan marker when it has NO delivery
  // destination (no lyfeId / mktrLeadsId) — its leads were never delivered anywhere. If
  // DEFAULT_AGENT_ID ever points at a REAL fallback agent (whose leads DO get delivered),
  // this returns null so those leads can never be mistaken for orphans (Codex B/P1).
  async function orphanSystemAgentId() {
    const id = await d.getSystemAgentId();
    if (!id) return null;
    const u = await m.User.findByPk(id, { attributes: ['id', 'lyfeId', 'mktrLeadsId'] });
    return u && !u.lyfeId && !u.mktrLeadsId ? id : null;
  }
  /**
   * Fleet-wide list of dispatchable ORPHANS for the external admin queue: no_funded_agent
   * HOLDS *and* leads parked on the phantom System Agent (the soft-campaign fallback,
   * which has no phone so they were never delivered). Each row is tagged with `reason`
   * ('no_funded_agent' | 'unassigned') and a `since` timestamp.
   */
  async function listDispatchableOrphans({ campaignId = null, limit } = {}) {
    const systemAgentId = await orphanSystemAgentId();
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const orphanClauses = [{ quarantinedAt: { [Op.ne]: null }, quarantineReason: 'no_funded_agent' }];
    if (systemAgentId) orphanClauses.push({ assignedAgentId: systemAgentId, quarantinedAt: null });
    const where = { [Op.or]: orphanClauses };
    if (campaignId) where.campaignId = campaignId;

    const { count, rows } = await m.Prospect.findAndCountAll({
      where,
      attributes: { exclude: ['screeningMetadata'] },
      include: [
        { association: 'campaign', attributes: ['id', 'name'] },
        // qrTag drives the "QR code" source label for a bound-QR lead whose leadSource isn't
        // 'qr_code'. Select only REAL columns — QrTag has `slug` but NO `externalId` (that field
        // exists on the webhook payload's qrTag, not the model), so signupSourceLabel keys off slug.
        { association: 'qrTag', attributes: ['id', 'slug'] },
      ],
      order: [['createdAt', 'ASC']], // FIFO by signup (held + unassigned interleaved)
      limit: lim,
    });

    const orphans = rows.map((p) => {
      // Full personal / firmographic data the admin detail view shows (DOB, postal,
      // company, …) — parity with a delivered lead, plus the demographics it drops.
      const { birthday, details } = buildHeldLeadEnrichment(p);
      return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        email: p.email,
        leadSource: p.leadSource,
        // Rich, delivered-lead-equivalent label ("Instagram ad", "Meta ad", "Web form", …)
        // derived from sourceMetadata.utm — so the held queue reads the same source the lead
        // will show once assigned, not the coarse capture channel.
        sourceLabel: signupSourceLabel({ leadSource: p.leadSource, qrTag: p.qrTag, sourceMetadata: p.sourceMetadata }),
        // Raw DOB string — the buyer app formats it to DD/MM/YYYY (one formatter, app-side).
        birthday,
        // Ordered, display-ready [{ label, value }] enrichment rows (no PII beyond what the
        // admin-only detail view already shows; never enters the non-PII summary projection).
        details,
        campaignId: p.campaignId,
        campaignName: p.campaign?.name || null,
        reason: p.quarantinedAt ? 'no_funded_agent' : 'unassigned',
        since: p.quarantinedAt || p.createdAt,
        createdAt: p.createdAt,
      };
    });

    return { count, orphans };
  }
  /**
   * Assign an ORPHANED prospect (a no_funded_agent HOLD, or a lead parked on the phantom
   * System Agent fallback) to a mktr-leads agent and deliver it via a fresh `lead.assigned`
   * — the lead is new to the destination app, so the receiver INSERTs it from that payload
   * AND records an explicit "assigned @ now" activity in the lead's timeline.
   *
   * The held-only counterpart to assignProspect, purpose-built for the external
   * mktr-leads admin dispatch endpoint. Unlike assignProspect it can NEVER fall
   * into the normal-reassignment path: a request that arrives after the lead is
   * already released returns `already_handled` (no second charge, no second
   * delivery). The release UPDATE and the `lead.assigned` delivery row are
   * written in ONE transaction (outbox), so a crash can never leave a lead
   * un-held yet undelivered (recoverPendingRetries flushes the row on restart).
   *
   * Agent identity is resolved by `mktrLeadsId` ONLY — never by phone, which can
   * resolve a Lyfe-owned or provenance-less user whose webhook destination would
   * not be mktr_leads. A manual admin assign is an explicit override: it always
   * delivers and only best-effort deducts a campaign credit (the lead was held
   * precisely because nobody was funded).
   *
   * @returns {Promise<{status:'assigned'|'already_handled'|'invalid_agent'|'not_found'|'not_assignable_external', leadId?:string, agent?:object}>}
   */
  async function releaseHeldProspect(prospectId, agentMktrLeadsId, opts = {}) {
    const { idempotencyKey = null, actorUserId = null, batch = null } = opts;
    const IDEMP_SCOPE = 'external:held-assign';

    // Replay: a retried request with the same key returns the first result verbatim.
    {
      const replay = await idem.replayIfDone(IDEMP_SCOPE, idempotencyKey);
      if (replay) return replay;
    }

    // Load the prospect FIRST so a retry after a successful release reports
    // already_handled — not invalid_agent if the chosen agent was since deactivated.
    const prospect = await m.Prospect.findByPk(prospectId);
    if (!prospect) return { status: 'not_found' };
    // External-buyer holds can never be manually released to an internal agent.
    if (prospect.quarantineReason === 'no_funded_external_buyer') {
      return { status: 'not_assignable_external' };
    }
    // An orphan = a lead with no real owner: a no_funded_agent HOLD, or one parked on
    // the phantom System Agent (the soft-campaign fallback — never delivered anywhere).
    // Anything else is a real assigned lead and must not be touched here.
    const systemAgentId = await orphanSystemAgentId();
    const isHeld = !!prospect.quarantinedAt && prospect.quarantineReason === 'no_funded_agent';
    const isUnassigned = !prospect.quarantinedAt && !!systemAgentId && prospect.assignedAgentId === systemAgentId;
    if (!isHeld && !isUnassigned) return { status: 'already_handled' };

    // Resolve the destination agent by mktrLeadsId ONLY (phone is unsafe — it can
    // resolve a Lyfe-owned / provenance-less user whose destination ≠ mktr_leads).
    const agent = agentMktrLeadsId
      ? await m.User.findOne({ where: { mktrLeadsId: agentMktrLeadsId, role: 'agent', isActive: true } })
      : null;
    if (!agent) return { status: 'invalid_agent' };

    // Atomic release + delivery intent (transactional outbox).
    const t = await d.sequelize.transaction();
    let result;
    let deliveryPairs = [];
    try {
      // Held-only conditional release: gated on the row STILL being a no_funded_agent
      // hold, so a racing duplicate or the auto sweep loses the row lock and sees
      // `quarantinedAt IS NULL` → 0 rows → already_handled (never a second delivery).
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
                "quarantinedAt" = NULL, "quarantineReason" = NULL, "updatedAt" = NOW()
          WHERE id = :prospectId AND (
            ("quarantinedAt" IS NOT NULL AND "quarantineReason" = 'no_funded_agent')
            OR ("assignedAgentId" = :systemAgentId AND "quarantinedAt" IS NULL)
          )
          RETURNING id`,
        { replacements: { agentId: agent.id, prospectId, systemAgentId }, transaction: t }
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        result = { status: 'already_handled' };
      } else {
        await m.ProspectActivity.create({
          prospectId,
          type: 'assigned',
          actorUserId,
          description: `Assigned to ${agent.firstName} ${agent.lastName} via the dispatch queue`.trim(),
          metadata: { assignedAgentId: agent.id, released: true, via: 'external_app', fromSystemAgent: isUnassigned },
        }, { transaction: t });

        const withCampaign = await m.Prospect.findByPk(prospectId, {
          include: [
            { association: 'campaign', attributes: ['id', 'name'] },
            { association: 'qrTag', attributes: ['id', 'slug'] },
          ],
          transaction: t,
        });

        // Destination is mktr_leads (agent has mktrLeadsId set); the receiver matches
        // `routing.agentExternalId` against agents.mktr_user_id. buildLeadAssignedPayload sets
        // that id via externalIdForDestination(agent,'mktr_leads') === agent.mktrLeadsId.
        const destination = destinationForAgent(agent);

        // Fire lead.assigned (NOT lead.created) so the mktr-leads receiver records an explicit
        // "assigned @ now" activity on top of "received @ signup" — the dispatched lead's timeline
        // then shows the assignment AND its time, matching the MKTR-side activity logged above.
        // The lead is brand-new to the destination app, so the receiver INSERTs it from this
        // payload (the proven lead.assigned-inserts-new path); the lead block is identical to
        // buildLeadCreatedPayload, so delivery is otherwise unchanged.
        deliveryPairs = await d.persistEventDeliveries(
          'lead.assigned',
          () =>
            withBatchContext(
              buildLeadAssignedPayload(withCampaign, agent, withCampaign, {
                qrTag: withCampaign?.qrTag || null,
                routingMode: 'direct',
              }),
              batch
            ),
          { destination },
          t
        );
        // Fail closed: NEVER release a lead we cannot durably deliver. An empty set
        // means webhooks are disabled or no subscriber is tagged for this
        // destination — roll back so the lead stays held instead of vanishing.
        if (deliveryPairs.length === 0) {
          await t.rollback();
          return { status: 'undeliverable' };
        }

        result = { status: 'assigned', leadId: prospectId, agent: { firstName: agent.firstName, lastName: agent.lastName } };
      }

      // Record idempotency atomically with the release so an exact retry replays this
      // result verbatim. A concurrent same-key duplicate loses the unique PK and rolls
      // back — harmless, since the held-only release already prevents any double effect.
      await idem.recordResult(IDEMP_SCOPE, idempotencyKey, result, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      // A concurrent request with the SAME idempotency key won the unique PK — replay
      // its recorded result instead of surfacing a 500 (the held-only release already
      // guaranteed no double effect).
      {
        const winner = await idem.replayOnUniqueRace(IDEMP_SCOPE, idempotencyKey, err);
        if (winner) return winner;
      }
      throw err;
    }

    // Post-commit side-effects — never block or roll back the durable release.
    if (result.status === 'assigned') {
      await d.deductLeadCredit({ agentId: agent.id, campaignId: prospect.campaignId || null })
        .catch((err) => d.logger.error('[releaseHeldProspect] credit deduct failed', { error: err?.message || String(err) }));
      d.flushDeliveries(deliveryPairs);
    }

    return result;
  }
  /**
   * Reassign an ASSIGNED lead to a different mktr-leads agent (admin, from the app). Wraps
   * assignProspect (which fires lead.assigned → the mktr-leads receiver re-points the single
   * shared row, so the PREVIOUS agent loses RLS access — same-app reassign fires no disputed
   * lead.unassigned). Idempotent: a retry with the same key replays; re-targeting the SAME agent
   * is a no-op (no double charge). NOT for held/orphan leads — those use releaseHeldProspect.
   *
   * @returns {Promise<{status:'reassigned'|'invalid_agent'|'not_found'|'not_assignable', leadId?:string, agent?:object}>}
   */
  async function reassignProspectExternal(prospectId, agentMktrLeadsId, opts = {}) {
    const { idempotencyKey = null, actorUserId = null, batch = null } = opts;
    const IDEMP_SCOPE = 'external:admin-reassign';

    // Claim the idempotency key FIRST (unique PK) so concurrent / retried same-key requests can
    // never both run assignProspect (which always charges + dispatches). A completed claim replays
    // its result; a still-running claim reports in_progress (the caller retries).
    {
      const claim = await idem.claimOrReplay(IDEMP_SCOPE, idempotencyKey);
      if (!claim.claimed) return claim.replay;
    }

    // Record the outcome (success OR validation failure) on the claimed key so a retry replays it.
    const record = (result) => idem.recordClaimed(IDEMP_SCOPE, idempotencyKey, result);

    // Resolve the destination by mktrLeadsId ONLY (excludes Lyfe / provenance-less users).
    const agent = agentMktrLeadsId
      ? await m.User.findOne({ where: { mktrLeadsId: agentMktrLeadsId, role: 'agent', isActive: true } })
      : null;
    if (!agent) return record({ status: 'invalid_agent' });

    const prospect = await m.Prospect.findByPk(prospectId);
    if (!prospect) return record({ status: 'not_found' });
    // Only a lead currently assigned to a real agent is reassignable here; held/orphan leads go
    // through the held queue (releaseHeldProspect) so we never double-handle them.
    if (prospect.quarantinedAt || !prospect.assignedAgentId) return record({ status: 'not_assignable' });

    // Same-app scope: the lead's CURRENT owner must be a mktr-leads agent (a Lyfe-owned lead would
    // route through the Lyfe app — out of scope, and its receiver isn't wired for this).
    const currentOwner = await m.User.findByPk(prospect.assignedAgentId, { attributes: ['id', 'lyfeId', 'mktrLeadsId'] });
    if (destinationForAgent(currentOwner) !== 'mktr_leads') return record({ status: 'not_assignable' });

    const agentBrief = { firstName: agent.firstName, lastName: agent.lastName };
    try {
      // Already with the target → no-op so a retry / re-pick never double-charges the agent.
      if (prospect.assignedAgentId !== agent.id) {
        await assignProspect(prospectId, agent.id, { id: actorUserId }, { batch });
      }
    } catch (err) {
      // assignProspect isn't transactional; record the failure so a retry replays it (no
      // re-charge) and RETURN it as a typed result — a throw surfaces as a generic 500 and
      // the caller's app would misbucket the FIRST response as a retryable transport
      // failure instead of the sticky needs-attention state the recorded replay enforces.
      d.logger.error('[external-reassign] assignProspect failed', {
        prospectId,
        error: err?.message || String(err),
      });
      return record({ status: 'error', error: 'reassign_failed' });
    }
    return record({ status: 'reassigned', leadId: prospectId, agent: agentBrief });
  }
  /**
   * Return an ASSIGNED lead to the held queue (admin pull-back). Re-holds the prospect and
   * fires lead.unassigned WITH `returnedToHeld` so the previous agent's app drops it — the
   * mktr-leads receiver SOFT-DELETES (vanishes) the lead instead of disputing it; the Lyfe
   * receiver nulls its assigned_to (the agent loses RLS visibility — same effect, flag
   * ignored). Admins keep it, and a later dispatch (lead.assigned upsert) re-surfaces it.
   * NO refund (consistent with reassign). Idempotent; fail-closed for deliverable owners
   * (never re-hold a lead we can't durably vanish).
   *
   * Two callers, two flavors:
   * - EXTERNAL (mktr-leads admin app, defaults): reason 'no_funded_agent' so the existing
   *   external held queue + releaseHeldProspect handle it; mktr-leads-owned leads only.
   * - WEB ADMIN (bulk return, opts): reason 'returned_by_admin' — deliberately invisible
   *   to the external queue/release/sweep (all filter 'no_funded_agent'), so a returned
   *   Lyfe-owned lead can never leak to the external buyer pool. `anyDestination` admits
   *   Lyfe-owned and no-destination owners (System Agent — nothing was ever delivered, so
   *   the vanish is skipped and fail-closed does not apply). `promoteUnassigned` folds
   *   already-unassigned strays into the held pool (no webhook — nothing to vanish).
   *
   * @returns {Promise<{status:'returned'|'promoted'|'already_handled'|'not_assignable'|'not_found'|'undeliverable', leadId?:string}>}
   */
  async function returnProspectToHeld(prospectId, opts = {}) {
    const {
      idempotencyKey = null,
      actorUserId = null,
      reason = 'no_funded_agent',
      via = 'external_app',
      anyDestination = false,
      promoteUnassigned = false,
      scopeWhere = null,
    } = opts;
    const IDEMP_SCOPE = 'external:admin-return-held';

    {
      const replay = await idem.replayIfDone(IDEMP_SCOPE, idempotencyKey);
      if (replay) return replay;
    }

    const prospect = await m.Prospect.findOne({ where: { id: prospectId, ...(scopeWhere || {}) } });
    if (!prospect) return { status: 'not_found' };
    const previousAgentId = prospect.assignedAgentId;
    // A held lead is already in a queue → already_handled (a retry after a successful
    // return replays as a no-op).
    if (prospect.quarantinedAt) return { status: 'already_handled' };

    // ── Promotion arm (web-admin only): an unassigned, unheld stray joins the held pool.
    // No webhook — it has no owner app copy to vanish. Conditional UPDATE = race-safe.
    if (!previousAgentId) {
      // External-buyer-owned rows are NOT strays: externalAgentId is the other
      // mutually-exclusive owner FK, and quarantining such a row would hold a
      // lead an external buyer already paid for and holds a copy of.
      if (prospect.externalAgentId) return { status: 'undeliverable' };
      if (!promoteUnassigned) return { status: 'already_handled' };
      const pt = await d.sequelize.transaction();
      try {
        const [rows] = await d.sequelize.query(
          `UPDATE prospects
              SET "quarantinedAt" = NOW(), "quarantineReason" = :reason, "updatedAt" = NOW()
            WHERE id = :prospectId AND "assignedAgentId" IS NULL AND "quarantinedAt" IS NULL
            RETURNING id`,
          { replacements: { prospectId, reason }, transaction: pt }
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          await pt.rollback();
          return { status: 'already_handled' };
        }
        await m.ProspectActivity.create({
          prospectId,
          type: 'assigned',
          actorUserId,
          description: 'Moved to held queue by admin',
          metadata: { promoted: true, via },
        }, { transaction: pt });
        await pt.commit();
        return { status: 'promoted', leadId: prospectId };
      } catch (err) {
        await pt.rollback();
        throw err;
      }
    }

    const prevAgent = await m.User.findByPk(previousAgentId, { attributes: ['id', 'lyfeId', 'mktrLeadsId'] });
    const prevDestination = destinationForAgent(prevAgent);
    // External flavor stays same-app-scoped: only a mktr-leads-owned lead can be returned
    // (its broker + receiver own that contract). The web-admin flavor admits any owner.
    if (!anyDestination && prevDestination !== 'mktr_leads') return { status: 'not_assignable' };
    const previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);

    const t = await d.sequelize.transaction();
    let result;
    let deliveryPairs = [];
    try {
      // Conditional re-hold: gated on the row STILL being assigned to this agent and not held, so
      // a racing duplicate loses the row lock → 0 rows → already_handled (never a second vanish).
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "assignedAgentId" = NULL, "quarantinedAt" = NOW(),
                "quarantineReason" = :reason, "updatedAt" = NOW()
          WHERE id = :prospectId AND "assignedAgentId" = :previousAgentId AND "quarantinedAt" IS NULL
          RETURNING id`,
        { replacements: { prospectId, previousAgentId, reason }, transaction: t }
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        result = { status: 'already_handled' };
      } else {
        await m.ProspectActivity.create({
          prospectId,
          type: 'assigned',
          actorUserId,
          description: 'Returned to held queue by admin',
          metadata: { previousAgentId, returnedToHeld: true, via },
        }, { transaction: t });

        if (prevDestination) {
          // Vanish the lead from the previous agent's app — the mktr-leads receiver
          // soft-deletes on returnedToHeld; Lyfe nulls assigned_to.
          deliveryPairs = await d.persistEventDeliveries(
            'lead.unassigned',
            () => buildLeadUnassignedPayload(prospect, previousAgentExternalId, { returnedToHeld: true }),
            { destination: prevDestination },
            t
          );
          // Fail closed: never re-hold a lead we cannot durably vanish from the agent's app.
          if (deliveryPairs.length === 0) {
            await t.rollback();
            return { status: 'undeliverable' };
          }
        }
        // No-destination owner (System Agent / provenance-less): nothing was ever
        // delivered, so there is nothing to vanish — the re-hold alone is complete.

        result = { status: 'returned', leadId: prospectId };
      }

      await idem.recordResult(IDEMP_SCOPE, idempotencyKey, result, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      {
        const winner = await idem.replayOnUniqueRace(IDEMP_SCOPE, idempotencyKey, err);
        if (winner) return winner;
      }
      throw err;
    }

    // Post-commit: flush the vanish delivery. NO credit refund (consistent with reassign).
    if (result.status === 'returned') {
      d.flushDeliveries(deliveryPairs);
    }

    return result;
  }
  /**
   * Bulk return leads to the held queue (web admin). Fan-out over the hardened single op
   * — the same pattern the mktr-leads admin app uses for its bulk — because per-row
   * fail-closed vanish semantics don't fit one set-based transaction: each row either
   * fully returns (re-hold + vanish delivery committed together) or reports why not.
   * `returned_by_admin` keeps every returned lead OUT of the external buyer queue.
   * No idempotency keys: the single op's conditional UPDATE makes re-runs no-ops.
   */
  async function bulkReturnProspectsToHeld(prospectIds, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || prospectIds.length === 0) {
      throw new d.AppError('Prospect IDs array is required', 400);
    }
    const requestedIds = [...new Set(prospectIds)];
    const scopeWhere = await d.buildProspectWhere(user);

    const counts = { returned: 0, promoted: 0, alreadyHeld: 0, undeliverable: 0, notFound: 0 };
    for (const id of requestedIds) {
      const r = await returnProspectToHeld(id, {
        actorUserId: user?.id || null,
        reason: 'returned_by_admin',
        via: 'web_admin',
        anyDestination: true,
        promoteUnassigned: true,
        scopeWhere,
      });
      if (r.status === 'returned') counts.returned += 1;
      else if (r.status === 'promoted') counts.promoted += 1;
      else if (r.status === 'already_handled') counts.alreadyHeld += 1;
      else if (r.status === 'undeliverable') counts.undeliverable += 1;
      else counts.notFound += 1;
    }
    return counts;
  }

  return { orphanSystemAgentId, listDispatchableOrphans, releaseHeldProspect, reassignProspectExternal, returnProspectToHeld, bulkReturnProspectsToHeld };
}
