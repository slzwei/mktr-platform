/**
 * The QR ROUTE stage of lead capture (P3-1) — who this lead belongs to, as far
 * as the scanned QR tag is concerned.
 *
 * Refines the INTERNAL path only. External-eligible leads were already routed by
 * resolveLeadAssignment (which includes the QR tier), so re-running QR routing
 * for them would double-route — hence the `allowExternal` guard on every branch.
 *
 * Lifted verbatim out of createProspect. `assignedAgentId` and `routeVia` were
 * read-and-reassigned through the closure; they are now an input and a returned
 * output, so it is visible that this stage can change them.
 */

/**
 * @param {object} args
 * @param {object} args.d Injected dependencies (the prospectService `d` object).
 * @param {object} args.m Injected models.
 */
export function makeQrRoutingStage({ d, m }) {
  /**
   * @param {object} ctx
   * @param {boolean} ctx.allowExternal This lead may go to an MKTR Leads buyer.
   * @param {object|null} ctx.sourceQrTag The scanned tag, if any.
   * @param {string|null} ctx.assignedAgentId The pick so far.
   * @param {string|undefined} ctx.routeVia How that pick was made.
   * @returns {Promise<{ routingMode: string, resolvedAgent: object|null,
   *   agentGroup: object|null, assignedAgentId: string|null, routeVia: string|undefined }>}
   */
  return async function resolveQrRouting({ allowExternal, sourceQrTag, assignedAgentId, routeVia }) {
    // --- Routing resolution: reads from QrTag, not Campaign ---
    let routingMode = 'direct';
    let resolvedAgent = null;
    let agentGroup = null;

    // QR-level routing refines the INTERNAL path only; external-eligible leads were
    // already routed by resolveLeadAssignment above (it includes the QR tier), so
    // re-running QR routing here would double-route them.
    if (!allowExternal && sourceQrTag?.agentAssignmentMode === 'round_robin') {
      routingMode = 'round_robin';

      // Query members from join table, ordered by sortOrder
      const members = sourceQrTag.agentGroupId
        ? await m.AgentGroupMember.findAll({
            where: { agentGroupId: sourceQrTag.agentGroupId },
            order: [['sortOrder', 'ASC']],
          })
        : [];

      if (members.length > 0) {
        // Load the group record for webhook metadata
        agentGroup = await m.AgentGroup.findByPk(sourceQrTag.agentGroupId);

        // Atomic round-robin index increment on QrTag. A failed increment must
        // not lose the lead, but the stale-index fallback pins every lead on
        // this tag to the same member while it persists — so it has to be loud.
        const [, [updated]] = await m.QrTag.update(
          { roundRobinIndex: d.sequelize.literal('"roundRobinIndex" + 1') },
          { where: { id: sourceQrTag.id }, returning: true }
        ).catch((err) => {
          d.logger.warn('[Routing] QR round-robin increment failed — reusing stale index', {
            qrTagId: sourceQrTag.id, error: err?.message || String(err),
          });
          return [0, [sourceQrTag]];
        });

        const idx = (updated?.roundRobinIndex ?? sourceQrTag.roundRobinIndex) % members.length;
        const selectedMember = members[idx];

        resolvedAgent = {
          phone: selectedMember.phone,
          email: selectedMember.email,
          name: selectedMember.name,
        };
      }
    } else if (!allowExternal && sourceQrTag?.assignedAgentId) {
      // Direct FK lookup — faster than phone-based search
      assignedAgentId = sourceQrTag.assignedAgentId;
      routeVia = 'qr';
    } else if (!allowExternal && sourceQrTag?.assignedAgentPhone) {
      // Fallback for QR tags not yet backfilled
      resolvedAgent = {
        phone: sourceQrTag.assignedAgentPhone,
        email: sourceQrTag.assignedAgentEmail,
        name: sourceQrTag.assignedAgentName,
      };
    }

    // Override assignedAgentId with QR-level routing result (by phone lookup)
    if (resolvedAgent?.phone) {
      const agentByPhone = await m.User.findOne({
        where: { phone: resolvedAgent.phone, role: 'agent', isActive: true },
      });
      if (agentByPhone) {
        assignedAgentId = agentByPhone.id;
        routeVia = 'qr';
      }
    }

    return { routingMode, resolvedAgent, agentGroup, assignedAgentId, routeVia };
  };
}
