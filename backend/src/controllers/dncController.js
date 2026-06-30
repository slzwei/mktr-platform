import { asyncHandler } from '../middleware/errorHandler.js';
import * as dncCheckService from '../services/dncCheckService.js';

/**
 * POST /api/dnc/check — the lead-capture form's DNC consent-gate lookup.
 *
 * Public + rate-limited (no auth — it rides the public form). Returns ONLY
 * `{ success, data: { registered } }`. The service fails open (registered:false) on every
 * gate miss / error, so this handler never needs to 4xx for a bad/garbage body — a missing
 * or un-opted-in campaign, a non-SG number, or an unverified phone all resolve to
 * registered:false and simply show no gate.
 */
export const checkDnc = asyncHandler(async (req, res) => {
  const { phone, countryCode, campaignId } = req.body || {};
  const result = await dncCheckService.checkDncForForm({ phone, countryCode, campaignId });
  res.json({ success: true, data: { registered: result.registered === true } });
});
