import { Router } from 'express';
import * as metaController from '../controllers/metaController.js';

export const meta = { path: '/api/meta' };

const router = Router();

// GET /api/meta/webhook — Meta verification challenge
router.get('/webhook', metaController.verifyWebhook);

// POST /api/meta/webhook — Meta leadgen webhook events
router.post('/webhook', metaController.handleWebhook);

export default router;
