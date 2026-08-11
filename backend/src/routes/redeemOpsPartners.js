import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/partnersController.js';

/**
 * Redeem Ops Phase 2 — Partner CRM (docs/redeem-ops/ROUTE_MAP.md §1).
 * Same flag + host-guard posture as redeemOpsAdmin.js. Capability names map to
 * docs/redeem-ops/PERMISSION_MATRIX.md; row-level "own" scoping is enforced in
 * partnerService/claimService, not here.
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// Partners
router.get('/partners', requireRedeemOps('partners.view'), ctrl.listPartners);
router.get('/partners/check-duplicates', requireRedeemOps('partners.create'), ctrl.checkDuplicates);
router.post('/partners', requireRedeemOps('partners.create'), ctrl.createPartner);
router.post('/partners/import', requireRedeemOps('partners.import'), ctrl.importPartners);
router.get('/partners/:id', requireRedeemOps('partners.view'), ctrl.getPartner);
router.put('/partners/:id', requireRedeemOps('partners.edit'), ctrl.updatePartner);

// Ownership
// The bulk-* routes sit BEFORE the :id routes — 'bulk-claim' would otherwise
// match as an :id and 404 on a uuid lookup. Each carries the SAME capability as
// its single-row sibling, so multi-select can never be a way around a gate.
router.post('/partners/bulk-claim', requireRedeemOps('partners.claim'), ctrl.claimPartnersBulk);
router.post('/partners/bulk-release', requireRedeemOps('partners.release'), ctrl.releasePartnersBulk);
router.post('/partners/bulk-assign', requireRedeemOps('partners.reassign'), ctrl.assignPartnersBulk);
router.post('/partners/:id/claim', requireRedeemOps('partners.claim'), ctrl.claimPartner);
router.post('/partners/:id/release', requireRedeemOps('partners.release'), ctrl.releasePartner);
router.post('/partners/:id/assign', requireRedeemOps('partners.reassign'), ctrl.assignPartner);

// Pipeline
// POST, not PATCH like the single-row move: this is one action over many rows,
// and it keeps the whole bulk-* family on one verb.
router.post('/partners/bulk-stage', requireRedeemOps('pipeline.move'), ctrl.changeStageBulk);
router.patch('/partners/:id/stage', requireRedeemOps('pipeline.move'), ctrl.changeStage);
router.post('/partners/:id/stage/undo', requireRedeemOps('pipeline.move'), ctrl.undoStage);
router.post('/partners/:id/snooze', requireRedeemOps('pipeline.move'), ctrl.snoozePartner);
router.post('/partners/:id/unsnooze', requireRedeemOps('pipeline.move'), ctrl.unsnoozePartner);

// Merge (destructive-adjacent — ops_admin+)
router.post('/partners/:id/merge', requireRedeemOps('partners.merge'), ctrl.mergePartners);
// Mistake-eraser only: service refuses PARTNERED rows and anything with
// rewards/activations (DB RESTRICT backs it). Real duplicates → merge.
router.delete('/partners/:id', requireRedeemOps('partners.delete'), ctrl.deletePartner);

// Timeline + activities
router.get('/partners/:id/timeline', requireRedeemOps('partners.view'), ctrl.getTimeline);
router.post('/partners/:id/activities', requireRedeemOps('activities.log'), ctrl.logActivity);
router.patch('/activities/:activityId', requireRedeemOps('activities.edit'), ctrl.editActivity);
router.post('/activities/:activityId/void', requireRedeemOps('activities.edit'), ctrl.voidActivity);
// Hiding stage/assignment/audit/task entries is custodial work — same tier
// as deleting the business itself.
router.post('/partners/:id/timeline/hide', requireRedeemOps('partners.delete'), ctrl.hideTimelineEntry);

// Contacts
router.post('/partners/:id/contacts', requireRedeemOps('contacts.manage'), ctrl.addContact);
router.patch('/contacts/:contactId', requireRedeemOps('contacts.manage'), ctrl.updateContact);
router.post('/contacts/:contactId/archive', requireRedeemOps('contacts.manage'), ctrl.archiveContact);

// Locations
router.post('/partners/:id/locations', requireRedeemOps('locations.manage'), ctrl.addLocation);
router.patch('/locations/:locationId', requireRedeemOps('locations.manage'), ctrl.updateLocation);

export default router;
