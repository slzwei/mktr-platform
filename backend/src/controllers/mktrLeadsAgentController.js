import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { syncAgentsFromMktrLeads } from '../services/agentSyncService.js';

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
