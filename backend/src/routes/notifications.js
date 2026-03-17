import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as ctrl from '../controllers/notificationController.js';

export const meta = { path: '/api/notifications' };

const router = express.Router();

// GET /api/notifications
router.get('/', authenticateToken, asyncHandler(ctrl.listNotifications));

export default router;
