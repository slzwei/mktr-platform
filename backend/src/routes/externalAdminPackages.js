/**
 * MKTR Leads admin app → lead-packages (catalog + per-agent assignments).
 *
 * Mounted at `/api/external/admin-packages`. Auth is HMAC-SHA256 over the raw body
 * (EXTERNAL_APP_SECRET) — see externalAdminPackagesController. rawBody capture and the
 * rate-limiter exemption for the `/api/external/` prefix are wired in server_internal.js,
 * same as /api/external/held-leads + /api/external/admin-lead-ops.
 *
 * Gated behind ADMIN_PACKAGES_EXTERNAL_ENABLED so the route stays UNMOUNTED until the
 * secret + the mktr-leads broker edge function are provisioned (deploy-inert). The
 * route auto-loader (routes/index.js) only mounts modules exporting BOTH `meta` and a
 * default router.
 */
import express from 'express';
import {
  requireExternalHmac,
  catalogList,
  catalogCreate,
  catalogUpdate,
  catalogDelete,
  assignmentsList,
  assignmentsAssign,
  assignmentsTopup,
  assignmentsCancel,
  assignmentsRemove,
  campaignsList,
} from '../controllers/externalAdminPackagesController.js';

const router = express.Router();

export const meta = {
  path: '/api/external/admin-packages',
  flag: 'ADMIN_PACKAGES_EXTERNAL_ENABLED',
  flagDefault: 'false',
};

// Shared HMAC + freshness gate for every action below.
router.use(requireExternalHmac);

// POST (not GET) so the body carries the signed `timestamp` the HMAC freshness check
// reads — consistent with the other /api/external/ surfaces.
router.post('/catalog', catalogList);
router.post('/catalog/create', catalogCreate);
router.post('/catalog/update', catalogUpdate);
router.post('/catalog/delete', catalogDelete); // archive-if-assignments-else-delete
router.post('/assignments', assignmentsList);
router.post('/assignments/assign', assignmentsAssign);
router.post('/assignments/topup', assignmentsTopup);
router.post('/assignments/cancel', assignmentsCancel);
router.post('/assignments/remove', assignmentsRemove);
router.post('/campaigns', campaignsList);

export default router;
