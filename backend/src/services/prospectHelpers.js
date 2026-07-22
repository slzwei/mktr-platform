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
 * The DNC scrubbing block carried on a delivered lead so the agent app can flag / disable
 * outbound contact per channel. Returns null when the lead has no DNC data (scrubbing off
 * or not yet checked), so payloads are byte-for-byte unchanged when DNC is disabled.
 */
export function dncPayloadBlock(prospect) {
  if (!prospect || prospect.dncStatus == null) return null;
  return {
    status: prospect.dncStatus,
    noVoiceCall: prospect.dncNoVoiceCall === true,
    noTextMessage: prospect.dncNoTextMessage === true,
    noFax: prospect.dncNoFax === true,
    checkedAt: prospect.dncCheckedAt || null,
    validUntil: prospect.dncValidUntil || null,
  };
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
        dnc: dncPayloadBlock(prospect),
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
 *
 * `opts.qrTag` / `opts.routingMode` mirror the created payload's `qrTag` block and
 * `routing.mode`: manual dispatch always fires lead.assigned (never lead.created — a
 * duplicate create is a silent no-op at both receivers), so when the destination app
 * has never seen the lead it INSERTS from this payload and needs the same QR/source
 * context a create would have carried.
 */
export function buildLeadAssignedPayload(prospect, agent, prospectWithCampaign, opts = {}) {
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
        dnc: dncPayloadBlock(prospect),
        createdAt: prospect.createdAt
      },
      routing: {
        mode: opts.routingMode || null,
        agentExternalId: externalIdForDestination(agent, destinationForAgent(agent)),
        agentName: [agent.firstName, agent.lastName].filter(Boolean).join(' '),
        agentEmail: agent.email,
        agentPhone: agent.phone
      },
      campaign: prospectWithCampaign?.campaign
        ? { externalId: prospectWithCampaign.campaign.id, name: prospectWithCampaign.campaign.name }
        : null,
      qrTag: {
        externalId: opts.qrTag?.id || null,
        slug: opts.qrTag?.slug || null
      }
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

/**
 * Build the payload for a 'lead.deleted' event — fired when an admin deletes a
 * prospect on MKTR so the mktr-leads mirror can soft-delete its copy. Minimal
 * (like lead.held): the receiver looks the lead up by externalId, so no other PII
 * crosses the wire. Delivered ONLY to the destination='mktr_leads' subscriber.
 */
export function buildLeadDeletedPayload(prospect) {
  return {
    event: 'lead.deleted',
    timestamp: new Date().toISOString(),
    data: {
      lead: {
        externalId: prospect.id
      }
    }
  };
}

/**
 * lead.suppressed v1 (tracker "propagate", docs/reference/webhook-propagation-contract.md):
 * "stop contacting the person behind this lead; keep the lead."
 * Data-minimized by contract: lead externalId + suppression facts only —
 * no consumerId, no phone/name/email. Consumers act on `scope`
 * ('all' blocks everything incl. transactional; 'marketing' blocks marketing);
 * `reason` is diagnostic. `occurredAt` is the authoritative transition time
 * (suppression.createdAt / consumer.erasedAt) — stable across repairs, used
 * for the consumer's monotonic merge.
 */
export function buildLeadSuppressedPayload(prospectId, { scope, reason, channel = 'all', occurredAt }) {
  return {
    event: 'lead.suppressed',
    timestamp: new Date().toISOString(),
    data: {
      lead: { externalId: prospectId },
      suppression: {
        schemaVersion: 1,
        scope,
        reason,
        channel,
        occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
      },
    },
  };
}

/**
 * lead.unsuppressed v1 (plan v3 — resubscribe lift): "the person behind this
 * lead re-consented; marketing contact is allowed again." Only ever emitted
 * for scope 'marketing' — 'all' (erasure) is a latch and never lifts.
 * Consumers apply it with a watermark: strictly-newer occurredAt wins in
 * either direction, so out-of-order/repaired deliveries stay idempotent.
 */
export function buildLeadUnsuppressedPayload(prospectId, { reason, occurredAt }) {
  return {
    event: 'lead.unsuppressed',
    timestamp: new Date().toISOString(),
    data: {
      lead: { externalId: prospectId },
      unsuppression: {
        schemaVersion: 1,
        scope: 'marketing',
        reason,
        occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
      },
    },
  };
}

/** Format a budget object ({ min, max, currency, timeframe }) into one display string, or null. */
function formatBudget(budget) {
  if (!budget || typeof budget !== 'object') return null;
  const { min, max, currency, timeframe } = budget;
  if (min == null && max == null) return null;
  const cur = currency ? ` ${currency}` : '';
  const range =
    min != null && max != null
      ? `${min} – ${max}${cur}`
      : max != null
        ? `Up to ${max}${cur}`
        : `From ${min}${cur}`;
  return timeframe ? `${range} · ${timeframe}` : range;
}

/**
 * Derive the held-lead enrichment the admin detail view shows for an orphan prospect —
 * the SAME personal / firmographic data a delivered lead surfaces, plus the extra
 * demographics the receiver's note-enrichment happens to drop. Returns:
 *   { birthday, details }
 * where `birthday` is the RAW date-of-birth string (the app owns its DD/MM/YYYY
 * formatting, so birthday formatting lives in exactly one place) and `details` is an
 * ordered, display-ready [{ label, value }] list of every OTHER populated field.
 * Campaign / source / email are NOT included here — they are already discrete DTO
 * fields the queue + detail view render directly.
 */
export function buildHeldLeadEnrichment(prospect) {
  if (!prospect) return { birthday: null, details: [] };
  const demo = prospect.demographics && typeof prospect.demographics === 'object' ? prospect.demographics : {};
  const loc = prospect.location && typeof prospect.location === 'object' ? prospect.location : {};

  const birthday = typeof demo.dateOfBirth === 'string' && demo.dateOfBirth.trim() ? demo.dateOfBirth.trim() : null;

  const details = [];
  const push = (label, value) => {
    if (value == null) return;
    const s = String(value).trim();
    if (s) details.push({ label, value: s });
  };

  // Personal — birthday is intentionally omitted (carried discretely, formatted app-side).
  push('Age', demo.age);
  push('Gender', demo.gender);
  push('Marital status', demo.maritalStatus);
  push('Monthly income', demo.income);
  push('Education', demo.education);
  // Location
  push('Postal code', loc.postalCode || loc.zipCode);
  push('Address', loc.address);
  // Firmographic
  push('Company', prospect.company);
  push('Job title', prospect.jobTitle);
  push('Industry', prospect.industry);
  // Intent
  const interests = Array.isArray(prospect.interests) ? prospect.interests.filter(Boolean) : [];
  if (interests.length) push('Interests', interests.join(', '));
  push('Budget', formatBudget(prospect.budget));

  return { birthday, details };
}

/**
 * Validate a bulk batch context ({ id, size }) from an external request body.
 * The mktr-leads admin app fans a bulk op out as N single-lead calls, each
 * carrying the SAME batch — MKTR echoes it into every per-lead webhook so the
 * receiver can coalesce the N pushes into one summary ("14 leads assigned to
 * you"). Malformed shapes return null (per-lead pushes, the pre-bulk behavior)
 * rather than erroring: the batch is a delivery-UX hint, never a correctness input.
 */
export function parseBatchContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, size } = raw;
  if (typeof id !== 'string' || id.length < 8 || id.length > 64) return null;
  if (!Number.isInteger(size) || size < 1 || size > 500) return null;
  return { id, size };
}

/** Echo a validated batch context into a webhook payload's data block (no-op when null). */
export function withBatchContext(payload, batch) {
  if (!batch) return payload;
  return { ...payload, data: { ...payload.data, batch } };
}
