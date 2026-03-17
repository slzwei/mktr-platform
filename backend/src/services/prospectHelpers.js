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
        leadSource: prospect.leadSource,
        tags: prospect.tags,
        notes: prospect.notes,
        sourceMetadata: meta,
        recordingUrl: meta.recordingUrl || null,
        transcript: meta.retellCallId ? prospect.notes : null,
        createdAt: prospect.createdAt
      },
      routing: {
        agentExternalId: agent.lyfeId || agent.id,
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
export function buildLeadUnassignedPayload(prospect, previousAgentLyfeId) {
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
      previousAgentId: previousAgentLyfeId
    }
  };
}
