import { asyncHandler } from '../middleware/errorHandler.js';
import {
  fetchAgents,
  fetchAgentGroups,
  fetchAgentById,
  syncAgentsFromLyfe,
  invalidateCache
} from '../services/agentSyncService.js';

/**
 * GET /api/lyfe/agents
 * Fetch agents from Lyfe.
 */
export const listAgents = asyncHandler(async (req, res) => {
  const agents = await fetchAgents(req.query);
  res.json({ success: true, data: agents });
});

/**
 * GET /api/lyfe/agent-groups
 * Fetch agent groups from Lyfe.
 */
export const listGroups = asyncHandler(async (req, res) => {
  const groups = await fetchAgentGroups();
  res.json({ success: true, data: groups });
});

/**
 * GET /api/lyfe/agents/:id
 * Fetch a single agent by ID from Lyfe.
 */
export const getAgent = asyncHandler(async (req, res) => {
  const agent = await fetchAgentById(req.params.id);
  res.json({ success: true, data: agent });
});

/**
 * POST /api/lyfe/agents/sync
 * Sync agents from Lyfe into local User table.
 */
export const syncAgents = asyncHandler(async (req, res) => {
  const { created, updated, deactivated, skipped, total } = await syncAgentsFromLyfe();
  res.json({
    success: true,
    message: `Sync complete: ${created} created, ${updated} updated, ${deactivated} deactivated, ${skipped} unchanged`,
    data: { created, updated, deactivated, skipped, total }
  });
});

/**
 * POST /api/lyfe/cache/invalidate
 * Invalidate the Lyfe agent cache.
 */
export const clearCache = asyncHandler(async (req, res) => {
  invalidateCache();
  res.json({ success: true, message: 'Cache invalidated' });
});
