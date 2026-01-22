import express from 'express';
import { authenticateDevice, guardFlags } from '../middleware/deviceAuth.js';
import { pushService } from '../services/pushService.js';

import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Middleware to allow SSE connection with Token in Query Param
const allowQueryToken = (req, res, next) => {
    if (req.query.token && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
};

// GET /api/devices/events
// SSE Stream Endpoint for Tablets (Device Auth)
router.get('/', guardFlags('MANIFEST_ENABLED'), authenticateDevice, (req, res) => {
    // SSE Headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Important for Nginx proxying
    });

    const deviceId = req.device.id;
    pushService.addClient(deviceId, res);
});

// GET /api/devices/events/:id/logs/stream
// SSE Stream Endpoint for Admins (User Auth)
router.get('/:id/logs/stream', allowQueryToken, authenticateToken, requireAdmin, (req, res) => {
    const deviceId = req.params.id;

    // SSE Headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders(); // Ensure headers are sent immediately

    pushService.addObserver(deviceId, res);
});

// GET /api/devices/events/fleet/stream
// SSE Stream Endpoint for Fleet Status Updates (Admin Auth)
router.get('/fleet/stream', allowQueryToken, authenticateToken, requireAdmin, (req, res) => {
    // SSE Headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    pushService.addFleetObserver(res);
});

export default router;
