import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { syncAgents } from '../controllers/mktrLeadsAgentController.js';

export const meta = { path: '/api/mktr-leads' };

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Manual on-demand sync of mktr-leads agents → local User table. The 10-min
// cron in bootstrap covers the steady state; this is for first rollout + ops.
router.post('/agents/sync', syncAgents);

export default router;
