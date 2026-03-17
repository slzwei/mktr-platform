import express from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/leadPackageController.js';

export const meta = { path: '/api/lead-packages' };

const router = express.Router();

// GET /api/lead-packages
router.get('/', authenticateToken, ctrl.listPackages);

// POST /api/lead-packages
router.post('/', authenticateToken, requireAgentOrAdmin, ctrl.createPackage);

// POST /api/lead-packages/assign
router.post('/assign', authenticateToken, requireAgentOrAdmin, ctrl.assignPackage);

// GET /api/lead-packages/assignments/:agentId
router.get('/assignments/:agentId', authenticateToken, ctrl.getAgentAssignments);

// DELETE /api/lead-packages/assignments/:id
router.delete('/assignments/:id', authenticateToken, requireAgentOrAdmin, ctrl.deleteAssignment);

// PATCH /api/lead-packages/assignments/:id
router.patch('/assignments/:id', authenticateToken, requireAgentOrAdmin, ctrl.updateAssignment);

// DELETE /api/lead-packages/:id
router.delete('/:id', authenticateToken, requireAgentOrAdmin, ctrl.deletePackage);

export default router;
