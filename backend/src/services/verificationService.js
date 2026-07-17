import crypto from 'crypto';
import fetch from 'node-fetch';
import { Campaign, Verification } from '../models/index.js';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { markPhoneVerified } from './verifiedPhoneStore.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';

// AWS SNS SMS config. The region + sender ID must match our SSIR-registered
// identity in AWS, or Singapore telcos relabel the sender as "Likely-SCAM".
// "MKTR" is the SSIR-registered sender ID (Live, case-sensitive) and it is
// registered in ap-southeast-1 — both are defaulted here so a missing env var
// can't silently regress OTP SMS back to the scam label. Kept in lock-step with
// lyfe-app's custom-sms-hook, which hardcodes the same "MKTR" / ap-southeast-1.
const SMS_REGION = process.env.AWS_REGION || 'ap-southeast-1';
const SMS_SENDER_ID = process.env.AWS_SNS_SENDER_ID || 'MKTR';

// Initialize SNS Client
const snsClient = new SNSClient({
  region: SMS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Meta WhatsApp Graph API config (version aligned with metaCapiService.js; all overridable via env)
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const WA_TEMPLATE_NAME = process.env.META_WA_TEMPLATE_NAME || 'auth_otp';
const WA_TEMPLATE_LANG = process.env.META_WA_TEMPLATE_LANG || 'en_US';

// Helper to generate 6-digit code using cryptographically secure randomness
const generateCode = () => crypto.randomInt(100000, 1000000).toString();

// Helper to send WhatsApp via Meta Graph API
const sendWhatsAppOtpMeta = async (phone, code) => {
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID;
  const accessToken = process.env.META_WA_ACCESS_TOKEN;

  if (!phoneId || !accessToken) {
    throw new Error('Meta WhatsApp credentials missing');
  }

  const to = phone.replace('+', '');
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: WA_TEMPLATE_NAME,
      language: { code: WA_TEMPLATE_LANG },
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

// Helper to send OTP via SMS (AWS SNS)
const sendSmsOtp = async (fullPhone, code) => {
  const messageAttributes = {
    'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    // Always attach the registered sender ID (defaults to "MKTR") so SG telcos
    // don't relabel the message "Likely-SCAM". See SMS_SENDER_ID above.
    'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: SMS_SENDER_ID }
  };
  const command = new PublishCommand({
    PhoneNumber: fullPhone,
    Message: `Your verification code is: ${code}`,
    MessageAttributes: messageAttributes
  });
  const response = await snsClient.send(command);
  return response.MessageId;
};

/**
 * Send a verification code via SMS or WhatsApp.
 */
export async function sendVerificationCode({ phone, countryCode = '+65', campaignId }) {
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
  let channel = 'sms';
  if (campaignId) {
    const campaign = await Campaign.findByPk(campaignId);
    // Version-aware: v2 docs store the channel at form.verification —
    // readLegacyViewSafe flattens either version; fail-safe default is SMS.
    const design = readLegacyViewSafe(campaign?.design_config, { otpChannel: 'sms' });
    if (design.otpChannel === 'whatsapp') {
      channel = 'whatsapp';
    }
  }

  logger.info('Sending OTP', { channel: channel.toUpperCase() });

  try {
    // 1. Save to DB (upsert) - Expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Verification.upsert({
      phone: fullPhone,
      code,
      expiresAt,
      attempts: 0
    });

    // 2. Send via channel. WhatsApp degrades gracefully to SMS so a Meta
    //    misconfig (missing creds, unapproved template) never blocks the user.
    let messageId;
    let sentChannel = channel;

    if (channel === 'whatsapp') {
      try {
        const waResponse = await sendWhatsAppOtpMeta(fullPhone, code);
        messageId = waResponse.messages?.[0]?.id;
        logger.info('WhatsApp sent', { phone: fullPhone, messageId });
      } catch (waErr) {
        logger.error('WhatsApp OTP failed — falling back to SMS', {
          error: waErr?.message || String(waErr)
        });
        sentChannel = 'sms';
        messageId = await sendSmsOtp(fullPhone, code);
        logger.info('SMS sent (WhatsApp fallback)', { phone: fullPhone, messageId });
      }
    } else {
      messageId = await sendSmsOtp(fullPhone, code);
      logger.info('SMS sent', { phone: fullPhone, messageId });
    }

    return { status: 'pending', messageId, channel: sentChannel };
  } catch (err) {
    logger.error('Failed to send OTP', { channel, error: err?.message || String(err) });
    throw new AppError(`Failed to send code: ${err.message}`, 500);
  }
}

/**
 * Check a verification code against the stored record.
 */
export async function checkVerificationCode({ phone, code, countryCode = '+65' }) {
  if (!phone || !code) throw new AppError('Phone and code are required', 400);

  const fullPhone = `${countryCode}${phone}`;

  const record = await Verification.findByPk(fullPhone);

  if (!record) {
    return {
      valid: false,
      reason: 'not_found',
      message: 'Verification code not found or expired'
    };
  }

  // Check max attempts
  if (record.attempts >= 5) {
    await record.destroy();
    return {
      valid: false,
      reason: 'max_attempts',
      message: 'Too many failed attempts. Request a new code.'
    };
  }

  // Check expiration
  if (new Date() > record.expiresAt) {
    await record.destroy();
    return {
      valid: false,
      reason: 'expired',
      message: 'Verification code expired'
    };
  }

  // Check code match
  if (record.code !== code) {
    record.attempts += 1;
    await record.save();
    return {
      valid: false,
      reason: 'mismatch',
      message: 'Invalid verification code'
    };
  }

  // Valid — stamp a short-lived "recently verified" marker (BEFORE destroying the
  // single-use row) so the DNC consent-gate check (POST /api/dnc/check) can confirm the
  // caller controls this number without re-reading the now-destroyed row. See
  // verifiedPhoneStore.js. Then destroy the row to prevent code reuse.
  markPhoneVerified(fullPhone);
  await record.destroy();

  return {
    valid: true,
    status: 'approved',
    verified: true
  };
}
