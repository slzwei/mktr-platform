import crypto from 'crypto';
import fetch from 'node-fetch';
import { Campaign, Verification } from '../models/index.js';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { markPhoneVerified } from './verifiedPhoneStore.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';
import {
  reservePhoneOtpQuota,
  releasePhoneOtpQuota,
  reserveGlobalSmsQuota,
  releaseGlobalSmsQuota,
} from './smsQuota.js';

// AWS SNS SMS config. The region + sender ID must match our SSIR-registered
// identity in AWS, or Singapore telcos relabel the sender as "Likely-SCAM".
// "MKTR" is the SSIR-registered sender ID (Live, case-sensitive) and it is
// registered in ap-southeast-1 — both are defaulted here so a missing env var
// can't silently regress OTP SMS back to the scam label. Kept in lock-step with
// lyfe-app's custom-sms-hook, which hardcodes the same "MKTR" / ap-southeast-1.
const SMS_REGION = process.env.AWS_REGION || 'ap-southeast-1';
const SMS_SENDER_ID = process.env.AWS_SNS_SENDER_ID || 'MKTR';

// Least-privilege SNS credentials (SSIR advisory: scope keys, drop unused ones).
// Prefer a dedicated SNS-only IAM user; mirrors lyfe-app's custom-sms-hook, which
// already uses the scoped `lyfe-sns-sms` user rather than the shared AWS_* pair
// that also carries SES. Falls back to AWS_* so the split can be rolled out
// without an outage — drop the fallback once Render carries SNS_AWS_*.
//
// All-or-nothing: a half-set pair would silently mix a new key id with an old
// secret and fail every publish.
const snsCredentials =
  process.env.SNS_AWS_ACCESS_KEY_ID && process.env.SNS_AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.SNS_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.SNS_AWS_SECRET_ACCESS_KEY,
      }
    : {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };

// Initialize SNS Client
const snsClient = new SNSClient({
  region: SMS_REGION,
  credentials: snsCredentials
});

// Meta WhatsApp Graph API config (version aligned with metaCapiService.js; all overridable via env)
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const WA_TEMPLATE_NAME = process.env.META_WA_TEMPLATE_NAME || 'auth_otp';
const WA_TEMPLATE_LANG = process.env.META_WA_TEMPLATE_LANG || 'en_US';

// Helper to generate 6-digit code using cryptographically secure randomness
const generateCode = () => crypto.randomInt(100000, 1000000).toString();

/**
 * Mask a phone number for logging: `+6591234567` → `+65****4567`.
 *
 * Application logs are outside the consent ledger and the PDPA erasure matrix —
 * an erasure request rebuilds the database, not Render's log stream. Keeping raw
 * numbers out of them means there is nothing there to erase. Mirrors the same
 * helper in lyfe-app's custom-sms-hook.
 */
const maskPhone = (phone) => {
  const s = String(phone || '');
  return s.length < 7 ? '***' : `${s.slice(0, 3)}****${s.slice(-4)}`;
};

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
  // Global daily ceiling — the last chokepoint before a message carrying our
  // SSIR-registered "MKTR" sender ID leaves the building. Sits here rather than
  // in sendVerificationCode so the WhatsApp→SMS fallback is counted too: that
  // fallback is a real SMS and spends the same budget.
  const budget = await reserveGlobalSmsQuota();
  if (!budget.ok) {
    logger.error(
      { count: budget.count, cap: budget.cap },
      'sms.global_ceiling_exceeded — refusing to publish',
    );
    throw new AppError('SMS is temporarily unavailable. Please try again later.', 429);
  }

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

  try {
    const response = await snsClient.send(command);
    return response.MessageId;
  } catch (err) {
    // Nothing was delivered — hand the budget back so a provider outage can't
    // burn down the day's ceiling and lock out real traffic.
    await releaseGlobalSmsQuota().catch(() => {});
    throw err;
  }
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

  // Per-number daily cap (SSIR User Agreement cl. 2.3.2). This endpoint is public
  // and unauthenticated, so without a per-number ceiling a caller can drive
  // unlimited messages at one victim's handset — every one of them stamped with
  // our registered "MKTR" sender ID. Keyed on the NUMBER, not the IP, because the
  // transport limiter in routes/verify.js is bypassed the moment an attacker
  // rotates addresses; the victim's number is the thing that cannot be rotated.
  // Counts both channels: WhatsApp bombing is no more acceptable, and WhatsApp
  // falls back to SMS anyway.
  const quota = await reservePhoneOtpQuota(fullPhone);
  if (!quota.ok) {
    logger.warn({ count: quota.count, cap: quota.cap }, 'otp.phone_daily_cap_exceeded');
    throw new AppError(
      'Too many verification codes requested for this number today. Please try again tomorrow.',
      429,
    );
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

  // pino's signature is (mergingObject, message) — passing the object SECOND
  // silently drops it, which is why these lines logged a bare "Sending OTP" with
  // no channel and made a live SMS incident harder to diagnose than it should
  // have been. Same fix applied to every call below.
  logger.info({ channel: channel.toUpperCase() }, 'Sending OTP');

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
        logger.info({ phone: maskPhone(fullPhone), messageId }, 'WhatsApp sent');
      } catch (waErr) {
        logger.error(
          { error: waErr?.message || String(waErr) },
          'WhatsApp OTP failed — falling back to SMS',
        );
        sentChannel = 'sms';
        messageId = await sendSmsOtp(fullPhone, code);
        logger.info({ phone: maskPhone(fullPhone), messageId }, 'SMS sent (WhatsApp fallback)');
      }
    } else {
      messageId = await sendSmsOtp(fullPhone, code);
      logger.info({ phone: maskPhone(fullPhone), messageId }, 'SMS sent');
    }

    return { status: 'pending', messageId, channel: sentChannel };
  } catch (err) {
    // Nothing reached the handset — hand the daily allowance back so our own
    // outage doesn't lock a genuine user out for the rest of the day.
    await releasePhoneOtpQuota(fullPhone).catch(() => {});
    // Preserve deliberate status codes (the 429 from the global ceiling gate);
    // only genuine faults get flattened into a 500.
    if (err instanceof AppError) throw err;
    logger.error({ channel, error: err?.message || String(err) }, 'Failed to send OTP');
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
