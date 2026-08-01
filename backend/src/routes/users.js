import express from 'express';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as userController from '../controllers/userController.js';

export const meta = {
  mounts: [
    { path: '/api/users' },
    { path: '/api/admin/users', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// ---------- Collection routes (must be registered before :id params) ----------
router.get('/agents/list',    authenticateToken, requireAgentOrAdmin, userController.agents);
router.get('/stats/overview',  authenticateToken, requireAdmin,       userController.statsOverview);
router.post('/invite',         authenticateToken, requireAdmin,       validate(schemas.userInvite), userController.invite);
router.post('/bulk-delete',    authenticateToken, requireAdmin,       validate(schemas.userBulkDelete), userController.bulkRemove);

// ---------- CRUD ----------
router.post('/',               authenticateToken, requireAdmin,       validate(schemas.userCreate), userController.create);
router.get('/',                authenticateToken, requireAdmin,       userController.list);
router.get('/:id',             authenticateToken,                     userController.getById);
router.put('/:id',             authenticateToken,                     validate(schemas.adminUserUpdate), userController.update);
router.delete('/:id',          authenticateToken, requireAdmin,       userController.remove);
router.delete('/:id/permanent', authenticateToken, requireAdmin,      userController.permanentRemove);

// ---------- Status / Approval ----------
router.patch('/:id/status',    authenticateToken, requireAdmin,       validate(schemas.userStatusPatch), userController.patchStatus);
router.patch('/:id/approval',  authenticateToken, requireAdmin,       validate(schemas.userApprovalPatch), userController.patchApproval);

export default router;
