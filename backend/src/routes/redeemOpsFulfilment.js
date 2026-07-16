import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/fulfilmentController.js';

/**
 * Redeem Ops Phase 6 — entitlements + redemption console (docs/redeem-ops/
 * ROUTE_MAP.md §1). Consumer claim lives in the SEPARATE public namespace
 * /api/reward-claim (never under this host-blocked internal prefix), and the
 * consultant unlock rides the existing HMAC surfaces (see MKTR_INTEGRATION.md §2).
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// Entitlements
router.get('/entitlements', requireRedeemOps('entitlements.view'), ctrl.listEntitlements);
router.post('/entitlements', requireRedeemOps('entitlements.issue_manual'), ctrl.issueManual);
// Manual unlock (testing / counter fallback). The capability gates the route;
// the service additionally enforces assigned-consultant binding for non-admins.
router.post('/entitlements/unlock', requireRedeemOps('entitlements.issue_manual'), ctrl.unlockEntitlement);
// Resend/share: re-mints the current credential (old QR dies — deliberate) and
// emails it, or returns the link once for staff to WhatsApp themselves.
router.post('/entitlements/:id/resend-pass', requireRedeemOps('entitlements.issue_manual'), ctrl.resendPass);
router.patch('/entitlements/:id/cancel', requireRedeemOps('entitlements.issue_manual'), ctrl.cancelEntitlement);

// Redemption console (voucher verify → complete; unmasked holder identity here only)
router.post('/redemptions/verify', requireRedeemOps('redemptions.verify'), ctrl.verifyVoucher);
router.post('/redemptions/complete', requireRedeemOps('redemptions.verify'), ctrl.completeRedemption);
router.post('/redemptions/:id/reverse', requireRedeemOps('redemptions.override'), ctrl.reverseRedemption);
router.get('/redemptions', requireRedeemOps('entitlements.view'), ctrl.listRedemptions);

export default router;
