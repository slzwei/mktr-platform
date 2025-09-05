import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 

// Determine the default route for a given user role
export function getDefaultRouteForRole(role) {
  console.log('🔍 getDefaultRouteForRole called with role:', role, 'typeof:', typeof role);
  switch (role) {
    case 'admin':
      console.log('✅ Admin role detected -> /AdminDashboard');
      return '/AdminDashboard'
    case 'agent':
      console.log('✅ Agent role detected -> /AgentDashboard');
      return '/AgentDashboard'
    case 'fleet_owner':
      console.log('✅ Fleet owner role detected -> /FleetOwnerDashboard');
      return '/FleetOwnerDashboard'
    case 'driver_partner':
      console.log('✅ Driver Partner role detected -> /DriverDashboard');
      return '/DriverDashboard'
    case 'customer':
      console.log('✅ Customer role detected -> /Onboarding');
      return '/Onboarding'
    default:
      console.log('❌ Unknown role, defaulting to /Homepage');
      return '/Homepage'
  }
}

// Compute the post-auth redirect path based on a user object
export function getPostAuthRedirectPath(user) {
  console.log('🔍 getPostAuthRedirectPath called with user:', user);
  if (!user) {
    console.log('❌ No user provided, redirecting to Homepage');
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
  const route = getDefaultRouteForRole(user.role);
  console.log('✅ User role:', user.role, '-> Redirecting to:', route);
  return route;
}