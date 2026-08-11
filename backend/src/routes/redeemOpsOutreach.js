import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/outreachController.js';

/**
 * Outreach sending identities — cadence email auto-send Phase A
 * (docs/plans/redeem-ops-cadence-email-autosend.md §7). Dark behind its OWN
 * flag on top of the Redeem Ops module flag — both must be true. Phase A is
 * setup-only: nothing here sends to a prospect (test-send goes to the
 * account's own inbox).
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_EMAIL_AUTOSEND_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

router.use((req, res, next) => {
  if (String(process.env.REDEEM_OPS_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return next();
});

// Admin tier throughout — connecting a Workspace account and mapping who
// sends as whom is settings work, not rep work.
router.get('/outreach/account', requireRedeemOps('settings.manage'), ctrl.getAccount);
router.put('/outreach/account', requireRedeemOps('settings.manage'), ctrl.setupAccount);
router.post('/outreach/account/health', requireRedeemOps('settings.manage'), ctrl.refreshHealth);
router.get('/outreach/workspace-addresses', requireRedeemOps('settings.manage'), ctrl.workspaceAddresses);
router.get('/outreach/personas', requireRedeemOps('settings.manage'), ctrl.listPersonas);
router.post('/outreach/personas/import', requireRedeemOps('settings.manage'), ctrl.importPersonas);
router.patch('/outreach/personas/:personaId', requireRedeemOps('settings.manage'), ctrl.updatePersona);
router.post('/outreach/personas/:personaId/test-send', requireRedeemOps('settings.manage'), ctrl.testSend);

export default router;
