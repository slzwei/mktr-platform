import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as metaController from '../controllers/metaController.js';

/**
 * Meta Lead Ads ingestion (docs/plans/meta-lead-ads-native-pipe.md).
 *
 * PUBLIC webhook pair, signature-authenticated inside the handler (Meta sends
 * no bearer): GET is the hub.challenge handshake, POST verifies
 * X-Hub-Signature-256 over req.rawBody (server_internal.js captures raw
 * bytes for /api/meta/) and only upserts durable inbox rows. Everything else
 * is admin-only. The whole surface mounts only when META_LEAD_ADS_ENABLED —
 * envValidation refuses a production boot with the flag on and secrets
 * missing.
 */
export const meta = {
  path: '/api/meta',
  flag: 'META_LEAD_ADS_ENABLED',
  flagDefault: 'false',
  public: ['GET /webhook', 'POST /webhook'],
};

const router = express.Router();

router.get('/webhook', metaController.verifyWebhook);
router.post('/webhook', metaController.handleWebhook);

router.post('/pages', authenticateToken, requireAdmin, metaController.upsertPage);
router.get('/pages', authenticateToken, requireAdmin, metaController.listPages);

router.post('/form-mappings', authenticateToken, requireAdmin, metaController.createFormMapping);
router.get('/form-mappings', authenticateToken, requireAdmin, metaController.listFormMappings);
router.patch('/form-mappings/:formId', authenticateToken, requireAdmin, metaController.updateFormMapping);

router.get('/inbox', authenticateToken, requireAdmin, metaController.listInbox);
router.post('/inbox/:leadgenId/retry', authenticateToken, requireAdmin, metaController.retryInboxRow);

export default router;
