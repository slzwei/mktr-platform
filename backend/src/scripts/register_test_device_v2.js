
import crypto from 'crypto';
import { sequelize } from '../database/connection.js';
import { Device } from '../models/index.js';
import dotenv from 'dotenv';
dotenv.config();

const registerTestDevice = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to DB');

        const deviceKey = 'test-device-key';
        const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');

        // Check if exists
        const existing = await Device.findOne({ where: { secretHash } });
        if (existing) {
            console.log('⚠️ Device with this key already exists:', existing.id);
        } else {
            const newDevice = await Device.create({
                secretHash,
                status: 'active',
                lastSeenAt: new Date()
            });
            console.log('✅ Registered test device:', newDevice.id);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

registerTestDevice();
