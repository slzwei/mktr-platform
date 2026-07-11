import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/discoveryController.js';

/**
 * Redeem Ops — Discover tool (spec: ~/.claude/plans/redeem-ops-discover-tool.md).
 * Flag + host-guard posture as siblings. Search/read/enrich/dismiss are open to any
 * ops principal (paid-job cost is bounded by quotas in discoveryService, not a
 * capability); adding to the pipeline needs partners.create; the Apify webhook is
 * authenticated by a URL secret only (server-to-server, no JWT).
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// Apify terminal-event callback — secret in the URL, no JWT (must precede param routes).
router.post('/discovery/webhook/:secret', ctrl.webhook);

// Search + read (any authenticated ops principal)
router.post('/discovery/runs', requireRedeemOps(), ctrl.startDiscovery);
router.get('/discovery/runs', requireRedeemOps(), ctrl.listRuns);
router.get('/discovery/runs/:id', requireRedeemOps(), ctrl.getRun);

// Enrich + dismiss
router.post('/discovery/candidates/enrich', requireRedeemOps(), ctrl.enrichCandidates);
router.patch('/discovery/candidates/:id', requireRedeemOps(), ctrl.dismissCandidate);

// Convert candidates → partners (only create-capable roles push to the pipeline)
router.post('/discovery/runs/:id/add', requireRedeemOps('partners.create'), ctrl.addToPartners);

export default router;
