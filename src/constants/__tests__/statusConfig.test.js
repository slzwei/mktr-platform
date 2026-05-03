import { describe, it, expect } from 'vitest';
import {
 statusStyles,
 statusLabels,
 getStatusColor,
 formatStatus,
} from '../statusConfig';

const ALL_STATUSES = [
 'new',
 'contacted',
 'meeting',
 'qualified',
 'proposal',
 'negotiating',
 'negotiation',
 'won',
 'close_won',
 'lost',
 'close_lost',
 'rejected',
];

describe('statusStyles', () => {
 it('has an entry for every known status', () => {
 for (const status of ALL_STATUSES) {
 expect(statusStyles).toHaveProperty(status);
 expect(typeof statusStyles[status]).toBe('string');
 expect(statusStyles[status].length).toBeGreaterThan(0);
 }
 });

 it('style strings contain Tailwind class patterns', () => {
 for (const status of ALL_STATUSES) {
 // Every entry should have at least a bg- and text- class
 expect(statusStyles[status]).toMatch(/bg-/);
 expect(statusStyles[status]).toMatch(/text-/);
 }
 });
});

describe('statusLabels', () => {
 it('has an entry for every known status', () => {
 for (const status of ALL_STATUSES) {
 expect(statusLabels).toHaveProperty(status);
 expect(typeof statusLabels[status]).toBe('string');
 expect(statusLabels[status].length).toBeGreaterThan(0);
 }
 });

 it('statusLabels and statusStyles cover the same keys', () => {
 const styleKeys = Object.keys(statusStyles).sort();
 const labelKeys = Object.keys(statusLabels).sort();
 expect(styleKeys).toEqual(labelKeys);
 });
});

describe('getStatusColor', () => {
 it('returns the matching style string for each known status', () => {
 for (const status of ALL_STATUSES) {
 expect(getStatusColor(status)).toBe(statusStyles[status]);
 }
 });

 it('returns a neutral muted style for an unknown status', () => {
 const fallback = getStatusColor('totally_unknown');
 expect(fallback).toMatch(/bg-muted/);
 expect(fallback).toMatch(/text-muted-foreground/);
 });

 it('returns default for undefined', () => {
 expect(getStatusColor(undefined)).toMatch(/bg-muted/);
 });

 it('returns default for empty string', () => {
 expect(getStatusColor('')).toMatch(/bg-muted/);
 });
});

describe('formatStatus', () => {
 it('returns the label for known statuses', () => {
 expect(formatStatus('new')).toBe('New');
 expect(formatStatus('contacted')).toBe('Contacted');
 expect(formatStatus('close_won')).toBe('Won');
 expect(formatStatus('close_lost')).toBe('Lost');
 expect(formatStatus('rejected')).toBe('Rejected');
 });

 it('title-cases unknown statuses and replaces underscores with spaces', () => {
 expect(formatStatus('some_custom_status')).toBe('Some Custom Status');
 });

 it('returns"Unknown" for null or undefined', () => {
 expect(formatStatus(null)).toBe('Unknown');
 expect(formatStatus(undefined)).toBe('Unknown');
 });

 it('returns"Unknown" for empty string', () => {
 expect(formatStatus('')).toBe('Unknown');
 });
});
