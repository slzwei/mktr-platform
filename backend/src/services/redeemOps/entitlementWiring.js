import { makeEntitlementService } from './entitlementService.js';
import { makeFulfilmentNotify } from './fulfilmentNotify.js';

/**
 * The ONE place a fully-delivering entitlement service is assembled
 * (voucher email on unlock + reservation email on issue). Every unlock
 * surface and both bootstrap instances use this factory — a bare
 * `makeEntitlementService()` has null notify deps and sends NOTHING, which
 * is exactly how the voucher email silently never fired before PR A
 * (docs/plans/trial-reward-funnel-hardening-prompt.md, defect 1).
 *
 * `overrides` spread last so tests keep full DI control.
 */
export function makeWiredEntitlementService(overrides = {}) {
  const notify = makeFulfilmentNotify();
  return makeEntitlementService({
    notifyReservation: (args) => notify.sendReservationEmail(args),
    notifyUnlock: (args) => notify.sendVoucherEmail(args),
    ...overrides,
  });
}
