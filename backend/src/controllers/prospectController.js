import { asyncHandler } from '../middleware/errorHandler.js';
import { sendLeadAssignmentEmail, sendLeadConfirmationEmail } from '../services/mailer.js';
import * as prospectService from '../services/prospectService.js';
import { publicHostFromRequest } from '../utils/publicHost.js';

// Build a sensible CAPI event_source_url fallback when the SPA omits it.
// Aggregated Event Measurement requires the URL to match where the Pixel
// fired — i.e. the SPA page on redeem.sg (or mktr.sg). We never reference
// req inside metaCapiService.js; the request object lives only here.
function deriveEventSourceUrl(req, publicHost) {
  const explicit = req.body?.eventSourceUrl;
  if (explicit) return explicit;
  if (!publicHost) return undefined;
  const proto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  return `${proto}://${publicHost}/LeadCapture`;
}

export const listProspects = asyncHandler(async (req, res) => {
  const result = await prospectService.listProspects(req.user, req.query);

  res.json({
    success: true,
    data: result
  });
});

export const listHeldProspects = asyncHandler(async (req, res) => {
  const result = await prospectService.listHeldProspects(req.user, req.query);

  res.json({
    success: true,
    data: result
  });
});

export const createProspect = asyncHandler(async (req, res) => {
  const publicHost = publicHostFromRequest(req);
  const meta = {
    clientIp: req.ip,
    clientUserAgent: req.get('user-agent') || undefined,
    eventId: req.body?.eventId,
    fbp: req.body?.fbp,
    fbc: req.body?.fbc,
    eventSourceUrl: deriveEventSourceUrl(req, publicHost),
    // Quiz CompleteRegistration dedup id (Meta CAPI) + TikTok click/cookie ids
    // (Phase 6 server-side Events API). Stashed in sourceMetadata server-side.
    registrationEventId: req.body?.registrationEventId,
    ttclid: req.body?.ttclid,
    ttp: req.body?.ttp,
  };

  const { prospect, assignedAgentId, assignedAgent, prospectWithCampaign, shareUrl } = await prospectService.createProspect(
    req.body,
    req.user,
    { cookies: req.cookies, headers: req.headers, meta }
  );

  // Email sending OUTSIDE transaction (fire-and-forget, don't block response)
  if (assignedAgentId && assignedAgent) {
    sendLeadAssignmentEmail(assignedAgent, prospectWithCampaign).catch(err =>
      console.error(`Failed to send assignment email to agent ${assignedAgentId} for prospect ${prospect.id}:`, err.message || err)
    );
  }

  // Confirmation email to the lead (from noreply@redeem.sg). Fire-and-forget;
  // the function itself filters out synthetic Retell emails and missing fields.
  // Pass the canonical shareUrl minted at creation so the email's "Refer a friend"
  // link is byte-identical to the one the SPA shows post-submit.
  sendLeadConfirmationEmail(prospectWithCampaign || prospect, { shareUrl }).catch(err =>
    console.error(`Failed to send confirmation email to lead for prospect ${prospect.id}:`, err.message || err)
  );

  // Public, unauthenticated endpoint: echo only what the SPA needs — the id
  // drives the post-submit referral share link. Returning the full row would
  // leak sourceMetadata (fbc/fbp, consent flags, resolved referrerName) to
  // whoever submitted the form.
  res.status(201).json({
    success: true,
    message: 'Prospect created successfully',
    // shareUrl: the prospect's canonical referral link (same row the email uses). It only
    // carries the prospect's own UUID (already public in the share link) — no sourceMetadata.
    data: { prospect: { id: prospect.id }, shareUrl: shareUrl || null }
  });
});

export const getProspect = asyncHandler(async (req, res) => {
  const prospect = await prospectService.getProspect(req.params.id, req.user);

  res.json({
    success: true,
    data: { prospect }
  });
});

export const updateProspect = asyncHandler(async (req, res) => {
  const prospect = await prospectService.updateProspect(req.params.id, req.body, req.user);

  res.json({
    success: true,
    message: 'Prospect updated successfully',
    data: { prospect }
  });
});

export const deleteProspect = asyncHandler(async (req, res) => {
  await prospectService.deleteProspect(req.params.id, req.user);

  res.json({
    success: true,
    message: 'Prospect deleted successfully'
  });
});

export const bulkAssignProspects = asyncHandler(async (req, res) => {
  const { prospectIds, agentId } = req.body;
  const { affectedCount, agent } = await prospectService.bulkAssignProspects(prospectIds, agentId, req.user);

  // Notify agent about bulk assignment (fire-and-forget)
  if (affectedCount > 0) {
    sendLeadAssignmentEmail(agent, null, true, affectedCount).catch(err =>
      console.error(`Failed to send bulk assignment email to agent ${agentId} for ${affectedCount} prospects:`, err.message || err)
    );
  }

  res.json({
    success: true,
    message: `${affectedCount} prospects assigned successfully`,
    data: { affectedCount }
  });
});

export const assignProspect = asyncHandler(async (req, res) => {
  const { prospect, agent, prospectWithCampaign } = await prospectService.assignProspect(
    req.params.id,
    req.body.agentId,
    req.user
  );

  // Notify agent (fire-and-forget)
  sendLeadAssignmentEmail(agent, prospectWithCampaign).catch(err =>
    console.error(`Failed to send assignment email to agent ${req.body.agentId} for prospect ${prospect.id}:`, err.message || err)
  );

  res.json({
    success: true,
    message: 'Prospect assigned successfully',
    data: { prospect }
  });
});

export const getProspectStats = asyncHandler(async (req, res) => {
  const stats = await prospectService.getProspectStats(req.user);

  res.json({
    success: true,
    data: stats
  });
});

export const scheduleFollowUp = asyncHandler(async (req, res) => {
  const prospect = await prospectService.scheduleFollowUp(req.params.id, req.body, req.user);

  res.json({
    success: true,
    message: 'Follow-up scheduled successfully',
    data: { prospect }
  });
});

export const trackProspectView = asyncHandler(async (req, res) => {
  await prospectService.trackProspectView(req.params.id, req.user, {
    source: req.body.source,
    userAgent: req.headers['user-agent']
  });

  res.json({
    success: true,
    message: 'View tracked successfully'
  });
});
