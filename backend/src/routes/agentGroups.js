import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/agentGroupController.js';

export const meta = { path: '/api/admin/agent-groups' };

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/', ctrl.listAgentGroups);
router.post('/', ctrl.createAgentGroup);
router.put('/:id', ctrl.updateAgentGroup);
router.delete('/:id', ctrl.deleteAgentGroup);

export default router;
