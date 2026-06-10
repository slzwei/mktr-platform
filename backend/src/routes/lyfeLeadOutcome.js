/**
 * Lyfe → MKTR push channel for down-funnel lead-status changes.
 *
 * Mounted at `/api/integrations/lyfe/lead-outcome` (POST). Auth is HMAC-SHA256
 * over the raw body (LYFE_LEAD_OUTCOME_SECRET), NOT the platform JWT — this
 * endpoint is called by a Postgres trigger in Lyfe Supabase, which can't carry
 * a user JWT. Raw-body capture for the `/api/integrations/lyfe/` prefix is
 * already wired in server_internal.js.
 *
 * Shares the `/api/integrations/lyfe` mount with users-webhook; each router
 * owns its own subpath. Kept separate from `/api/lyfe/*` (that prefix applies
 * authenticateToken at router level).
 */

import express from 'express';
import { handleLyfeLeadOutcome } from '../controllers/lyfeLeadOutcomeController.js';

export const meta = { path: '/api/integrations/lyfe' };

const router = express.Router();

router.post('/lead-outcome', express.json({ limit: '64kb' }), handleLyfeLeadOutcome);

export default router;
