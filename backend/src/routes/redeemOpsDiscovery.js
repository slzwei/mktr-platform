import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/discoveryController.js';

/**
 * Redeem Ops — Discover tool (spec: ~/.claude/plans/redeem-ops-discover-tool.md).
 * Flag + host-guard posture as siblings. Paid search/enrichment require their
 * discovery capabilities; read/dismiss remain open to any ops principal. Adding
 * to the pipeline needs partners.create; the Apify webhook is authenticated by a
 * URL secret only (server-to-server, no JWT).
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// LLM suggestions are cheap but not free — per-user (not per-IP: staff share office
// NAT) minute window; in-memory store is fine on the single-instance backend.
const aiSuggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many AI requests. Try again in a minute.' },
});

// Apify terminal-event callback — secret in the URL, no JWT (must precede param routes).
router.post('/discovery/webhook/:secret', ctrl.webhook);

// Paid search + read
router.post('/discovery/runs', requireRedeemOps('discovery.search'), ctrl.startDiscovery);
// AI keyword suggestions — limiter AFTER the auth gate so req.user keys the window.
router.post('/discovery/suggest-terms', requireRedeemOps('discovery.search'), aiSuggestLimiter, ctrl.suggestTerms);
router.get('/discovery/runs', requireRedeemOps(), ctrl.listRuns);
router.get('/discovery/runs/:id', requireRedeemOps(), ctrl.getRun);

// Paid enrichment + dismiss
router.post('/discovery/candidates/enrich', requireRedeemOps('discovery.enrich'), ctrl.enrichCandidates);
router.patch('/discovery/candidates/:id', requireRedeemOps(), ctrl.dismissCandidate);

// Convert candidates → partners (only create-capable roles push to the pipeline)
router.post('/discovery/runs/:id/add', requireRedeemOps('partners.create'), ctrl.addToPartners);

export default router;
