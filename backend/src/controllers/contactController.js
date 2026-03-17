import { asyncHandler } from '../middleware/errorHandler.js';
import * as contactService from '../services/contactService.js';

export const submitContact = asyncHandler(async (req, res) => {
  // Validation is handled by the Joi middleware in the route layer.
  // req.body is already validated and stripped of unknown fields.
  const { sent } = await contactService.processContactSubmission(req.body);

  // Even if mailer isn't configured, return success to avoid leaking config state
  if (!sent) {
    return res.status(200).json({ success: true, message: 'Message submitted successfully' });
  }

  return res.status(200).json({ success: true, message: 'Message sent successfully' });
});
