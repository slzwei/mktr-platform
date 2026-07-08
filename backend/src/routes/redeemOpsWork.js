import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/workController.js';

/**
 * Redeem Ops Phase 3 — queue, tasks, pools, team pipeline
 * (docs/redeem-ops/ROUTE_MAP.md §1). Flag + host-guard posture as siblings.
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// My Outreach Queue — every ops principal has a queue
router.get('/queue', requireRedeemOps('analytics.view_own'), ctrl.getMyQueue);

// Team pipeline board (managers/analysts)
router.get('/team/pipeline', requireRedeemOps('pipeline.view_team'), ctrl.getTeamPipeline);

// Tasks (row-level own/team scoping inside taskService)
router.get('/tasks', requireRedeemOps('tasks.manage'), ctrl.listTasks);
router.post('/tasks', requireRedeemOps('tasks.manage'), ctrl.createTask);
router.patch('/tasks/:taskId', requireRedeemOps('tasks.manage'), ctrl.updateTask);

// Prospecting pools — reading + claim-next for execs; management for bdm+
router.get('/pools', requireRedeemOps('pools.claim_next'), ctrl.listPools);
router.post('/pools', requireRedeemOps('pools.manage'), ctrl.createPool);
router.patch('/pools/:poolId', requireRedeemOps('pools.manage'), ctrl.updatePool);
router.post('/pools/:poolId/members', requireRedeemOps('pools.manage'), ctrl.addPoolMembers);
router.post('/pools/:poolId/claim-next', requireRedeemOps('pools.claim_next'), ctrl.claimNext);

export default router;
