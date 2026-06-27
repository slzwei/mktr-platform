/**
 * MKTR Leads admin app → lead-ops (reassign / return-to-held).
 *
 * Mounted at `/api/external/admin-lead-ops`. Auth is HMAC-SHA256 over the raw body
 * (EXTERNAL_APP_SECRET) — see externalAdminLeadOpsController. rawBody capture and the
 * rate-limiter exemption for the `/api/external/` prefix are wired in server_internal.js,
 * same as /api/external/held-leads + /api/external/lead-outcomes.
 *
 * Gated behind ADMIN_LEAD_OPS_EXTERNAL_ENABLED so the route stays UNMOUNTED until the secret +
 * the mktr-leads broker edge function are provisioned (deploy-inert).
 */
import express from 'express';
import { reassignLead, returnToHeld } from '../controllers/externalAdminLeadOpsController.js';

const router = express.Router();

export const meta = {
  path: '/api/external/admin-lead-ops',
  flag: 'ADMIN_LEAD_OPS_EXTERNAL_ENABLED',
  flagDefault: 'false'
};

// POST (not GET) so the body carries the signed `timestamp` the HMAC freshness check reads —
// consistent with /api/external/held-leads + /api/external/lead-outcomes.
router.post('/reassign', reassignLead);
router.post('/return-to-held', returnToHeld);

export default router;
