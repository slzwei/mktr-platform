import express from 'express';
const router = express.Router();

/**
 * GET /api/time
 * Returns the current server time in Unix Milliseconds.
 * Used for "Protocol V3" synchronization (RTT Calculation).
 * Must not be cached.
 */
router.get('/time', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({
        server_unix_ms: Date.now()
    });
});

export default router;
