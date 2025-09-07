import crypto from 'crypto';
import { Device } from '../models/index.js';

export async function authenticateDevice(req, res, next) {
  try {
    const deviceKey = req.headers['x-device-key'];
    if (!deviceKey) {
      return res.status(400).json({ success: false, message: 'Missing X-Device-Key' });
    }
    const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');
    const device = await Device.findOne({ where: { secretHash } });
    if (!device) {
      return res.status(401).json({ success: false, message: 'Unauthorized device' });
    }
    if (device.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Device disabled' });
    }
    req.device = device;
    return next();
  } catch (e) {
    return next(e);
  }
}

export function guardFlags(flagName) {
  return function(req, res, next) {
    const val = String(process.env[flagName] || 'false').toLowerCase();
    if (val !== 'true') {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return next();
  };
}


