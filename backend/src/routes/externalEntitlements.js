import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireExternalHmac } from '../controllers/externalBillingController.js';
import { User } from '../models/index.js';
import { makeEntitlementService } from '../services/redeemOps/entitlementService.js';

/**
 * mktr-leads consultant → voucher unlock (docs/redeem-ops/MKTR_INTEGRATION.md §2).
 * Same posture as the other /api/external/* surfaces: HMAC over the raw body with
 * EXTERNAL_APP_SECRET + signed timestamp (requireExternalHmac), rawBody capture
 * and rate-limiter exemption already wired for the prefix.
 *
 * Body: { timestamp, agentMktrUserId, presentationToken?, prospectId?, via? }
 * The resolved mirror user must be the lead's assigned consultant.
 */
export const meta = {
  path: '/api/external/entitlements',
  flag: 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

router.post('/unlock', requireExternalHmac, asyncHandler(async (req, res) => {
  const { agentMktrUserId, presentationToken, prospectId, via } = req.body || {};
  if (!agentMktrUserId || (!presentationToken && !prospectId)) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and presentationToken or prospectId are required' });
  }

  const agent = await User.findOne({
    where: { mktrLeadsId: String(agentMktrUserId), isActive: true },
  });
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Unknown agent' });
  }

  try {
    const result = await makeEntitlementService().unlockEntitlement(
      presentationToken ? { presentationToken } : { prospectId },
      agent,
      via === 'button' ? 'agent_button' : 'agent_scan'
    );
    return res.json({
      success: true,
      already: result.already,
      entitlementId: result.entitlement.id,
      status: result.entitlement.status,
      tokenHint: result.entitlement.tokenHint,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) throw err;
    return res.status(code).json({ success: false, error: err.message });
  }
}));

export default router;
