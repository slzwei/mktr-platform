import express from 'express';
import { requireExternalHmac, facebookConnect } from '../controllers/externalFacebookConnectController.js';

/**
 * mktr-leads app broker endpoint for Connect Facebook
 * (docs/plans/facebook-connect-self-serve.md §2). Signed raw-body POSTs only
 * (shared requireExternalHmac gate: X-Webhook-Signature over rawBody +
 * body.timestamp freshness). Flag-gated with the OAuth feature.
 */
// Mounted with the LEAD-ADS flag (review F17): when OAuth is off the app
// must receive a clean `{enabled:false}` from `status`, never a 404 that is
// indistinguishable from an outage.
export const meta = {
  path: '/api/external/facebook-connect',
  flag: 'META_LEAD_ADS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

router.post('/', requireExternalHmac, facebookConnect);

export default router;
