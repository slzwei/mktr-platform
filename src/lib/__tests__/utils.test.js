import { describe, it, expect } from 'vitest';
import { cn, getDefaultRouteForRole, getPostAuthRedirectPath } from '../utils';

describe('cn()', () => {
 it('merges simple class names', () => {
 expect(cn('foo', 'bar')).toBe('foo bar');
 });

 it('handles conditional classes via clsx syntax', () => {
 const cond = false;
 expect(cn('base', cond && 'hidden', 'extra')).toBe('base extra');
 });

 it('merges conflicting tailwind classes (last wins)', () => {
 const result = cn('p-4', 'p-2');
 expect(result).toBe('p-2');
 });

 it('returns empty string for no arguments', () => {
 expect(cn()).toBe('');
 });

 it('handles undefined and null inputs', () => {
 expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
 });

 it('handles array inputs', () => {
 expect(cn(['foo', 'bar'])).toBe('foo bar');
 });

 it('merges complex tailwind utilities', () => {
 const result = cn('text-red-500', 'text-primary');
 expect(result).toBe('text-primary');
 });

 it('preserves non-conflicting classes', () => {
 const result = cn('p-4 mx-2', 'bg-destructive');
 expect(result).toContain('p-4');
 expect(result).toContain('mx-2');
 expect(result).toContain('bg-destructive');
 });
});

describe('getDefaultRouteForRole()', () => {
 it('returns /AdminDashboard for admin', () => {
 expect(getDefaultRouteForRole('admin')).toBe('/AdminDashboard');
 });

 it('returns /AgentDashboard for agent', () => {
 expect(getDefaultRouteForRole('agent')).toBe('/AgentDashboard');
 });

 it('returns /FleetOwnerDashboard for fleet_owner', () => {
 expect(getDefaultRouteForRole('fleet_owner')).toBe('/FleetOwnerDashboard');
 });

 it('returns /DriverDashboard for driver_partner', () => {
 expect(getDefaultRouteForRole('driver_partner')).toBe('/DriverDashboard');
 });

 it('returns /Onboarding for customer', () => {
 expect(getDefaultRouteForRole('customer')).toBe('/Onboarding');
 });

 it('returns /Homepage for unknown role', () => {
 expect(getDefaultRouteForRole('unknown_role')).toBe('/Homepage');
 });

 it('returns /Homepage for undefined role', () => {
 expect(getDefaultRouteForRole(undefined)).toBe('/Homepage');
 });

 it('returns /Homepage for null role', () => {
 expect(getDefaultRouteForRole(null)).toBe('/Homepage');
 });
});

describe('getPostAuthRedirectPath()', () => {
 it('returns /Homepage when user is null', () => {
 expect(getPostAuthRedirectPath(null)).toBe('/Homepage');
 });

 it('returns /Homepage when user is undefined', () => {
 expect(getPostAuthRedirectPath(undefined)).toBe('/Homepage');
 });

 it('returns /PendingApproval for pending approvalStatus', () => {
 expect(getPostAuthRedirectPath({ role: 'agent', approvalStatus: 'pending' })).toBe('/PendingApproval');
 });

 it('returns /PendingApproval for pending_approval status', () => {
 expect(getPostAuthRedirectPath({ role: 'agent', status: 'pending_approval' })).toBe('/PendingApproval');
 });

 it('returns /Onboarding for customer role', () => {
 expect(getPostAuthRedirectPath({ role: 'customer', approvalStatus: 'approved' })).toBe('/Onboarding');
 });

 it('returns /AdminDashboard for approved admin', () => {
 expect(getPostAuthRedirectPath({ role: 'admin', approvalStatus: 'approved' })).toBe('/AdminDashboard');
 });

 it('returns /AgentDashboard for approved agent', () => {
 expect(getPostAuthRedirectPath({ role: 'agent', approvalStatus: 'approved' })).toBe('/AgentDashboard');
 });

 it('returns /FleetOwnerDashboard for approved fleet_owner', () => {
 expect(getPostAuthRedirectPath({ role: 'fleet_owner', approvalStatus: 'approved' })).toBe('/FleetOwnerDashboard');
 });

 it('returns /DriverDashboard for approved driver_partner', () => {
 expect(getPostAuthRedirectPath({ role: 'driver_partner', approvalStatus: 'approved' })).toBe('/DriverDashboard');
 });

 it('prefers approvalStatus over status field', () => {
 expect(getPostAuthRedirectPath({ role: 'agent', approvalStatus: 'pending', status: 'approved' })).toBe(
 '/PendingApproval'
 );
 });

 it('falls back to status when approvalStatus is absent', () => {
 expect(getPostAuthRedirectPath({ role: 'agent', status: 'pending_approval' })).toBe('/PendingApproval');
 });

 it('returns role dashboard when neither pending status is set', () => {
 expect(getPostAuthRedirectPath({ role: 'admin' })).toBe('/AdminDashboard');
 });
});
