/**
 * Admin wallet observability + the manual-adjustment exception path.
 *
 * Mounted at `/api/admin/wallets` (admin JWT — NOT flag-gated: reads render
 * honest zeros pre-launch, and the adjustment is admin-authed + fully audited
 * in wallet_ledger). The admin never sells or cancels here: top-ups happen in
 * the agents' own app, refunds only via campaign takedown; `adjust` (signed
 * cents + MANDATORY note) is the sole escape hatch that keeps "no refunds"
 * enforceable without DB surgery.
 */
import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as ctrl from '../controllers/adminWalletController.js';

export const meta = { path: '/api/admin/wallets' };

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/', asyncHandler(ctrl.listWallets));
router.get('/:agentId/ledger', asyncHandler(ctrl.getAgentLedger));
router.post('/:agentId/adjust', asyncHandler(ctrl.adjust));

export default router;
