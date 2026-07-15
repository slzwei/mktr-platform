import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/deviceController.js';

export const meta = { path: '/api/devices', flag: 'FLEET_ROUTES_ENABLED' };

const router = express.Router();

// Middleware: All routes require Admin access
router.use(authenticateToken, requireAdmin);

// GET /api/devices - List all devices
router.get('/', ctrl.listDevices);

// GET /api/devices/:id - Get single device details
router.get('/:id', ctrl.getDevice);

// GET /api/devices/:id/logs - Get device logs/events (Merged History)
router.get('/:id/logs', ctrl.getDeviceLogs);

// PATCH /api/devices/:id - Update device (Assign Campaign)
router.patch('/:id', ctrl.updateDevice);

export default router;
