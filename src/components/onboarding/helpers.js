/**
 * Pure helper functions extracted from Onboarding wizard.
 * No React, no side effects — safe to unit-test in isolation.
 */

import {
  isValidSgPlate as isValidAllowedPlateFormat,
  parseSgPlate as formatPlateInputToStrict,
} from '@/utils/validation';

/**
 * Strip non-digits, remove leading "65" country code, cap at 8 chars.
 */
export function sanitizePhoneInput(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('65') && digits.length > 8) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 8);
}

/**
 * Validate Singapore NRIC/FIN with checksum for S/T (NRIC) and F/G/M (FIN).
 */
export function isValidNricFin(value) {
  const v = String(value || '').toUpperCase();
  if (!/^[STFGM]\d{7}[A-Z]$/.test(v)) return false;
  const prefix = v[0];
  const digits = v.slice(1, 8).split('').map((c) => Number(c));
  const weights = [2, 7, 6, 5, 4, 3, 2];
  let sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  // T/G/M series offset (post-2000). Treat M like G for checksum.
  if (prefix === 'T' || prefix === 'G' || prefix === 'M') sum += 4;
  const stMap = ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
  const fgMap = ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'M', 'L', 'K'];
  const map = (prefix === 'S' || prefix === 'T') ? stMap : fgMap;
  const expected = map[sum % 11];
  return v[8] === expected;
}

/**
 * Auto-insert "/" separators as user types DD/MM/YYYY.
 */
export function formatDateInput(value) {
  let digits = String(value || '').replace(/\D/g, '');
  digits = digits.slice(0, 8);
  if (digits.length >= 3) digits = digits.slice(0, 2) + '/' + digits.slice(2);
  if (digits.length >= 6) digits = digits.slice(0, 5) + '/' + digits.slice(5);
  return digits;
}

/**
 * Parse DD/MM/YYYY and return integer age, or null if invalid.
 */
export function calculateAge(dateString) {
  if (!dateString || dateString.length !== 10) return null;
  const [dayStr, monthStr, yearStr] = dateString.split('/');
  const day = Number(dayStr), month = Number(monthStr), year = Number(yearStr);
  if (!day || !month || !year) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
  const birthDate = new Date(year, month - 1, day);
  if (birthDate.getDate() !== day || (birthDate.getMonth() + 1) !== month || birthDate.getFullYear() !== year) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

/**
 * Parse CSV text with plate_number,make,model headers into row objects.
 */
export function parseCsvToRows(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = (lines.shift() || '').toLowerCase();
  const cols = header.split(',').map(s => s.trim());
  const idxPlate = cols.indexOf('plate_number');
  const idxMake = cols.indexOf('make');
  const idxModel = cols.indexOf('model');
  if (idxPlate === -1 || idxMake === -1 || idxModel === -1) return [];
  const out = [];
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    const p = (parts[idxPlate] || '').toUpperCase();
    const m = (parts[idxMake] || '').toUpperCase();
    const mo = (parts[idxModel] || '').toUpperCase();
    if (p || m || mo) out.push({ plate_number: p, make: m, model: mo });
  }
  return out;
}

/**
 * Build clean car objects from grid rows, normalising plate numbers.
 */
export function collectGridCars(carsRows) {
  return (carsRows || [])
    .map(r => ({
      plate_number: formatPlateInputToStrict(r.plate_number),
      make: String(r.make || '').trim(),
      model: String(r.model || '').trim()
    }))
    .filter(r => r.plate_number && r.make && r.model);
}

/**
 * Return array of duplicate plate strings found in rows.
 */
export function findDuplicatePlates(rows) {
  const seen = new Map();
  const dups = new Set();
  for (const r of rows) {
    const key = String(r.plate_number || '').toUpperCase();
    if (seen.has(key)) dups.add(key); else seen.set(key, true);
  }
  return Array.from(dups.values());
}

/**
 * Wrapper around the imported plate validator.
 */
export function isValidSgPlateStrict(raw) {
  return isValidAllowedPlateFormat(raw);
}
