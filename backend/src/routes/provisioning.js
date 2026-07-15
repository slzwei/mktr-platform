import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as provisioningController from '../controllers/provisioningController.js';

export const meta = { path: '/api/provision', flag: 'FLEET_ROUTES_ENABLED' };

const router = express.Router();

// Rate limit unauthenticated provisioning endpoints
const provisionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many provisioning requests, try again later' }
});

// 1. Tablet: Create a new provisional session (no auth — tablet not yet provisioned)
router.post('/session', provisionLimiter, provisioningController.createSession);

// 2. Tablet: Poll for status (no auth)
router.get('/check/:code', provisionLimiter, provisioningController.checkSession);

// 3. Admin: Fulfill the session (Submit Key)
router.post('/fulfill', authenticateToken, requireAdmin, provisioningController.fulfillSession);

export default router;
