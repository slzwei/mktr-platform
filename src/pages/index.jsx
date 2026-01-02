import { lazy, Suspense, useEffect } from 'react'
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { BrowserRouter as Router, Route, Routes, useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';

const LeadCapture = lazy(() => import('./LeadCapture'));
const PublicPreview = lazy(() => import('./public/Preview'));
const TrackRedirect = lazy(() => import('./TrackRedirect'));
const ShareRedirect = lazy(() => import('./ShareRedirect'));

const Homepage = lazy(() => import('./Homepage'));
const Contact = lazy(() => import('./Contact'));
const CustomerLogin = lazy(() => import('./Login'));
const AdminLogin = lazy(() => import('./AdminLogin'));
const GoogleCallback = lazy(() => import('./GoogleCallback'));
const AcceptInvite = lazy(() => import('./AcceptInvite'));
const Onboarding = lazy(() => import('./Onboarding'));
const PendingApproval = lazy(() => import('./PendingApproval'));
const ForgotPassword = lazy(() => import('./ForgotPassword'));
const DevRoutes = lazy(() => import('../dev/DevRoutes'));

const AdminDashboard = lazy(() => import('./AdminDashboard'));
const AdminProspects = lazy(() => import('./AdminProspects'));
const AdminCampaigns = lazy(() => import('./AdminCampaigns'));
const AdminQRCodes = lazy(() => import('./AdminQRCodes'));
const AdminAgents = lazy(() => import('./AdminAgents'));
const AdminUsers = lazy(() => import('./AdminUsers'));
const AdminFleet = lazy(() => import('./AdminFleet'));
const AdminCampaignDesigner = lazy(() => import('./AdminCampaignDesigner'));
const AdminCommissions = lazy(() => import('./AdminCommissions'));
const AdminShortLinks = lazy(() => import('./AdminShortLinks'));
const AdminLeadPackages = lazy(() => import('./AdminLeadPackages'));
const AgentDashboard = lazy(() => import('./AgentDashboard'));
const FleetOwnerDashboard = lazy(() => import('./FleetOwnerDashboard'));
const DriverDashboard = lazy(() => import('./DriverDashboard'));

function PagesContent() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleUnauthorized = () => {
      console.log('🔒 AUTH: Received auth:unauthorized event, redirecting to login');
      // Clear any remaining stales states if needed
      navigate('/CustomerLogin');
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [navigate]);

  return (
    <ErrorBoundary>
      <Suspense fallback={<div />}>
        <Routes>
          {/* Public routes - no protection needed */}
          <Route path="/" element={<Homepage />} />
          <Route path="/LeadCapture" element={<LeadCapture />} />
          <Route path="/p/:slug" element={<PublicPreview />} />
          <Route path="/t/:slug" element={<TrackRedirect />} />
          <Route path="/share/:slug" element={<ShareRedirect />} />
          <Route path="/Homepage" element={<Homepage />} />
          <Route path="/Contact" element={<Contact />} />
          <Route path="/CustomerLogin" element={<CustomerLogin />} />
          <Route path="/AdminLogin" element={<AdminLogin />} />
          <Route path="/ForgotPassword" element={<ForgotPassword />} />
          <Route path="/auth/google/callback" element={<GoogleCallback />} />
          <Route path="/auth/accept-invite" element={<AcceptInvite />} />
          <Route path="/Onboarding" element={<Onboarding />} />
          <Route path="/PendingApproval" element={<PendingApproval />} />

          {/* Development routes */}
          {import.meta.env.DEV && (
            <Route path="/*" element={<DevRoutes />} />
          )}

          {/* Protected Admin routes */}
          <Route path="/AdminDashboard" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminShortLinks" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminShortLinks />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminProspects" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminProspects />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminCampaigns" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminCampaigns />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminQRCodes" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminQRCodes />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminAgents" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminAgents />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminUsers" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminUsers />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminFleet" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminFleet />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminCampaignDesigner" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminCampaignDesigner />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminCommissions" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminCommissions />
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/AdminLeadPackages" element={
            <ProtectedRoute requiredRole="admin">
              <DashboardLayout>
                <AdminLeadPackages />
              </DashboardLayout>
            </ProtectedRoute>
          } />

          {/* Protected Agent routes */}
          <Route path="/AgentDashboard" element={
            <ProtectedRoute requiredRole="agent">
              <DashboardLayout>
                <AgentDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          } />

          {/* Protected Fleet Owner routes */}
          <Route path="/FleetOwnerDashboard" element={
            <ProtectedRoute requiredRole="fleet_owner">
              <DashboardLayout>
                <FleetOwnerDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          } />

          {/* Protected Driver Partner routes */}
          <Route path="/DriverDashboard" element={
            <ProtectedRoute requiredRole="driver_partner">
              <DashboardLayout>
                <DriverDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          } />

          {/* Other protected routes */}
          <Route path="/profile" element={
            <ProtectedRoute>
              <DashboardLayout>
                <div className="p-6"><h1>Profile Page</h1><p>Profile settings coming soon...</p></div>
              </DashboardLayout>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <DashboardLayout>
                <div className="p-6"><h1>Settings Page</h1><p>Settings coming soon...</p></div>
              </DashboardLayout>
            </ProtectedRoute>
          } />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function Pages() {
  return (
    <Router>
      <PagesContent />
    </Router>
  );
}