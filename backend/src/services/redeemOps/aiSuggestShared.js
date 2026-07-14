import { AppError } from '../../middleware/errorHandler.js';

/**
 * Shared error translation for redeem-ops AI suggestion features (Discover
 * keyword suggestions, cadence drafts). The underlying guided-review helper's
 * provider errors read "draft"/"AI Settings" — copy aimed at platform admins.
 * Redeem-ops staff can't reach AdminAISettings (it's an admin-role page on the
 * mktr surface), so rewrite for them while preserving status codes.
 */
export function staffFacingAiError(err) {
  if (!(err instanceof AppError)) return err;
  if (err.statusCode === 409) {
    return new AppError('AI is not set up yet — ask an admin to add a provider key in AI Settings', 409);
  }
  if (err.statusCode === 502) {
    return new AppError('AI suggestion failed — try again shortly', 502);
  }
  return err; // 429 (provider rate/spend limit) and 504 (timeout) copy is audience-neutral
}
