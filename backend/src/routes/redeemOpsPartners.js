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
router.get('/partners/:id', requireRedeemOps('partners.view'), ctrl.getPartner);
router.put('/partners/:id', requireRedeemOps('partners.edit'), ctrl.updatePartner);

// Ownership
router.post('/partners/:id/claim', requireRedeemOps('partners.claim'), ctrl.claimPartner);
router.post('/partners/:id/release', requireRedeemOps('partners.release'), ctrl.releasePartner);
router.post('/partners/:id/assign', requireRedeemOps('partners.reassign'), ctrl.assignPartner);

// Pipeline
router.patch('/partners/:id/stage', requireRedeemOps('pipeline.move'), ctrl.changeStage);
router.post('/partners/:id/stage/undo', requireRedeemOps('pipeline.move'), ctrl.undoStage);

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

// Contacts
router.post('/partners/:id/contacts', requireRedeemOps('contacts.manage'), ctrl.addContact);
router.patch('/contacts/:contactId', requireRedeemOps('contacts.manage'), ctrl.updateContact);
router.post('/contacts/:contactId/archive', requireRedeemOps('contacts.manage'), ctrl.archiveContact);

// Locations
router.post('/partners/:id/locations', requireRedeemOps('locations.manage'), ctrl.addLocation);
router.patch('/locations/:locationId', requireRedeemOps('locations.manage'), ctrl.updateLocation);

export default router;
