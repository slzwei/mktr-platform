import fetch from 'node-fetch';
import { Campaign, Verification } from '../models/index.js';
import express from 'express';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

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

// Helper to send WhatsApp via Meta Graph API
const sendWhatsAppOtpMeta = async (phone, code) => {
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID;
  const accessToken = process.env.META_WA_ACCESS_TOKEN;

  if (!phoneId || !accessToken) {
    throw new Error('Meta WhatsApp credentials missing');
  }

  // Remove leading '+' from phone if present, as Meta usually expects country code without + for some IDs,
  // but the ID is "PHONE_NUMBER_ID" which is the sender.
  // The "to" field usually expects bare numbers or with country code. standard is E.164 without +.
  // Our phone input is "+6591234567". Meta often accepts "6591234567".
  const to = phone.replace('+', '');

  const url = `https://graph.facebook.com/v17.0/${phoneId}/messages`;

  // Template message payload
  // Assuming a template named "verification_code" or similar exists. 
  // If not, we can try free-form text BUT that fails 24h window.
  // For now, I will assume a standard authentication template "auth_otp" with 1 variable (code).
  // Or I can use the standard "hello_world" for testing if user has no template.
  // BETTER: Use "authentication" category template.
  // Let's assume a generic one or use free-form for TESTING with a warning log.
  // User Instructions said: "Category: AUTHENTICATION to bypass window."
  // I will use a placeholder template name 'auth_code' and allow user to change it via Env if needed or hardcode standard.

  const body = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: "auth_otp", // User needs to create this or update code
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: code }
          ]
        },
        {
          type: "button",
          sub_type: "url",
          index: 0,
          parameters: [
            { type: "text", text: code }
          ]
        }
      ]
    }
  };

  // Fallback to text for testing if template fails (will likely fail 24h check but good for dev if user initiated)
  // Actually, let's stick to template payload but maybe wrap in try/catch to fallback?
  // No, let's just implement the request.

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(`Meta API Error: ${JSON.stringify(errData)}`);
  }

  return await response.json();
};

// Send verification code
router.post('/send', asyncHandler(async (req, res) => {
  const { phone, countryCode = '+65', campaignId } = req.body;
  if (!phone) throw new AppError('Phone is required', 400);

  // STRICT VALIDATION: Only allow Singapore numbers (+65)
  if (countryCode !== '+65') {
    throw new AppError('Only Singapore (+65) phone numbers are supported.', 400);
  }

  const fullPhone = `${countryCode}${phone}`;

  // Double safety check on the formatted string
  if (!fullPhone.startsWith('+65')) {
    throw new AppError('Invalid Singapore phone number format.', 400);
  }

  const code = generateCode();

  // Determine Channel
  let channel = 'sms'; // default
  if (campaignId) {
    const campaign = await Campaign.findByPk(campaignId);
    if (campaign?.design_config?.otpChannel === 'whatsapp') {
      channel = 'whatsapp';
    }
  }

  // Log environment variables for debugging (obscured)
  console.log(`Sending OTP via ${channel.toUpperCase()}...`);

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

    // 2. Send via Channel
    let messageId;
    if (channel === 'whatsapp') {
      const waResponse = await sendWhatsAppOtpMeta(fullPhone, code);
      messageId = waResponse.messages?.[0]?.id;
      console.log(`✅ WhatsApp sent to ${fullPhone}, MessageId: ${messageId}`);
    } else {
      // SMS (SNS)
      // Prepare message attributes
      const messageAttributes = {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional' // Critical for delivery speed
        }
      };

      // Add Sender ID if configured (optional)
      if (process.env.AWS_SNS_SENDER_ID) {
        messageAttributes['AWS.SNS.SMS.SenderID'] = {
          DataType: 'String',
          StringValue: process.env.AWS_SNS_SENDER_ID
        };
      }

      const command = new PublishCommand({
        PhoneNumber: fullPhone,
        Message: `Your verification code is: ${code}`,
        MessageAttributes: messageAttributes
      });
      const response = await snsClient.send(command);
      messageId = response.MessageId;
      console.log(`✅ SMS sent to ${fullPhone}, MessageId: ${messageId}`);
    }

    res.json({ success: true, data: { status: 'pending', messageId } });
  } catch (err) {
    console.error(`❌ Failed to send ${channel}:`, err);
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
