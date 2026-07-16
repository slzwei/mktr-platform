import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireExternalHmac } from '../controllers/externalBillingController.js';
import { User } from '../models/index.js';
import { makeWiredEntitlementService } from '../services/redeemOps/entitlementWiring.js';

/**
 * mktr-leads consultant → voucher unlock (docs/redeem-ops/MKTR_INTEGRATION.md §2).
 * Same posture as the other /api/external/* surfaces: HMAC over the raw body with
 * EXTERNAL_APP_SECRET + signed timestamp (requireExternalHmac), rawBody capture
 * and rate-limiter exemption already wired for the prefix.
 *
 * Body: { timestamp, agentMktrUserId, presentationToken?, prospectId? }
 * unlockedVia is server-derived: presentationToken ⇒ agent_scan,
 * prospectId ⇒ agent_button (a client-sent `via` is ignored).
 * The resolved mirror user must be the lead's assigned consultant.
 */
export const meta = {
  path: '/api/external/entitlements',
  flag: 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

router.post('/unlock', requireExternalHmac, asyncHandler(async (req, res) => {
  const { agentMktrUserId, presentationToken, prospectId } = req.body || {};
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
    // `via` is SERVER-derived from the identifier, never trusted from the body:
    // only a presentation token (the customer's QR pass, presented live) counts
    // as scan evidence; a bare prospectId is always the button path. Draw
    // weighting treats the two differently (docs/plans/lucky-draw-10x.md §4.4).
    const result = await makeWiredEntitlementService().unlockEntitlement(
      presentationToken ? { presentationToken } : { prospectId },
      agent,
      presentationToken ? 'agent_scan' : 'agent_button'
    );
    return res.json({
      success: true,
      already: result.already,
      // Whether a voucher email was scheduled by THIS unlock — false on
      // replay and for no-email leads (client should tell the consultant).
      emailQueued: result.emailQueued === true,
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
