import { Router } from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import * as retellController from '../controllers/retellController.js';

export const meta = {
  path: '/api/retell',
  // Public routes (default-deny routing): Retell webhook — HMAC verified inside the handler
  public: ['POST /webhook'],
};

const router = Router();

// POST /api/retell/webhook — Retell AI post-call webhook
router.post('/webhook', retellController.handleWebhook);

// GET /api/retell/recording/:prospectId — Retell call recording URL.
// Role gate + owner scope (P1-4): a recording is PDPA-regulated call content,
// so this matches the other prospect reads instead of accepting any session.
router.get('/recording/:prospectId', authenticateToken, requireAgentOrAdmin, retellController.fetchRecordingUrl);

export default router;
