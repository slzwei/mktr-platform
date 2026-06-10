import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { syncAgentsFromMktrLeads } from '../services/agentSyncService.js';
import * as mgmt from '../services/mktrLeadsAgentManagementService.js';

/**
 * POST /api/mktr-leads/agents/sync
 * Pull agents from the mktr-leads app into the local User table (mirrors the
 * Lyfe sync). Admin-only. Returns 503 with a clear message when the mktr-leads
 * env is not configured, instead of leaking the client's generic 500.
 */
export const syncAgents = asyncHandler(async (req, res) => {
  if (!process.env.MKTR_LEADS_SUPABASE_URL || !process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(
      'mktr-leads sync is not configured (set MKTR_LEADS_SUPABASE_URL and MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY)',
      503
    );
  }
  const { created, updated, deactivated, skipped, total, locked } = await syncAgentsFromMktrLeads();
  res.json({
    success: true,
    message: locked === false
      ? 'Another agent sync is already in progress — skipped'
      : `Sync complete: ${created} created, ${updated} updated, ${deactivated} deactivated, ${skipped} unchanged`,
    data: { created, updated, deactivated, skipped, total, locked: locked !== false },
  });
});

/**
 * POST /api/mktr-leads/agents/invite
 * Create a pending invitation IN MKTR-LEADS (its create-ext-agent-invite EF
 * owns the semantics). The invitee signs into the MKTR Leads app with this
 * phone via OTP; the agents row created on signup syncs here within ~10 min.
 */
export const inviteAgent = asyncHandler(async (req, res) => {
  const { phone, full_name, email, agency } = req.body;
  const result = await mgmt.inviteAgent({ phone, fullName: full_name, email, agency }, req.user);
  res.status(201).json({
    success: true,
    message:
      'Invitation created — the agent signs into the MKTR Leads app with this number to activate. They will appear in this list within ~10 minutes of signing up.',
    data: result,
  });
});

/**
 * POST /api/mktr-leads/agents/:mktrUserId/activate
 * POST /api/mktr-leads/agents/:mktrUserId/deactivate
 * Write is_active to mktr-leads (source of truth), then mirror locally.
 * Deactivation also locks the agent out of the mktr-leads app (OTP gate).
 */
export const activateAgent = asyncHandler(async (req, res) => {
  const agent = await mgmt.setAgentActive(req.params.mktrUserId, true, req.user);
  res.json({ success: true, message: 'Agent reactivated in mktr-leads', data: { agent } });
});

export const deactivateAgent = asyncHandler(async (req, res) => {
  const agent = await mgmt.setAgentActive(req.params.mktrUserId, false, req.user);
  res.json({
    success: true,
    message: 'Agent deactivated in mktr-leads — they can no longer sign into the MKTR Leads app and will stop receiving leads',
    data: { agent },
  });
});

/**
 * PATCH /api/mktr-leads/agents/:mktrUserId
 * Update profile fields (full_name/email/agency) in mktr-leads, then mirror.
 */
export const updateAgent = asyncHandler(async (req, res) => {
  const fields = {};
  for (const key of ['full_name', 'email', 'agency']) {
    if (key in req.body) fields[key] = req.body[key];
  }
  const agent = await mgmt.updateAgentFields(req.params.mktrUserId, fields, req.user);
  res.json({ success: true, message: 'Agent profile updated in mktr-leads', data: { agent } });
});
