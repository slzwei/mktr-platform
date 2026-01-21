import express from 'express';
import { authenticateDevice, guardFlags } from '../middleware/deviceAuth.js';
import { pushService } from '../services/pushService.js';

const router = express.Router();

// GET /api/devices/events
// SSE Stream Endpoint for Tablets
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

export default router;
