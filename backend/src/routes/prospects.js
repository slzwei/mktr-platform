import express from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as prospectController from '../controllers/prospectController.js';

export const meta = {
  mounts: [
    { path: '/api/prospects' },
    { path: '/api/leadgen/prospects', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Get all prospects
router.get('/', authenticateToken, prospectController.listProspects);

// Create new prospect (lead capture)
router.post('/', validate(schemas.prospectCreate), prospectController.createProspect);

// Get prospect by ID
router.get('/:id', authenticateToken, prospectController.getProspect);

// Update prospect
router.put('/:id', authenticateToken, requireAgentOrAdmin, prospectController.updateProspect);

// Delete prospect
router.delete('/:id', authenticateToken, requireAgentOrAdmin, prospectController.deleteProspect);

// Bulk assign prospects (must be registered before /:id/assign to avoid param capture)
router.patch('/bulk/assign', authenticateToken, requireAgentOrAdmin, prospectController.bulkAssignProspects);

// Assign prospect to agent
router.patch('/:id/assign', authenticateToken, requireAgentOrAdmin, prospectController.assignProspect);

// Get prospect statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, prospectController.getProspectStats);

// Update prospect follow-up date
router.patch('/:id/follow-up', authenticateToken, requireAgentOrAdmin, prospectController.scheduleFollowUp);

// Track prospect view
router.post('/:id/track-view', authenticateToken, requireAgentOrAdmin, prospectController.trackProspectView);

export default router;
