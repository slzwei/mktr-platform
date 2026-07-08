import { authenticateToken } from './auth.js';
import { hasCapability, isRedeemOpsUser } from '../services/redeemOps/permissions.js';

/**
 * Capability gate for the Redeem Ops namespace (docs/redeem-ops/PERMISSION_MATRIX.md §3).
 *
 *   router.get('/team', requireRedeemOps('analytics.view_team'), handler)
 *
 * Semantics:
 *   - role='admin'            → pass (implicit super_admin)
 *   - role='redeem_ops' or a granted redeemOpsRole → pass iff EVERY named capability
 *     is in the user's sub-role capability set (permissions.js)
 *   - anyone else             → 403
 *
 * Zero capabilities (`requireRedeemOps()`) = "any authenticated Redeem Ops principal"
 * (used by /meta/constants). Row-level "own" scoping is enforced in services, not here.
 * Existing MKTR gates (requireRole/requireAdmin) are untouched — this middleware can
 * only ever be MORE restrictive than authenticateToken, never looser.
 */
export const requireRedeemOps = (...capabilities) => [
  authenticateToken,
  (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (user.role === 'admin') return next();
    if (!isRedeemOpsUser(user)) {
      return res.status(403).json({ success: false, message: 'Redeem Ops access required' });
    }
    const denied = capabilities.find((c) => !hasCapability(user, c));
    if (denied) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    return next();
  },
];
