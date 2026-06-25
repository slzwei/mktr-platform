/**
 * MKTR Leads (external buyer app) → held-lead dispatch queue.
 *
 * Mounted at `/api/external/held-leads`. Auth is HMAC-SHA256 over the raw body
 * (EXTERNAL_APP_SECRET) — see externalHeldLeadsController. rawBody capture and the
 * rate-limiter exemption for the `/api/external/` prefix are wired in
 * server_internal.js, same as /api/external/lead-outcomes.
 *
 * Gated behind HELD_LEADS_EXTERNAL_ENABLED so the route stays UNMOUNTED until the
 * secret + the mktr-leads broker edge function are provisioned (deploy-inert).
 */
import express from 'express';
import { listHeldLeads, assignHeldLead } from '../controllers/externalHeldLeadsController.js';

const router = express.Router();

export const meta = { path: '/api/external/held-leads', flag: 'HELD_LEADS_EXTERNAL_ENABLED', flagDefault: 'false' };

// POST (not GET) so the body carries the signed `timestamp` the HMAC freshness
// check reads — consistent with /api/external/lead-outcomes.
router.post('/', listHeldLeads);
router.post('/assign', assignHeldLead);

export default router;
