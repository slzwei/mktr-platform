/**
 * Pure helper functions extracted from prospectService.
 * These are standalone — they do NOT depend on the injected `d`/`m` deps.
 */

/**
 * Normalize a phone string to E.164 format.
 * Singapore-specific: 8-digit numbers starting with 3/6/8/9 get +65 prefix.
 * Numbers starting with 65 and length 10 get + prefix.
 * All others get + prefix if missing.
 */
export function normalizePhone(phone) {
  if (!phone) return phone;
  let p = String(phone).replace(/\s+/g, '');
  // If it's just digits (no +), assume Singapore (+65)
  if (/^\d+$/.test(p)) {
    if (p.length === 8 && /^[3689]/.test(p)) {
      p = `+65${p}`;
    } else if (p.startsWith('65') && p.length === 10) {
      p = `+${p}`;
    } else {
      p = `+${p}`;
    }
  }
  // Ensure it starts with +
  if (!p.startsWith('+')) {
    p = `+${p}`;
  }
  return p;
}

/**
 * Destination app for a mirrored agent, derived from its provenance columns.
 *   lyfeId set       -> 'lyfe'
 *   mktrLeadsId set  -> 'mktr_leads'
 *   neither          -> null  (local-only, e.g. System Agent → not deliverable)
 * The DB CHECK (users_single_provenance_chk) guarantees at most one is set.
 */
export function destinationForAgent(agent) {
  if (!agent) return null;
  if (agent.lyfeId) return 'lyfe';
  if (agent.mktrLeadsId) return 'mktr_leads';
  return null;
}

/**
 * The external agent id the destination app's receiver matches on.
 * NEVER falls back to the internal MKTR users.id — that id is meaningless to the
 * receivers (Lyfe matches users.id by lyfeId; mktr-leads by mktr_user_id), so a
 * fallback would guarantee a 422 and a dropped lead.
 */
export function externalIdForDestination(agent, destination) {
  if (!agent) return null;
  if (destination === 'lyfe') return agent.lyfeId || null;
  if (destination === 'mktr_leads') return agent.mktrLeadsId || null;
  return null;
}

/**
 * Build the webhook payload for a 'lead.created' event.
 */
export function buildLeadCreatedPayload(prospect, routingMode, agentForWebhook, assignedAgentId, sourceCampaign, sourceQrTag, agentGroup) {
  return {
    event: 'lead.created',
    timestamp: new Date().toISOString(),
    data: {
      lead: {
        externalId: prospect.id,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        phone: prospect.phone,
        email: prospect.email,
        company: prospect.company,
        jobTitle: prospect.jobTitle,
        industry: prospect.industry,
        leadSource: prospect.leadSource,
        interests: prospect.interests,
        budget: prospect.budget,
        preferences: prospect.preferences,
        demographics: prospect.demographics,
        location: prospect.location,
        tags: prospect.tags,
        notes: prospect.notes,
        sourceMetadata: prospect.sourceMetadata,
        recordingUrl: prospect.sourceMetadata?.recordingUrl || null,
        transcript: prospect.sourceMetadata?.retellCallId ? prospect.notes : null,
        createdAt: prospect.createdAt
      },
      routing: {
        mode: routingMode,
        agentPhone: agentForWebhook?.phone || null,
        agentEmail: agentForWebhook?.email || null,
        agentName: agentForWebhook?.name || null,
        agentExternalId: agentForWebhook?.id || assignedAgentId || null,
        groupId: agentGroup?.id || null,
        groupName: agentGroup?.name || null
      },
      campaign: {
        externalId: sourceCampaign?.id || null,
        name: sourceCampaign?.name || null
      },
      qrTag: {
        externalId: sourceQrTag?.id || null,
        slug: sourceQrTag?.slug || null
      }
    }
  };
}

/**
 * Build the webhook payload for a 'lead.assigned' event.
 */
export function buildLeadAssignedPayload(prospect, agent, prospectWithCampaign) {
  const meta = prospect.sourceMetadata || {};
  return {
    event: 'lead.assigned',
    timestamp: new Date().toISOString(),
    data: {
      lead: {
        externalId: prospect.id,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        phone: prospect.phone,
        email: prospect.email,
        // Firmographic + demographic fields MUST match buildLeadCreatedPayload: when a
        // reassigned lead is NEW to the destination app it is INSERTED from this payload,
        // and the receiver's note enrichment (Birthday/Postal/Company/…) reads exactly these.
        company: prospect.company,
        jobTitle: prospect.jobTitle,
        industry: prospect.industry,
        leadSource: prospect.leadSource,
        interests: prospect.interests,
        budget: prospect.budget,
        preferences: prospect.preferences,
        demographics: prospect.demographics,
        location: prospect.location,
        tags: prospect.tags,
        notes: prospect.notes,
        sourceMetadata: meta,
        recordingUrl: meta.recordingUrl || null,
        transcript: meta.retellCallId ? prospect.notes : null,
        createdAt: prospect.createdAt
      },
      routing: {
        agentExternalId: externalIdForDestination(agent, destinationForAgent(agent)),
        agentName: [agent.firstName, agent.lastName].filter(Boolean).join(' '),
        agentEmail: agent.email,
        agentPhone: agent.phone
      },
      campaign: prospectWithCampaign?.campaign
        ? { externalId: prospectWithCampaign.campaign.id, name: prospectWithCampaign.campaign.name }
        : null
    }
  };
}

/**
 * Build the webhook payload for a 'lead.unassigned' event.
 */
export function buildLeadUnassignedPayload(prospect, previousAgentLyfeId, opts = {}) {
  return {
    event: 'lead.unassigned',
    timestamp: new Date().toISOString(),
    data: {
      lead: {
        externalId: prospect.id,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        phone: prospect.phone,
        email: prospect.email,
        leadSource: prospect.leadSource,
        sourceMetadata: prospect.sourceMetadata
      },
      previousAgentId: previousAgentLyfeId,
      // Admin pull-back to the held queue: signals the mktr-leads receiver to SOFT-DELETE
      // (vanish) the lead instead of marking it disputed. Omitted for normal cross-app
      // unassignment, which keeps the existing dispute behavior.
      ...(opts.returnedToHeld ? { returnedToHeld: true } : {})
    }
  };
}

/**
 * Build the payload for a 'lead.held' event — fired when a lead is QUARANTINED as
 * `no_funded_agent` and lands in the mktr-leads admin held / pending-assignment
 * queue. It has NO owner agent, so unlike lead.created it carries NO routing and
 * only the minimum the receiver needs to ping the admin fleet (no lead PII beyond
 * what the held queue already shows the admin): the prospect id (the dedup key the
 * sweep also uses), the campaign, and the hold reason. Delivered ONLY to the
 * destination='mktr_leads' subscriber.
 */
export function buildLeadHeldPayload(prospect, campaign, reason) {
  return {
    event: 'lead.held',
    timestamp: new Date().toISOString(),
    data: {
      lead: {
        externalId: prospect.id
      },
      campaign: campaign ? { externalId: campaign.id, name: campaign.name } : null,
      reason: reason || 'no_funded_agent',
      heldAt: new Date().toISOString()
    }
  };
}
