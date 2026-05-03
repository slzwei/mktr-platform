// Shared SG phone and plate number validation utilities

// A-Z excluding I and O
export const LETTERS_NO_IO = [
 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

// Second letters in S-series: SB, SC, SD, SF, SG, SJ, SK, SL, SM, SN
export const SERIES_SECOND_LETTERS = ['B', 'C', 'D', 'F', 'G', 'J', 'K', 'L', 'M', 'N'];

// Valid SG mobile prefixes (first digit of 8-digit number)
export const SG_PHONE_PREFIXES = [3, 6, 8, 9];

// Full set of allowed plate prefixes: E-series (EA-EZ) + S-series blocks (SBx-SNx)
export const ALLOWED_PLATE_PREFIXES = new Set([
 ...LETTERS_NO_IO.map((l) => `E${l}`),
 ...SERIES_SECOND_LETTERS.flatMap((sec) =>
 LETTERS_NO_IO.map((third) => `S${sec}${third}`)
 ),
]);

/**
 * Normalize a plate string: uppercase, strip non-alphanumeric chars.
 */
export function parseSgPlate(input) {
 return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validate a Singapore vehicle plate number.
 * Accepts raw input; normalizes internally.
 * Format: prefix (EA-EZ or SBx-SNx) + 1-4 digits + 1 trailing letter.
 */
export function isValidSgPlate(raw) {
 const v = parseSgPlate(raw);
 if (!v) return false;

 let prefix = '';
 if (v.startsWith('S')) {
 prefix = v.slice(0, 3);
 } else if (v.startsWith('E')) {
 prefix = v.slice(0, 2);
 } else {
 return false;
 }

 if (!ALLOWED_PLATE_PREFIXES.has(prefix)) return false;

 const rest = v.slice(prefix.length);
 // Must be 1-4 digits then 1 trailing letter
 return /^(\d{1,4})([A-Z])$/.test(rest);
}

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
