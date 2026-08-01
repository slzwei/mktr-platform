/**
 * Phone display-masking variants (P4-2). Three hand-rolled forms existed;
 * they are DIFFERENT display contracts on purpose — named here, not merged:
 *
 *   maskPhoneDots     '+6591234567' → '••••4567'      (WA sends, ops payloads)
 *   maskPhonePrefixed '+6591234567' → '+65****4567'   (OTP logs; '***' when
 *                                                      too short to mask —
 *                                                      mirrors lyfe-app's
 *                                                      custom-sms-hook helper)
 */
import { phoneDigits } from './prospectHelpers.js';

export function maskPhoneDots(phone) {
  const digits = phoneDigits(phone);
  return digits ? `••••${digits.slice(-4)}` : null;
}

export function maskPhonePrefixed(phone) {
  const s = String(phone || '');
  return s.length < 7 ? '***' : `${s.slice(0, 3)}****${s.slice(-4)}`;
}
