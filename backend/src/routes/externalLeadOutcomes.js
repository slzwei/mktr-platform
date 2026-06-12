/**
 * MKTR Leads (external buyer app) → MKTR push channel for lead outcomes.
 *
 * Mounted at `/api/external/lead-outcomes` (POST). Auth is HMAC-SHA256 over the
 * raw body (EXTERNAL_OUTCOME_WEBHOOK_SECRET), NOT the platform JWT — the caller
 * is the mktr-leads report-lead-outcome edge function, fired by a Postgres
 * trigger on that project's `leads.status`. Raw-body capture and the
 * rate-limiter exemption for the `/api/external/` prefix are wired in
 * server_internal.js.
 *
 * Kept separate from `/api/integrations/lyfe/lead-outcome`: that channel is the
 * Lyfe (internal-agent) app driving Meta CAPI conversions, with a different
 * secret and signature scheme. This one mirrors buyer status onto the Prospect
 * for billing/dispute reconciliation.
 */

import express from 'express';
import { handleExternalLeadOutcome } from '../controllers/externalLeadOutcomeController.js';

export const meta = { path: '/api/external' };

const router = express.Router();

router.post('/lead-outcomes', express.json({ limit: '64kb' }), handleExternalLeadOutcome);

export default router;
