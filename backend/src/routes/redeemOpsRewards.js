import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/rewardsController.js';

/**
 * Redeem Ops Phase 4 — reward offers, versioned terms, inventory ledger,
 * onboarding checklist (docs/redeem-ops/ROUTE_MAP.md §1). Flag + host-guard
 * posture as siblings.
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// Reward offers
router.get('/rewards', requireRedeemOps('rewards.view'), ctrl.listOffers);
router.post('/rewards', requireRedeemOps('rewards.manage'), ctrl.createOffer);
router.get('/rewards/:id', requireRedeemOps('rewards.view'), ctrl.getOffer);
router.put('/rewards/:id', requireRedeemOps('rewards.manage'), ctrl.updateOffer);
router.patch('/rewards/:id/status', requireRedeemOps('rewards.manage'), ctrl.setOfferStatus);

// Versioned terms + participating locations (recent terms ship with getOffer)
router.post('/rewards/:id/terms', requireRedeemOps('rewards.manage'), ctrl.addTermsVersion);
router.put('/rewards/:id/locations', requireRedeemOps('rewards.manage'), ctrl.setLocations);

// Inventory (manual movements are ops_admin+; ledger visible to reward viewers)
router.post('/rewards/:id/inventory', requireRedeemOps('inventory.adjust'), ctrl.adjustInventory);
router.get('/rewards/:id/ledger', requireRedeemOps('rewards.view'), ctrl.getLedger);

// Partner onboarding checklist
router.get('/partners/:id/onboarding', requireRedeemOps('onboarding.manage'), ctrl.getOnboarding);
router.patch('/onboarding/:itemId', requireRedeemOps('onboarding.manage'), ctrl.updateOnboardingItem);

export default router;
