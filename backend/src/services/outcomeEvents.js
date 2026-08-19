/**
 * Down-funnel outcome-event vocabulary — the ONE mapping from internal outcome
 * keys (`confirmed_resident`/`closed_won`) to their Meta CAPI event names
 * (env-overridable) and their mark-on-success marker keys under
 * sourceMetadata.capi.
 *
 * Extracted verbatim from leadOutcomeService (ads-centralisation §3.3.2) so
 * the platform-delivery ledger can consume the same vocabulary without a
 * static import cycle: leadOutcomeService → platformDeliveryService → here.
 * leadOutcomeService re-exports eventNameFor/eventKeysForStatus, so existing
 * importers are unchanged.
 */
export const OUTCOME_EVENTS = {
  confirmed_resident: { envVar: 'META_EVENT_QUALIFIED', defaultName: 'ConfirmedResident', markerKey: 'confirmedResidentAt' },
  closed_won: { envVar: 'META_EVENT_WON', defaultName: 'ClosedWon', markerKey: 'closedWonAt' },
};

/** Resolve the configured CAPI event_name for an internal event key (env-overridable). */
export function eventNameFor(key) {
  const e = OUTCOME_EVENTS[key];
  return e ? process.env[e.envVar] || e.defaultName : null;
}

/**
 * Ordered list of internal event keys a Lyfe status should emit.
 *   - qualified ("agent confirmed SC/PR") → ConfirmedResident
 *   - won (bought a policy; implies SC/PR) → ConfirmedResident (if new) + ClosedWon
 */
export function eventKeysForStatus(status) {
  if (status === 'qualified') return ['confirmed_resident'];
  if (status === 'won') return ['confirmed_resident', 'closed_won'];
  return [];
}
