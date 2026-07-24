import { makeEntitlementService } from './entitlementService.js';
import { makeFulfilmentNotify } from './fulfilmentNotify.js';
import { makeWhatsappService } from './whatsappService.js';

/**
 * The ONE place a fully-delivering entitlement service is assembled
 * (voucher + reservation, email and — PR E — WhatsApp). Every unlock
 * surface and both bootstrap instances use this factory — a bare
 * `makeEntitlementService()` has null notify deps and sends NOTHING, which
 * is exactly how the voucher email silently never fired before PR A
 * (docs/plans/trial-reward-funnel-hardening-prompt.md, defect 1).
 *
 * The WhatsApp legs are always wired but self-guard on
 * REDEEM_OPS_WHATSAPP_ENABLED (default false) at call time — flag off, the
 * sender resolves `skipped` and nothing is sent or receipted, byte-identical
 * to PR A behavior.
 *
 * `overrides` spread last so tests keep full DI control.
 */
export function makeWiredEntitlementService(overrides = {}) {
  const notify = makeFulfilmentNotify();
  const wa = makeWhatsappService();
  return makeEntitlementService({
    notifyReservation: (args) => notify.sendReservationEmail(args),
    notifyUnlock: (args) => notify.sendVoucherEmail(args),
    notifyReservationWa: (args) => wa.sendReservationWhatsApp(args),
    notifyUnlockWa: (args) => wa.sendVoucherWhatsApp(args),
    // "×N confirmed" receipt at a recorded draw session — email + WhatsApp
    // (the `draw_boost_receipt` UTILITY template; the WA leg self-guards on
    // the flag and fails receipted while the template is in review).
    notifyBoostReceipt: (args) => notify.sendBoostReceiptEmail(args),
    notifyBoostReceiptWa: (args) => wa.sendBoostReceiptWhatsApp(args),
    ...overrides,
  });
}
