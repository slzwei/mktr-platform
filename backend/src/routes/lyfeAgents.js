import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { fetchAgents, fetchAgentGroups, fetchAgentById, invalidateCache } from '../services/agentSyncService.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Fetch agents from Lyfe
router.get('/agents', asyncHandler(async (req, res) => {
  const agents = await fetchAgents(req.query);
  res.json({ success: true, data: agents });
}));

// Fetch agent groups from Lyfe
router.get('/agent-groups', asyncHandler(async (req, res) => {
  const groups = await fetchAgentGroups();
  res.json({ success: true, data: groups });
}));

// Fetch a single agent by ID from Lyfe
router.get('/agents/:id', asyncHandler(async (req, res) => {
  const agent = await fetchAgentById(req.params.id);
  res.json({ success: true, data: agent });
}));

// Invalidate the Lyfe agent cache
router.post('/cache/invalidate', asyncHandler(async (req, res) => {
  invalidateCache();
  res.json({ success: true, message: 'Cache invalidated' });
}));

export default router;
