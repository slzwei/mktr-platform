import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getConsumerJourney } from '../services/consumerService.js';
import { eraseConsumer as eraseConsumerSvc } from '../services/erasureService.js';

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

/**
 * PDPA erasure (PR C) — destructive and irreversible, so the body must carry
 * the literal confirm token; admin-gated at the route. Idempotent: re-POSTing
 * an erased consumer returns { alreadyErased: true } without side effects.
 */
export const eraseConsumer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(String(id || ''))) {
    throw new AppError('Consumer not found', 404);
  }
  if (req.body?.confirm !== 'ERASE') {
    throw new AppError("Erasure requires body.confirm = 'ERASE'", 422);
  }
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim().slice(0, 255)
    : null;
  const report = await eraseConsumerSvc(id, {
    actorUser: req.user, reason, requestId: req.id || null,
  });
  res.json({ success: true, data: report });
});
