/**
 * MKTR Leads (external buyer app) → an agent's own lead-package balances ("My Packages").
 *
 * Mounted at `/api/external/agent-packages`. Auth is HMAC-SHA256 over the raw body
 * (EXTERNAL_APP_SECRET) — see externalAgentPackagesController. rawBody capture and the
 * rate-limiter exemption for the `/api/external/` prefix are wired in server_internal.js,
 * same as /api/external/held-leads + /api/external/lead-outcomes.
 *
 * Gated behind AGENT_PACKAGES_EXTERNAL_ENABLED so the route stays UNMOUNTED until the
 * secret + the mktr-leads broker edge function are provisioned (deploy-inert).
 */
import express from 'express';
import { listAgentPackages } from '../controllers/externalAgentPackagesController.js';

const router = express.Router();

export const meta = {
  path: '/api/external/agent-packages',
  flag: 'AGENT_PACKAGES_EXTERNAL_ENABLED',
  flagDefault: 'false'
};

// POST (not GET) so the body carries the signed `timestamp` the HMAC freshness check
// reads — consistent with /api/external/held-leads + /api/external/lead-outcomes.
router.post('/', listAgentPackages);

export default router;
