// Shared SG phone validation utilities
// (plate-number validators lived here until the fleet teardown, P2-7)

/**
 * Validate and format a Singapore phone number.
 * Accepts 8 raw digits (no country code). Returns"+65XXXXXXXX"or null if invalid.
 */
export function formatSgPhone(raw) {
 const digits = String(raw || '').replace(/\D/g, '');
 if (!/^[3689]\d{7}$/.test(digits)) return null;
 return `+65${digits}`;
}

/**
 * Check if a string is a valid 8-digit SG MOBILE number (no country code).
 *
 * Mobile means 8xxxxxxx or 9xxxxxxx. 6 is fixed-line and 3 is VoIP — neither
 * receives SMS, and both public funnels send an OTP to this number before a
 * lead can proceed. Accepting them offered the customer a dead end: the form
 * took the number, the OTP never arrived, and the lead was lost silently
 * (P2-14). `formatSgPhone` keeps the wider [3689] set on purpose — formatting
 * a landline for storage is fine; treating one as a mobile is not.
 *
 * This matches redeemOps/whatsappService's recipient rule, which has always
 * been mobile-only for the same reason.
 */
export function isValidSgMobile(eightDigits) {
 return /^[89]\d{7}$/.test(eightDigits);
}
