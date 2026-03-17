import express from 'express';
import { requireAdmin, authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import * as agentController from '../controllers/agentController.js';

export const meta = {
  mounts: [
    { path: '/api/agents' },
    { path: '/api/leadgen/agents', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Leaderboard (must be before /:id to avoid route collision)
router.get('/leaderboard/performance', authenticateToken, requireAdmin, agentController.getLeaderboard);

// Invite
router.post('/invite', authenticateToken, requireAdmin, agentController.inviteAgent);

// CRUD
router.get('/', authenticateToken, requireAdmin, agentController.listAgents);
router.get('/:id', authenticateToken, requireAgentOrAdmin, agentController.getAgent);
router.put('/:id', authenticateToken, agentController.updateAgent);

// Sub-resources
router.get('/:id/prospects', authenticateToken, requireAgentOrAdmin, agentController.getAgentProspects);
router.get('/:id/commissions', authenticateToken, requireAgentOrAdmin, agentController.getAgentCommissions);
router.get('/:id/campaigns', authenticateToken, requireAgentOrAdmin, agentController.getAgentCampaigns);

export default router;
