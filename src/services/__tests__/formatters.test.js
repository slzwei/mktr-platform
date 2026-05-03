import { describe, it, expect } from 'vitest';
import {
 formatPhone,
 whatsappLink,
 formatCurrency,
 formatDate,
 formatName,
 normalizeList,
} from '../formatters';

describe('formatPhone', () => {
 it('adds +65 prefix for bare 8-digit SG number', () => {
 expect(formatPhone('81234567')).toBe('+65 8123 4567');
 });

 it('formats number already with +65', () => {
 expect(formatPhone('+6581234567')).toBe('+65 8123 4567');
 });

 it('strips spaces before formatting', () => {
 expect(formatPhone('8123 4567')).toBe('+65 8123 4567');
 });

 it('returns empty string for null', () => {
 expect(formatPhone(null)).toBe('');
 });

 it('returns empty string for empty string', () => {
 expect(formatPhone('')).toBe('');
 });
});

describe('whatsappLink', () => {
 it('generates correct WhatsApp link', () => {
 expect(whatsappLink('+6581234567')).toBe('https://wa.me/6581234567');
 });

 it('includes encoded message when provided', () => {
 const link = whatsappLink('+6581234567', 'Hello there');
 expect(link).toBe('https://wa.me/6581234567?text=Hello%20there');
 });

 it('strips non-numeric chars from phone', () => {
 expect(whatsappLink('+65 8123 4567')).toBe('https://wa.me/6581234567');
 });
});

describe('formatCurrency', () => {
 it('formats a numeric amount as SGD', () => {
 const result = formatCurrency(1234.5);
 expect(result).toContain('1,234.50');
 });

 it('returns $0.00 for NaN', () => {
 expect(formatCurrency('abc')).toBe('$0.00');
 });

 it('handles zero', () => {
 const result = formatCurrency(0);
 expect(result).toContain('0.00');
 });
});

describe('formatDate', () => {
 it('returns empty string for null', () => {
 expect(formatDate(null)).toBe('');
 });

 it('returns empty string for invalid date', () => {
 expect(formatDate('not-a-date')).toBe('');
 });

 it('formats a valid date string', () => {
 const result = formatDate('2024-01-15');
 expect(result).toBeTruthy();
 expect(typeof result).toBe('string');
 });
});

describe('formatName', () => {
 it('returns fullName when present', () => {
 expect(formatName({ fullName: 'John Doe' })).toBe('John Doe');
 });

 it('returns full_name when present', () => {
 expect(formatName({ full_name: 'Jane Doe' })).toBe('Jane Doe');
 });

 it('joins firstName and lastName', () => {
 expect(formatName({ firstName: 'John', lastName: 'Doe' })).toBe('John Doe');
 });

 it('falls back to email', () => {
 expect(formatName({ email: 'john@example.com' })).toBe('john@example.com');
 });

 it('returns empty string for null', () => {
 expect(formatName(null)).toBe('');
 });
});

describe('normalizeList', () => {
 it('returns data if it is already an array', () => {
 expect(normalizeList([1, 2, 3], 'items')).toEqual([1, 2, 3]);
 });

 it('extracts array from object by key', () => {
 expect(normalizeList({ items: [1, 2] }, 'items')).toEqual([1, 2]);
 });

 it('returns empty array for null data', () => {
 expect(normalizeList(null, 'items')).toEqual([]);
 });

 it('returns empty array when key is missing', () => {
 expect(normalizeList({ other: [1] }, 'items')).toEqual([]);
 });
});
