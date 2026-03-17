import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import * as retellController from '../controllers/retellController.js';

export const meta = { path: '/api/retell' };

const router = Router();

// POST /api/retell/webhook — Retell AI post-call webhook
router.post('/webhook', retellController.handleWebhook);

// GET /api/retell/recording/:prospectId — Retell call recording URL
router.get('/recording/:prospectId', authenticateToken, retellController.fetchRecordingUrl);

export default router;
