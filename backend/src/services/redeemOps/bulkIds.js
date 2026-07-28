import { AppError } from '../../middleware/errorHandler.js';

/**
 * The shared front door for every Partners multi-select action (claim, release,
 * assign, stage). Its own module rather than a helper inside one service,
 * because claimService and partnerService both need it and importing one into
 * the other would risk a cycle through the cadence hooks.
 *
 * Multi-select cap: each row in a bulk action gets its OWN transaction, so a
 * huge batch would hold a request open for a long time. The console's page size
 * is well under this.
 */
export const BULK_MAX = 100;

/**
 * Dedupe + cap the ids a bulk action was handed, so a bad batch is refused
 * before the first write rather than halfway through it. `verb` only shapes the
 * empty-selection message ("…to claim" / "…to release").
 */
export function normaliseBulkIds(partnerIds, verb) {
  const ids = [...new Set((partnerIds || []).map(String))];
  if (!ids.length) throw new AppError(`Select at least one business to ${verb}`, 400);
  if (ids.length > BULK_MAX) throw new AppError(`Select up to ${BULK_MAX} businesses at a time`, 400);
  return ids;
}
