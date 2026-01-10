import express from 'express';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { Verification } from '../models/index.js';

const router = express.Router();

// Initialize SNS Client
const snsClient = new SNSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Helper to generate 6-digit code
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Send verification code
router.post('/send', asyncHandler(async (req, res) => {
  const { phone, countryCode = '+65' } = req.body;
  if (!phone) throw new AppError('Phone is required', 400);

  const fullPhone = `${countryCode}${phone}`;
  const code = generateCode();

  // Log environment variables for debugging (obscured)
  console.log('Sending SMS via AWS SNS...');
  console.log('Region:', process.env.AWS_REGION);
  console.log('AccessKeyId Present:', !!process.env.AWS_ACCESS_KEY_ID);


  try {
    // 1. Save to DB (upsert)
    // Expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Verification.upsert({
      phone: fullPhone,
      code,
      expiresAt,
      attempts: 0
    });

    // 2. Send via SNS
    const command = new PublishCommand({
      PhoneNumber: fullPhone,
      Message: `Your verification code is: ${code}`,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional' // Critical for delivery speed
        }
      }
    });

    const response = await snsClient.send(command);
    console.log(`✅ SMS sent to ${fullPhone}, MessageId: ${response.MessageId}`);

    res.json({ success: true, data: { status: 'pending', messageId: response.MessageId } });
  } catch (err) {
    console.error('❌ Failed to send SMS:', err);
    throw new AppError(`Failed to send code: ${err.message}`, 500);
  }
}));

// Check verification code
router.post('/check', asyncHandler(async (req, res) => {
  const { phone, code, countryCode = '+65' } = req.body;
  if (!phone || !code) throw new AppError('Phone and code are required', 400);

  const fullPhone = `${countryCode}${phone}`;

  const record = await Verification.findByPk(fullPhone);

  if (!record) {
    return res.status(400).json({
      success: false,
      message: 'Verification code not found or expired',
      valid: false
    });
  }

  // Check expiration
  if (new Date() > record.expiresAt) {
    await record.destroy();
    return res.status(400).json({
      success: false,
      message: 'Verification code expired',
      valid: false
    });
  }

  // Check code match
  if (record.code !== code) {
    // Increment attempts
    record.attempts += 1;
    await record.save();
    return res.status(400).json({
      success: false,
      message: 'Invalid verification code',
      valid: false
    });
  }

  // Valid!
  // Optional: Delete record after successful verification to prevent reuse
  // Or keep it for a short time if needed for idempotent checks
  await record.destroy();

  res.json({ success: true, data: { status: 'approved', verified: true } });
}));

export default router;
