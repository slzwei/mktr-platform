import crypto from 'crypto';
import { Device } from '../models/index.js';

export async function authenticateDevice(req, res, next) {
  // console.log('Heads:', req.headers); 
  try {
    const deviceKey = req.headers['x-device-key'];
    // DEBUG LOG
    if (req.originalUrl.includes('/api/adtech')) {
      console.log(`[AdTech Auth] ${req.method} ${req.originalUrl} - Key: ${deviceKey ? (deviceKey.substring(0, 4) + '...') : 'MISSING'}`);
    }

    if (!deviceKey) {
      console.warn('[AdTech Auth] Missing X-Device-Key');
      return res.status(400).json({ success: false, message: 'Missing X-Device-Key' });
    }
    const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');
    const device = await Device.findOne({ where: { secretHash } });
    if (!device) {
      console.warn(`[AdTech Auth] Device not found for key hash: ${secretHash.substring(0, 8)}...`);
      return res.status(401).json({ success: false, message: 'Unauthorized device' });
    }
    const allowedStatuses = ['active', 'playing', 'idle', 'inactive', 'standby', 'offline'];
    if (!allowedStatuses.includes(device.status)) {
      return res.status(403).json({ success: false, message: 'Device disabled' });
    }
    req.device = device;
    return next();
  } catch (e) {
    return next(e);
  }
}

export function guardFlags(flagName) {
  return function (req, res, next) {
    const val = String(process.env[flagName] || 'false').toLowerCase();
    if (val !== 'true') {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return next();
  };
}


