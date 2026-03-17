import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/webhookAdminController.js';

export const meta = { path: '/api/admin/webhooks' };

const router = express.Router();

// All routes require admin auth
router.use(authenticateToken, requireAdmin);

// --- Subscriber CRUD ---
router.get('/subscribers', ctrl.listSubscribers);
router.post('/subscribers', ctrl.createSubscriber);
router.put('/subscribers/:id', ctrl.updateSubscriber);
router.delete('/subscribers/:id', ctrl.deleteSubscriber);

// --- Delivery management ---
router.get('/deliveries', ctrl.listDeliveries);

// --- Dead-letter queue (must be before :id routes) ---
router.get('/deliveries/dead-letter', ctrl.listDeadLetters);
router.post('/deliveries/dead-letter/purge', ctrl.purgeDeadLetterQueue);
router.post('/deliveries/retry-all', ctrl.retryAllFailedDeliveries);

// --- Delivery stats ---
router.get('/stats', ctrl.getStats);

// --- Parameterized delivery routes (must be after static paths) ---
router.get('/deliveries/:id', ctrl.getDelivery);
router.post('/deliveries/:id/retry', ctrl.retrySingleDelivery);

export default router;
