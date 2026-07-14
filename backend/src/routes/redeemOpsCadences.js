import express from 'express';
import rateLimit from 'express-rate-limit';
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

// LLM drafts are cheap but not free — per-user (not per-IP: staff share office
// NAT) minute window; in-memory store is fine on the single-instance backend.
const cadenceAiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many AI requests. Try again in a minute.' },
});

// Authoring — any rep who works tasks can build cadences (tasks.manage), saved
// as a private draft (creator + admins) or published team-wide. Row rules live
// in the service: only the creator or an admin edits/retires/publishes a row.
// Editing creates a NEW version; live enrollments keep the one they started on.
router.post('/cadences', requireRedeemOps('tasks.manage'), ctrl.createCadence);
// AI draft — same authoring gate; limiter AFTER auth so req.user keys the window.
router.post('/cadences/suggest', requireRedeemOps('tasks.manage'), cadenceAiLimiter, ctrl.suggestCadence);
router.post('/cadences/:cadenceId/versions', requireRedeemOps('tasks.manage'), ctrl.createCadenceVersion);
router.post('/cadences/:cadenceId/retire', requireRedeemOps('tasks.manage'), ctrl.retireCadence);
router.post('/cadences/:cadenceId/publish', requireRedeemOps('tasks.manage'), ctrl.publishCadence);

// Partner-scoped enrollment lifecycle (owner/manager checks in the service).
router.get('/partners/:partnerId/cadence', requireRedeemOps(), ctrl.getPartnerCadence);
router.post('/partners/:partnerId/cadence/enroll', requireRedeemOps('tasks.manage'), ctrl.enroll);
router.post('/partners/:partnerId/cadence/pause', requireRedeemOps('tasks.manage'), ctrl.pause);
router.post('/partners/:partnerId/cadence/resume', requireRedeemOps('tasks.manage'), ctrl.resume);
router.post('/partners/:partnerId/cadence/stop', requireRedeemOps('tasks.manage'), ctrl.stop);

// The disposition endpoint — the ONLY way to complete a cadence task (§5.2).
router.post('/cadence-tasks/:taskId/complete', requireRedeemOps('tasks.manage'), ctrl.completeCadenceTask);

export default router;
