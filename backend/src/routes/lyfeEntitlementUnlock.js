import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { User } from '../models/index.js';
import { makeEntitlementService } from '../services/redeemOps/entitlementService.js';
import { logger } from '../utils/logger.js';

/**
 * Lyfe consultant → voucher unlock at the physical meeting
 * (docs/redeem-ops/MKTR_INTEGRATION.md §2 "agent-mediated unlock").
 *
 * Auth mirrors /api/integrations/lyfe/lead-outcome: HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with LYFE_LEAD_OUTCOME_SECRET (same shared secret —
 * one Lyfe→MKTR channel, one key). rawBody capture for this prefix is already
 * wired in server_internal.js; the prefix is rate-limiter-exempt.
 *
 * Body: { agentLyfeId, presentationToken? , prospectId?, via? }
 *  - scan path: presentationToken (proves the client was present)
 *  - button path: prospectId (consultant unlocks from the lead record)
 * The resolved agent must be the lead's assigned consultant.
 */
export const meta = {
  path: '/api/integrations/lyfe',
  flag: 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
  flagDefault: 'false',
};

const MAX_SKEW_MS = 7 * 24 * 60 * 60 * 1000; // matches lead-outcome tolerance

function timingSafeHexEq(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyLyfeHmac(req) {
  const secret = process.env.LYFE_LEAD_OUTCOME_SECRET;
  if (!secret) {
    logger.error('[lyfe-entitlement-unlock] LYFE_LEAD_OUTCOME_SECRET not configured');
    return false;
  }
  const timestamp = req.get('x-webhook-timestamp');
  const signature = req.get('x-webhook-signature');
  if (!timestamp || !signature || !signature.startsWith('sha256=') || !req.rawBody) return false;
  const tsMs = Date.parse(timestamp);
  if (Number.isNaN(tsMs) || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${req.rawBody}`)
    .digest('hex');
  return timingSafeHexEq(signature.slice(7), expected);
}

const router = express.Router();

router.post('/entitlement-unlock', asyncHandler(async (req, res) => {
  if (!verifyLyfeHmac(req)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  const { agentLyfeId, presentationToken, prospectId, via } = req.body || {};
  if (!agentLyfeId || (!presentationToken && !prospectId)) {
    return res.status(400).json({ success: false, message: 'agentLyfeId and presentationToken or prospectId are required' });
  }

  const agent = await User.findOne({ where: { lyfeId: String(agentLyfeId), isActive: true } });
  if (!agent) {
    return res.status(404).json({ success: false, message: 'Unknown agent' });
  }

  try {
    const result = await makeEntitlementService().unlockEntitlement(
      presentationToken ? { presentationToken } : { prospectId },
      agent,
      via === 'button' ? 'agent_button' : 'agent_scan'
    );
    return res.json({
      success: true,
      message: result.already ? 'Already unlocked' : 'Voucher unlocked — the customer has been notified',
      data: {
        already: result.already,
        entitlementId: result.entitlement.id,
        status: result.entitlement.status,
        tokenHint: result.entitlement.tokenHint,
      },
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) throw err;
    return res.status(code).json({ success: false, message: err.message });
  }
}));

export default router;
