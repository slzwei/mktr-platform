import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { listAgents, listGroups, getAgent, syncAgents, clearCache } from '../controllers/lyfeAgentController.js';

export const meta = { path: '/api/lyfe' };

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/agents', listAgents);
router.get('/agent-groups', listGroups);
router.get('/agents/:id', getAgent);
router.post('/agents/sync', syncAgents);
router.post('/cache/invalidate', clearCache);

export default router;
