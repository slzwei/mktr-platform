import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as campaignController from '../controllers/campaignController.js';
import { uuidParamGuard } from '../middleware/uuidParam.js';

// Campaign Launch Workspace APIs. Mounted under /api/admin/campaigns so
// internalRouteHostGuard (which blocks the /api/admin prefix) keeps these
// admin-only endpoints unreachable from the redeem.sg public site. Auto-loaded
// by routes/index.js via this meta export.
export const meta = { path: '/api/admin/campaigns' };

const router = express.Router();

// Malformed :id → clean 404 (teardown PR; shared guard).
router.param('id', uuidParamGuard('Campaign'));

// Campaign-first delivery pool: funded agents + remaining credits + held count.
router.get('/:id/delivery-pool', authenticateToken, requireAdmin, campaignController.getDeliveryPool);

// Bulk-assign one campaign package to many agents (idempotent, one release sweep).
router.post('/:id/delivery-pool/assign', authenticateToken, requireAdmin, campaignController.bulkAssignDeliveryPool);

// Activate / pause a campaign (readiness-gated on activate; preserves status semantics).
router.patch('/:id/launch-state', authenticateToken, requireAdmin, campaignController.setLaunchState);

export default router;
