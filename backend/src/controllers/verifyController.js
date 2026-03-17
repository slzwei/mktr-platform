import { asyncHandler } from '../middleware/errorHandler.js';
import * as verificationService from '../services/verificationService.js';

export const sendCode = asyncHandler(async (req, res) => {
  const { phone, countryCode, campaignId } = req.body;

  const result = await verificationService.sendVerificationCode({
    phone,
    countryCode,
    campaignId
  });

  res.json({ success: true, data: result });
});

export const checkCode = asyncHandler(async (req, res) => {
  const { phone, code, countryCode } = req.body;

  const result = await verificationService.checkVerificationCode({
    phone,
    code,
    countryCode
  });

  if (!result.valid) {
    return res.status(400).json({
      success: false,
      message: result.message,
      valid: false
    });
  }

  res.json({
    success: true,
    data: { status: result.status, verified: result.verified }
  });
});
