/**
 * MKTR Leads (external buyer app) → a lead's MKTR activity history.
 *
 * Mounted at `/api/external/lead-activities`. Auth is HMAC-SHA256 over the raw body
 * (EXTERNAL_APP_SECRET) — see externalLeadActivitiesController. rawBody capture + the
 * rate-limiter exemption for `/api/external/` are wired in server_internal.js, same as
 * /api/external/held-leads.
 *
 * Gated behind LEAD_TIMELINE_EXTERNAL_ENABLED so the route stays UNMOUNTED until the
 * mktr-leads broker edge function is provisioned (deploy-inert).
 */
import express from 'express';
import { listLeadActivities } from '../controllers/externalLeadActivitiesController.js';

const router = express.Router();

export const meta = { path: '/api/external/lead-activities', flag: 'LEAD_TIMELINE_EXTERNAL_ENABLED', flagDefault: 'false' };

// POST so the body carries the signed `timestamp` the HMAC freshness check reads.
router.post('/', listLeadActivities);

export default router;
