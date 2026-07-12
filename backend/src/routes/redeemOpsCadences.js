import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/cadenceController.js';

/**
 * Cadence engine routes (docs/plans/redeem-ops-cadences.md §9). Dark behind
 * its OWN flag on top of the Redeem Ops module flag — both must be true.
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_CADENCES_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// The cadence surface is meaningless without the ops module itself.
router.use((req, res, next) => {
  if (String(process.env.REDEEM_OPS_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return next();
});

// Definitions — every ops principal reads them (queue chips resolve names).
router.get('/cadences', requireRedeemOps(), ctrl.listCadences);

// Partner-scoped enrollment lifecycle (owner/manager checks in the service).
router.get('/partners/:partnerId/cadence', requireRedeemOps(), ctrl.getPartnerCadence);
router.post('/partners/:partnerId/cadence/enroll', requireRedeemOps('tasks.manage'), ctrl.enroll);
router.post('/partners/:partnerId/cadence/pause', requireRedeemOps('tasks.manage'), ctrl.pause);
router.post('/partners/:partnerId/cadence/resume', requireRedeemOps('tasks.manage'), ctrl.resume);
router.post('/partners/:partnerId/cadence/stop', requireRedeemOps('tasks.manage'), ctrl.stop);

// The disposition endpoint — the ONLY way to complete a cadence task (§5.2).
router.post('/cadence-tasks/:taskId/complete', requireRedeemOps('tasks.manage'), ctrl.completeCadenceTask);

export default router;
