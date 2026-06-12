import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import {
  syncAgents,
  inviteAgent,
  activateAgent,
  deactivateAgent,
  updateAgent,
} from '../controllers/mktrLeadsAgentController.js';

export const meta = { path: '/api/mktr-leads' };

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Manual on-demand sync of mktr-leads agents → local User table. The 10-min
// cron in bootstrap covers the steady state; this is for first rollout + ops.
router.post('/agents/sync', syncAgents);

// Management — mktr-leads is the source of truth; every action writes there
// first, then mirrors locally (see mktrLeadsAgentManagementService).
router.post('/agents/invite', validate(schemas.mktrLeadsAgentInvite), inviteAgent);
router.post('/agents/:mktrUserId/activate', activateAgent);
router.post('/agents/:mktrUserId/deactivate', deactivateAgent);
router.patch('/agents/:mktrUserId', validate(schemas.mktrLeadsAgentUpdate), updateAgent);

export default router;
