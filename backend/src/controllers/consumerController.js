import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getConsumerJourney } from '../services/consumerService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person's cross-campaign journey (consumer spine). Route-gated to admin —
 * this aggregates PII across campaigns, unlike the per-lead prospect detail.
 * Malformed ids 404 up front (a raw uuid-cast error would surface as a 500 —
 * the AdminCampaignDesigner lesson).
 */
export const getConsumer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(String(id || ''))) {
    throw new AppError('Consumer not found', 404);
  }
  const journey = await getConsumerJourney(id);
  if (!journey) {
    throw new AppError('Consumer not found', 404);
  }
  res.json({ success: true, data: journey });
});
