import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

const requiredEnv = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'];
const missing = requiredEnv.filter((k) => !process.env[k]);
let twilioClient = null;

if (missing.length === 0) {
  const twilioModule = await import('twilio');
  const twilio = twilioModule.default || twilioModule;
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} else {
  console.warn('⚠️  Twilio Verify not fully configured. Missing:', missing.join(', '));
}

// Send verification code
// Public endpoint for lead capture / agent invite
router.post('/send', asyncHandler(async (req, res) => {
  if (!twilioClient) throw new AppError('Verification service not configured', 500);

  const { phone, countryCode = '+65' } = req.body;
  if (!phone) throw new AppError('Phone is required', 400);

  try {
    const to = `${countryCode}${phone}`;
    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to, channel: 'sms' });

    res.json({ success: true, data: { status: verification.status } });
  } catch (err) {
    throw new AppError(`Failed to send code: ${err?.message || 'Unknown error'}`, 400);
  }
}));

// Check verification code
router.post('/check', asyncHandler(async (req, res) => {
  if (!twilioClient) throw new AppError('Verification service not configured', 500);

  const { phone, code, countryCode = '+65' } = req.body;
  if (!phone || !code) throw new AppError('Phone and code are required', 400);

  try {
    const to = `${countryCode}${phone}`;
    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to, code });

    const isVerified = check.status === 'approved';
    res.json({ success: true, data: { verified: isVerified, status: check.status } });
  } catch (err) {
    throw new AppError(`Failed to verify code: ${err?.message || 'Unknown error'}`, 400);
  }
}));

export default router;


