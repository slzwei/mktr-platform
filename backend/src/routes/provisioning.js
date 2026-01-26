import express from 'express';
import crypto from 'crypto';
import { ProvisioningSession, Device } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { Op } from 'sequelize';

const router = express.Router();

// 1. Tablet: Create a new provisional session
// No auth required (tablet is not yet provisioned)
router.post('/session', async (req, res) => {
    try {
        const { sessionCode, ipAddress } = req.body;

        if (!sessionCode) {
            return res.status(400).json({ message: 'sessionCode (UUID) is required' });
        }

        // Create session with 1 hour expiry
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await ProvisioningSession.create({
            sessionCode,
            ipAddress: ipAddress || req.ip,
            status: 'pending',
            expiresAt
        });

        res.json({ success: true, expiresAt });
    } catch (error) {
        // Handle duplicate UUID gracefully (idempotency-ish)
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.json({ success: true, message: 'Session already exists' });
        }
        console.error('Error creating provisioning session:', error);
        res.status(500).json({ message: 'Internal Error' });
    }
});

// 2. Tablet: Poll for status
// No auth required
router.get('/check/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const session = await ProvisioningSession.findOne({
            where: { sessionCode: code }
        });

        if (!session) {
            return res.status(404).json({ status: 'not_found' });
        }

        if (new Date() > session.expiresAt) {
            return res.json({ status: 'expired' });
        }

        if (session.status === 'fulfilled') {
            return res.json({
                status: 'fulfilled',
                deviceKey: session.deviceKey
            });
        }

        res.json({ status: 'pending' });
    } catch (error) {
        console.error('Error polling session:', error);
        res.status(500).json({ message: 'Internal Error' });
    }
});

// 3. Admin: Fulfill the session (Submit Key)
// REQUIRED: Admin Auth
router.post('/fulfill', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { sessionCode, deviceKey } = req.body;

        if (!sessionCode || !deviceKey) {
            return res.status(400).json({ message: 'sessionCode and deviceKey are required' });
        }

        const session = await ProvisioningSession.findOne({
            where: { sessionCode }
        });

        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        if (new Date() > session.expiresAt) {
            return res.status(400).json({ message: 'Session expired' });
        }

        if (session.status === 'fulfilled') {
            return res.status(400).json({ message: 'Session already fulfilled' });
        }

        // Validate Key Exists
        if (typeof deviceKey !== 'string') {
            return res.status(400).json({ message: 'Invalid deviceKey format' });
        }

        let secretHash;
        try {
            secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');
        } catch (error) {
            console.error('Hashing error:', error);
            return res.status(500).json({ message: 'Internal server error processing key' });
        }
        const device = await Device.findOne({ where: { secretHash } });

        if (!device) {
            return res.status(400).json({ message: 'Invalid Device Key. Device must be registered first.' });
        }

        await session.update({
            status: 'fulfilled',
            deviceKey
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Error fulfilling session:', error);
        res.status(500).json({ message: 'Error fulfilling session' });
    }
});

export default router;
