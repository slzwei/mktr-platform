/**
 * Prospect quarantine (hold) reasons — UI mirror of the backend's fences
 * (backend/src/services/prospectService.js RELEASABLE_HOLD_REASONS).
 *
 * Releasable holds can be released by a manual admin (bulk) assign; fenced
 * holds are skipped server-side (DNC gate, external buyer pool) and the UI
 * previews them as "will be skipped" before the request is sent.
 */
export const RELEASABLE_HOLD_REASONS = ['no_funded_agent', 'returned_by_admin'];

export const HOLD_REASON_LABELS = {
  returned_by_admin: 'Returned by admin — pending reassignment',
  no_funded_agent: 'No funded agent at capture',
  no_funded_external_buyer: 'External buyer pool (dispatch via MKTR Leads app)',
  dnc_pending: 'DNC check pending — releases automatically',
  dnc_registered: 'On the DNC register — cannot be assigned',
};

export function holdReasonLabel(reason) {
  return HOLD_REASON_LABELS[reason] || 'Held';
}

export function isReleasableHold(prospect) {
  return Boolean(prospect?.quarantinedAt) && RELEASABLE_HOLD_REASONS.includes(prospect?.quarantineReason);
}

export function isFencedHold(prospect) {
  return Boolean(prospect?.quarantinedAt) && !RELEASABLE_HOLD_REASONS.includes(prospect?.quarantineReason);
}
