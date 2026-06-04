import { asyncHandler } from '../middleware/errorHandler.js';
import * as waitlistService from '../services/waitlistService.js';

export const submitWaitlist = asyncHandler(async (req, res) => {
  // req.body is already validated + stripped by the Joi middleware in the route layer.
  const { email, name, phone, source } = req.body;

  // If the DB write fails, processWaitlistSignup throws → asyncHandler returns 5xx,
  // so a 200 here genuinely means the signup is persisted (success ≠ email delivery).
  await waitlistService.processWaitlistSignup({
    email,
    name,
    phone,
    source,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Idempotent + enumeration-safe: identical response whether the email was new
  // or already on the list.
  return res.status(200).json({ success: true, message: "You're on the waitlist." });
});
