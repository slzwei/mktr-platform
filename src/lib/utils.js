import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs) {
 return twMerge(clsx(inputs))
}

// Determine the default route for a given user role
export function getDefaultRouteForRole(role) {
 switch (role) {
 case 'admin':
 return '/AdminDashboard'
 case 'agent':
 return '/AgentDashboard'
 case 'fleet_owner':
 return '/FleetOwnerDashboard'
 case 'driver_partner':
 return '/DriverDashboard'
 case 'redeem_ops':
 return '/redeem-ops'
 case 'customer':
 return '/Onboarding'
 default:
 return '/Homepage'
 }
}

// Compute the post-auth redirect path based on a user object
export function getPostAuthRedirectPath(user) {
 if (!user) {
 return '/Homepage';
 }
 // If user has not been approved yet for roles requiring review, keep them on PendingApproval
 const status = user.approvalStatus || user.status;
 if (status === 'pending' || status === 'pending_approval') {
 return '/PendingApproval';
 }
 // Send customers to onboarding
 if (user.role === 'customer') {
 return '/Onboarding';
 }
 return getDefaultRouteForRole(user.role);
}
