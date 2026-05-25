import { lazy, Suspense, useEffect } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { BrowserRouter as Router, Route, Routes, useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import { brand } from '@/lib/brand';
import {
  MktrOnlyRedirect,
  NotFoundForBrand,
  IS_REDEEM_BUILD,
} from '@/components/auth/BrandRouteGuards';

const LeadCapture = lazy(() => import('./LeadCapture'));
const LeadCaptureDemo = lazy(() => import('./LeadCaptureDemo'));
const PublicPreview = lazy(() => import('./public/Preview'));
const TrackRedirect = lazy(() => import('./TrackRedirect'));
const ShareRedirect = lazy(() => import('./ShareRedirect'));

// Design exploration prototypes — safe to delete src/pages/preview/ once a direction is picked
const PreviewHub = lazy(() => import('./preview/PreviewHub'));
const AtelierPreview = lazy(() => import('./preview/AtelierPreview'));
const AuroraPreview = lazy(() => import('./preview/AuroraPreview'));
const SpecimenPreview = lazy(() => import('./preview/SpecimenPreview'));

const Homepage = lazy(() => import('./Homepage'));
const RedeemPlaceholder = lazy(() => import('./RedeemPlaceholder'));
const Features = lazy(() => import('./Features'));
const Pricing = lazy(() => import('./Pricing'));
const About = lazy(() => import('./About'));
const Contact = lazy(() => import('./Contact'));
const CustomerLogin = lazy(() => import('./Login'));
const AdminLogin = lazy(() => import('./AdminLogin'));
const GoogleCallback = lazy(() => import('./GoogleCallback'));
const AcceptInvite = lazy(() => import('./AcceptInvite'));
const Onboarding = lazy(() => import('./Onboarding'));
const PendingApproval = lazy(() => import('./PendingApproval'));
const ForgotPassword = lazy(() => import('./ForgotPassword'));
const PersonalDataPolicy = lazy(() => import('./PersonalDataPolicy'));
const DevRoutes = lazy(() => import('../dev/DevRoutes'));

const AdminDashboard = lazy(() => import('./AdminDashboard'));
const AdminProspects = lazy(() => import('./AdminProspects'));
const AdminCampaigns = lazy(() => import('./AdminCampaigns'));
const AdminCampaignForm = lazy(() => import('./AdminCampaignForm'));
const AdminQRCodes = lazy(() => import('./AdminQRCodes'));
const AdminAgents = lazy(() => import('./AdminAgents'));
const AdminAgentDetail = lazy(() => import('./AdminAgentDetail'));
const AdminUsers = lazy(() => import('./AdminUsers'));
const AdminFleet = lazy(() => import('./AdminFleet'));
const AdminCampaignDesigner = lazy(() => import('./AdminCampaignDesigner'));
const AdminCommissions = lazy(() => import('./AdminCommissions'));
const AdminShortLinks = lazy(() => import('./AdminShortLinks'));
const AdminLeadPackages = lazy(() => import('./AdminLeadPackages'));
const AdminDevices = lazy(() => import('./AdminDevices'));
const AdminVehicles = lazy(() => import('./AdminVehicles'));
const AdminFleetMap = lazy(() => import('./AdminFleetMap'));

const AdminDeviceLogs = lazy(() => import('./AdminDeviceLogs'));
const ProvisionDevice = lazy(() => import('./ProvisionDevice')); // Added
const AdminApkManager = lazy(() => import('./AdminApkManager')); // Added
const AdminAgentGroups = lazy(() => import('./AdminAgentGroups'));
const AgentDashboard = lazy(() => import('./AgentDashboard'));

const FleetOwnerDashboard = lazy(() => import('./FleetOwnerDashboard'));
const DriverDashboard = lazy(() => import('./DriverDashboard'));
const DriverProfile = lazy(() => import('./DriverProfile'));
const DriverPayoutHistory = lazy(() => import('./DriverPayoutHistory'));
const DriverPayslip = lazy(() => import('./DriverPayslip'));
const MyProspects = lazy(() => import('./MyProspects'));
const ProspectDetailPage = lazy(() => import('./ProspectDetailPage'));
const AgentProfile = lazy(() => import('./AgentProfile'));

function PagesContent() {
 const navigate = useNavigate();

 useEffect(() => {
 const handleUnauthorized = () => {
 // Redirect to login on auth failure
 // Clear any remaining stales states if needed
 navigate('/CustomerLogin');
 };

 window.addEventListener('auth:unauthorized', handleUnauthorized);
 return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
 }, [navigate]);

 return (
 <ErrorBoundary>
 <Suspense
 fallback={
 <div className="min-h-screen flex items-center justify-center">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ring"/>
 </div>
 }
 >
 <Routes>
 {/* Public routes - no protection needed. Lead capture flow stays on both brands. */}
 <Route path="/" element={brand.showHomepage ? <Homepage /> : (IS_REDEEM_BUILD ? <RedeemPlaceholder /> : <LeadCapture />)} />
 <Route path="/LeadCapture" element={<LeadCapture />} />
 <Route path="/LeadCapture/demo" element={<LeadCaptureDemo />} />
 <Route path="/p/:slug" element={<PublicPreview />} />
 <Route path="/t/:slug" element={<TrackRedirect />} />
 <Route path="/share/:slug" element={<ShareRedirect />} />

 {/* Design exploration prototypes — mktr build only */}
 <Route path="/preview" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <PreviewHub />} />
 <Route path="/preview/atelier" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <AtelierPreview />} />
 <Route path="/preview/aurora" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <AuroraPreview />} />
 <Route path="/preview/specimen" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <SpecimenPreview />} />

 {/* Public marketing — brand-aware (D2: redeem hides Homepage/Features/Pricing/About). */}
 <Route path="/Homepage" element={brand.showHomepage ? <Homepage /> : <NotFoundForBrand />} />
 <Route path="/features" element={brand.showFeatures ? <Features /> : <NotFoundForBrand />} />
 <Route path="/pricing" element={brand.showPricing ? <Pricing /> : <NotFoundForBrand />} />
 <Route path="/about" element={brand.showAbout ? <About /> : <NotFoundForBrand />} />
 <Route path="/Contact" element={<Contact />} />
 <Route path="/personal-data-policy" element={<PersonalDataPolicy />} />

 {/* D13: internal/auth/admin/onboarding routes redirect to mktr.sg on the redeem build. */}
 <Route path="/CustomerLogin" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <CustomerLogin />} />
 <Route path="/AdminLogin" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <AdminLogin />} />
 <Route path="/ForgotPassword" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <ForgotPassword />} />
 <Route path="/auth/google/callback" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <GoogleCallback />} />
 <Route path="/auth/accept-invite" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <AcceptInvite />} />
 <Route path="/Onboarding" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <Onboarding />} />
 <Route path="/PendingApproval" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <PendingApproval />} />

 {/* Development routes — mktr build only */}
 {import.meta.env.DEV && !IS_REDEEM_BUILD && <Route path="/*" element={<DevRoutes />} />}

 {/* Protected Admin routes */}
 <Route
 path="/AdminDashboard" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminDashboard />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminShortLinks" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminShortLinks />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminProspects" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminProspects />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminCampaigns" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCampaigns />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/admin/campaigns/new" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCampaignForm />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/admin/campaigns/:id/edit" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCampaignForm />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminQRCodes" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminQRCodes />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminAgentGroups" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminAgentGroups />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminAgents" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminAgents />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminAgents/:agentId" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminAgentDetail />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminUsers" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminUsers />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminFleet" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminFleet />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminCampaignDesigner" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCampaignDesigner />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminCommissions" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCommissions />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminLeadPackages" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminLeadPackages />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminDevices" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminDevices />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminFleetMap" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminFleetMap />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 {/* Alias for lowercase compatibility */}
 <Route
 path="/admin/vehicles" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminVehicles />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminVehicles" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminVehicles />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/admin/devices/:id/logs" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminDeviceLogs />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/provision/:code" element={
 <ProtectedRoute requiredRole="admin">
 <ProvisionDevice />
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminApkManager" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminApkManager />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />

 {/* Protected Agent routes */}

 <Route
 path="/AgentDashboard" element={
 <ProtectedRoute requiredRole="agent">
 <DashboardLayout>
 <AgentDashboard />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/MyProspects" element={
 <ProtectedRoute requiredRole="agent">
 <DashboardLayout>
 <MyProspects />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/prospect/:id" element={
 <ProtectedRoute requiredRole="agent">
 <DashboardLayout>
 <ProspectDetailPage />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />

 {/* Protected Fleet Owner routes */}
 <Route
 path="/FleetOwnerDashboard" element={
 <ProtectedRoute requiredRole="fleet_owner">
 <DashboardLayout>
 <FleetOwnerDashboard />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />

 {/* Protected Driver Partner routes */}
 <Route
 path="/DriverDashboard" element={
 <ProtectedRoute requiredRole="driver_partner">
 <DashboardLayout>
 <DriverDashboard />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/DriverProfile" element={
 <ProtectedRoute requiredRole="driver_partner">
 <DashboardLayout>
 <DriverProfile />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/DriverPayoutHistory" element={
 <ProtectedRoute requiredRole="driver_partner">
 <DashboardLayout>
 <DriverPayoutHistory />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/DriverPayslip" element={
 <ProtectedRoute requiredRole="driver_partner">
 <DashboardLayout>
 <DriverPayslip />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />

 {/* Other protected routes */}
 <Route
 path="/profile" element={
 <ProtectedRoute>
 <DashboardLayout>
 <AgentProfile />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/settings" element={
 <ProtectedRoute>
 <DashboardLayout>
 <div className="p-6">
 <h1>Settings Page</h1>
 <p>Settings coming soon...</p>
 </div>
 </DashboardLayout>
 </ProtectedRoute>
 }
 />

 {/* 404 catch-all */}
 <Route
 path="*" element={
 <div className="flex flex-col items-center justify-center min-h-screen">
 <h1 className="text-4xl font-bold mb-4">404</h1>
 <p className="text-muted-foreground mb-6">Page not found</p>
 <a href="/" className="text-primary hover:underline">
 Go to Dashboard
 </a>
 </div>
 }
 />
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
