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
 * Check if a string is a valid 8-digit SG mobile number (no country code).
 */
export function isValidSgMobile(eightDigits) {
 return /^[3689]\d{7}$/.test(eightDigits);
}
