import { lazy, Suspense, useEffect } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import RedeemOpsRoute from '@/components/auth/RedeemOpsRoute';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RedeemOpsLayout from '@/components/redeemops/RedeemOpsLayout';
import { BrowserRouter as Router, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import { brand } from '@/lib/brand';
import {
  MktrOnlyRedirect,
  NotFoundForBrand,
  IS_REDEEM_BUILD,
} from '@/components/auth/BrandRouteGuards';

const LeadCapture = lazy(() => import('./LeadCapture'));
const LeadCaptureDemo = lazy(() => import('./LeadCaptureDemo'));
const RewardClaim = lazy(() => import('./RewardClaim'));
const PublicPreview = lazy(() => import('./public/Preview'));
const TrackRedirect = lazy(() => import('./TrackRedirect'));
const ShareRedirect = lazy(() => import('./ShareRedirect'));

// Design exploration prototypes — safe to delete src/pages/preview/ once a direction is picked
const PreviewHub = lazy(() => import('./preview/PreviewHub'));
const AtelierPreview = lazy(() => import('./preview/AtelierPreview'));
const AuroraPreview = lazy(() => import('./preview/AuroraPreview'));
const SpecimenPreview = lazy(() => import('./preview/SpecimenPreview'));

const Homepage = lazy(() => import('./Homepage'));
const RedeemHome = lazy(() => import('./RedeemHome'));
const RedeemWinners = lazy(() => import('./RedeemWinners'));
// Marketplace v2 (redeem build only, dark behind VITE_REDEEM_MARKETPLACE_ENABLED —
// docs/plans/redeem-marketplace-v2.md Phase 3). None of these chunks are
// referenced on the mktr build or while the flag is off.
const MarketplaceHome = lazy(() => import('./marketplace/MarketplaceHome'));
const MarketplaceBrowse = lazy(() => import('./marketplace/MarketplaceBrowse'));
const MarketplaceOffer = lazy(() => import('./marketplace/MarketplaceOffer'));
const MarketplaceFlow = lazy(() => import('./marketplace/MarketplaceFlow'));
const MarketplaceStatic = lazy(() => import('./marketplace/MarketplaceStatic'));
const MarketplaceDsa = lazy(() => import('./marketplace/MarketplaceDsa'));

const MARKETPLACE_ON =
  IS_REDEEM_BUILD && import.meta.env.VITE_REDEEM_MARKETPLACE_ENABLED === 'true';
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
const LeadsPrivacy = lazy(() => import('./LeadsPrivacy'));
const DevRoutes = lazy(() => import('../dev/DevRoutes'));

const AdminDashboard = lazy(() => import('./AdminDashboard'));
const AdminProspects = lazy(() => import('./AdminProspects'));

// ── Switchboard admin v2 (docs/plans/mktr-admin-rebuild-implementation.md
// Phase C) — dark until VITE_ADMIN_V2_ENABLED=true is baked into the build.
// Flag ON swaps the SAME admin URLs onto the v2 screens (bookmarks survive);
// un-rebuilt routes keep their legacy pages until their PR lands.
const ADMIN_V2 = import.meta.env.VITE_ADMIN_V2_ENABLED === 'true';
const AdminV2Shell = lazy(() => import('@/components/adminv2/AdminV2Shell'));
const AdminV2Dashboard = lazy(() => import('./adminv2/AdminV2Dashboard'));
const AdminV2Prospects = lazy(() => import('./adminv2/AdminV2Prospects'));
const AdminV2Campaigns = lazy(() => import('./adminv2/AdminV2Campaigns'));
const AdminV2CampaignDetail = lazy(() => import('./adminv2/AdminV2CampaignDetail'));
const AdminV2Agents = lazy(() => import('./adminv2/AdminV2Agents'));
const AdminV2AgentGroups = lazy(() => import('./adminv2/AdminV2AgentGroups'));
const AdminV2Wallets = lazy(() => import('./adminv2/AdminV2Wallets'));
const AdminV2QRCodes = lazy(() => import('./adminv2/AdminV2QRCodes'));
const AdminV2ShortLinks = lazy(() => import('./adminv2/AdminV2ShortLinks'));
const AdminV2Users = lazy(() => import('./adminv2/AdminV2Users'));
const AdminV2AISettings = lazy(() => import('./adminv2/AdminV2AISettings'));
const AdminCampaigns = lazy(() => import('./AdminCampaigns'));
const AdminCampaignForm = lazy(() => import('./AdminCampaignForm'));
const AdminQRCodes = lazy(() => import('./AdminQRCodes'));
const AdminAgents = lazy(() => import('./AdminAgents'));
const AdminAgentDetail = lazy(() => import('./AdminAgentDetail'));
const AdminUsers = lazy(() => import('./AdminUsers'));
const AdminFleet = lazy(() => import('./AdminFleet'));
const AdminCampaignDesigner = lazy(() => import('./AdminCampaignDesigner'));
const AdminCampaignWorkspace = lazy(() => import('./AdminCampaignWorkspace'));
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
const AdminAISettings = lazy(() => import('./AdminAISettings'));
const AgentDashboard = lazy(() => import('./AgentDashboard'));

const FleetOwnerDashboard = lazy(() => import('./FleetOwnerDashboard'));
const DriverDashboard = lazy(() => import('./DriverDashboard'));
const DriverProfile = lazy(() => import('./DriverProfile'));
const DriverPayoutHistory = lazy(() => import('./DriverPayoutHistory'));
const DriverPayslip = lazy(() => import('./DriverPayslip'));
const MyProspects = lazy(() => import('./MyProspects'));
const ProspectDetailPage = lazy(() => import('./ProspectDetailPage'));
const AgentProfile = lazy(() => import('./AgentProfile'));

// Redeem Ops — flag-gated internal staff surface (docs/redeem-ops/ROUTE_MAP.md §2).
// Dark until VITE_REDEEM_OPS_ENABLED=true is baked into the build.
const REDEEM_OPS_ENABLED = import.meta.env.VITE_REDEEM_OPS_ENABLED === 'true';
const DISCOVERY_ENABLED = import.meta.env.VITE_DISCOVERY_ENABLED === 'true';
const CADENCES_ENABLED = import.meta.env.VITE_REDEEM_OPS_CADENCES_ENABLED === 'true';
const RedeemOpsHome = lazy(() => import('./redeemops/RedeemOpsHome'));
const RedeemOpsTeam = lazy(() => import('./redeemops/RedeemOpsTeam'));
const RedeemOpsPartnersList = lazy(() => import('./redeemops/PartnersList'));
const RedeemOpsDiscover = lazy(() => import('./redeemops/DiscoverPage'));
const RedeemOpsPartnerDetail = lazy(() => import('./redeemops/PartnerDetail'));
const RedeemOpsMyQueue = lazy(() => import('./redeemops/MyQueue'));
const RedeemOpsTasks = lazy(() => import('./redeemops/TasksPage'));
const RedeemOpsPools = lazy(() => import('./redeemops/PoolsPage'));
const RedeemOpsTeamPipeline = lazy(() => import('./redeemops/TeamPipeline'));
const RedeemOpsRewards = lazy(() => import('./redeemops/RewardsPage'));
const RedeemOpsRewardDetail = lazy(() => import('./redeemops/RewardDetail'));
const RedeemOpsActivations = lazy(() => import('./redeemops/ActivationsPage'));
const RedeemOpsActivationDetail = lazy(() => import('./redeemops/ActivationDetail'));
const RedeemOpsRedemptions = lazy(() => import('./redeemops/RedemptionsPage'));
const RedeemOpsAnalytics = lazy(() => import('./redeemops/AnalyticsPage'));
const RedeemOpsProfile = lazy(() => import('./redeemops/ProfilePage'));
const RedeemOpsSettings = lazy(() => import('./redeemops/SettingsPage'));
const RedeemOpsCadenceEditor = lazy(() => import('./redeemops/CadenceEditorPage'));

// ops.redeem.sg — dedicated staff surface (docs/redeem-ops/
// USER_SURFACES_AND_DEPLOYMENT_BOUNDARIES.md). Mirrors the VITE_BRAND pattern:
// the ops build registers ONLY auth + redeem-ops routes; everything else
// redirects into /redeem-ops. The backend independently enforces the same
// boundary (internalRouteHostGuard's strict ops allowlist).
const IS_OPS_SURFACE = import.meta.env.VITE_SURFACE === 'ops';

/**
 * The redeem-ops routes, shared verbatim between the mktr.sg dogfood
 * surface and the ops.redeem.sg build so the two can never drift.
 */
function redeemOpsRouteElements() {
  if (!REDEEM_OPS_ENABLED) return [];
  const routes = [
    { path: '/redeem-ops', capability: null, Page: RedeemOpsHome },
    { path: '/redeem-ops/team', capability: 'analytics.view_team', Page: RedeemOpsTeam },
    { path: '/redeem-ops/partners', capability: 'partners.view', Page: RedeemOpsPartnersList },
    { path: '/redeem-ops/partners/:id', capability: 'partners.view', Page: RedeemOpsPartnerDetail },
    // Discover is dark until its own build flag AND the backend token are set —
    // it has no capability gate (all principals), so this flag is what hides it.
    ...(DISCOVERY_ENABLED ? [{ path: '/redeem-ops/discover', capability: null, Page: RedeemOpsDiscover }] : []),
    { path: '/redeem-ops/queue', capability: null, Page: RedeemOpsMyQueue },
    { path: '/redeem-ops/tasks', capability: 'tasks.manage', Page: RedeemOpsTasks },
    { path: '/redeem-ops/pools', capability: 'pools.claim_next', Page: RedeemOpsPools },
    { path: '/redeem-ops/pipeline', capability: 'pipeline.view_team', Page: RedeemOpsTeamPipeline },
    { path: '/redeem-ops/rewards', capability: 'rewards.view', Page: RedeemOpsRewards },
    { path: '/redeem-ops/rewards/:id', capability: 'rewards.view', Page: RedeemOpsRewardDetail },
    { path: '/redeem-ops/activations', capability: 'activations.view', Page: RedeemOpsActivations },
    { path: '/redeem-ops/activations/:id', capability: 'activations.view', Page: RedeemOpsActivationDetail },
    { path: '/redeem-ops/redemptions', capability: 'redemptions.verify', Page: RedeemOpsRedemptions },
    { path: '/redeem-ops/analytics', capability: 'analytics.view_own', Page: RedeemOpsAnalytics },
    { path: '/redeem-ops/profile', capability: null, Page: RedeemOpsProfile },
    { path: '/redeem-ops/settings', capability: 'settings.manage', Page: RedeemOpsSettings },
    // Full-page cadence editor (a dialog was too cramped for a step editor).
    // tasks.manage: any rep can author — unpublished saves stay private drafts
    // (creator + admins); the service enforces per-row edit rights.
    ...(CADENCES_ENABLED ? [
      { path: '/redeem-ops/cadences/new', capability: 'tasks.manage', Page: RedeemOpsCadenceEditor },
      { path: '/redeem-ops/cadences/:cadenceId/edit', capability: 'tasks.manage', Page: RedeemOpsCadenceEditor },
    ] : []),
  ];
  return routes.map(({ path, capability, Page }) => (
    <Route
      key={path}
      path={path}
      element={
        <RedeemOpsRoute capability={capability || undefined}>
          <RedeemOpsLayout>
            <Page />
          </RedeemOpsLayout>
        </RedeemOpsRoute>
      }
    />
  ));
}

/** ops.redeem.sg route table: auth + redeem-ops, nothing else. */
function OpsSurfaceRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/redeem-ops" replace />} />
      <Route path="/CustomerLogin" element={<CustomerLogin />} />
      <Route path="/ForgotPassword" element={<ForgotPassword />} />
      <Route path="/auth/google/callback" element={<GoogleCallback />} />
      <Route path="/auth/accept-invite" element={<AcceptInvite />} />
      <Route path="/PendingApproval" element={<PendingApproval />} />
      {redeemOpsRouteElements()}
      {/* Anything else (old links, admin paths) lands on the queue; the
          route guard bounces logged-out visitors to /CustomerLogin. */}
      <Route path="*" element={<Navigate to="/redeem-ops" replace />} />
    </Routes>
  );
}

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
 {IS_OPS_SURFACE ? <OpsSurfaceRoutes /> : (
 <Routes>
 {/* Public routes - no protection needed. Lead capture flow stays on both brands. */}
 <Route path="/" element={brand.showHomepage ? <Homepage /> : (MARKETPLACE_ON ? <MarketplaceHome /> : IS_REDEEM_BUILD ? <RedeemHome /> : <LeadCapture />)} />
 <Route path="/LeadCapture" element={<LeadCapture />} />
 <Route path="/winners" element={IS_REDEEM_BUILD ? <RedeemWinners /> : <NotFoundForBrand />} />
 {/* Marketplace v2 surfaces (redeem build, flag-gated) */}
 {MARKETPLACE_ON && (
 <>
 <Route path="/explore" element={<MarketplaceBrowse mode="explore" />} />
 <Route path="/c/:id" element={<MarketplaceBrowse mode="category" />} />
 <Route path="/dsa" element={<MarketplaceDsa />} />
 <Route path="/offers/:slug" element={<MarketplaceOffer />} />
 <Route path="/flow/:slug" element={<MarketplaceFlow />} />
 <Route path="/how-it-works" element={<MarketplaceStatic mode="how" />} />
 <Route path="/businesses" element={<MarketplaceStatic mode="businesses" />} />
 <Route path="/legal/:doc" element={<MarketplaceStatic mode="legal" />} />
 </>
 )}
 <Route path="/LeadCapture/demo" element={<LeadCaptureDemo />} />
 <Route path="/p/:slug" element={<PublicPreview />} />
 <Route path="/t/:slug" element={<TrackRedirect />} />
 <Route path="/share/:slug" element={<ShareRedirect />} />
 {/* Consumer reward journey — reservation pass / voucher (docs/redeem-ops/ROUTE_MAP.md) */}
 <Route path="/r/:token" element={<RewardClaim />} />

 {/* Design exploration prototypes — mktr build only */}
 <Route path="/preview" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <PreviewHub />} />
 <Route path="/preview/atelier" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <AtelierPreview />} />
 <Route path="/preview/aurora" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <AuroraPreview />} />
 <Route path="/preview/specimen" element={IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <SpecimenPreview />} />

 {/* Public marketing — brand-aware (D2: redeem hides Homepage/Features/Pricing/About). */}
 <Route path="/Homepage" element={brand.showHomepage ? <Homepage /> : <NotFoundForBrand />} />
 <Route path="/features" element={brand.showFeatures ? <Features /> : <NotFoundForBrand />} />
 <Route path="/pricing" element={brand.showPricing ? <Pricing /> : <NotFoundForBrand />} />
 <Route path="/about" element={brand.showAbout ? <About /> : MARKETPLACE_ON ? <MarketplaceStatic mode="about" /> : <NotFoundForBrand />} />
 <Route path="/Contact" element={<Contact />} />
 <Route path="/personal-data-policy" element={<PersonalDataPolicy />} />
 <Route path="/leads/privacy" element={<LeadsPrivacy />} />

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
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2Dashboard />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminDashboard />
 </DashboardLayout>
 )}
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminShortLinks" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2ShortLinks />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminShortLinks />
 </DashboardLayout>
 )}
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminProspects" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2Prospects />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminProspects />
 </DashboardLayout>
 )}
 </ProtectedRoute>
 }
 />
 {ADMIN_V2 && (
 <Route
 path="/admin/campaigns/:id" element={
 <ProtectedRoute requiredRole="admin">
 <AdminV2Shell>
 <AdminV2CampaignDetail />
 </AdminV2Shell>
 </ProtectedRoute>
 }
 />
 )}
 {ADMIN_V2 && (
 <Route
 path="/AdminWallets" element={
 <ProtectedRoute requiredRole="admin">
 <AdminV2Shell>
 <AdminV2Wallets />
 </AdminV2Shell>
 </ProtectedRoute>
 }
 />
 )}
 <Route
 path="/AdminCampaigns" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2Campaigns />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminCampaigns />
 </DashboardLayout>
 )}
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
 {/* Campaign Launch Workspace — unified create/edit/design/pool/sources/launch. */}
 <Route
 path="/admin/campaigns/workspace" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCampaignWorkspace />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/admin/campaigns/:id/workspace" element={
 <ProtectedRoute requiredRole="admin">
 <DashboardLayout>
 <AdminCampaignWorkspace />
 </DashboardLayout>
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminQRCodes" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2QRCodes />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminQRCodes />
 </DashboardLayout>
 )}
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminAgentGroups" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2AgentGroups />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminAgentGroups />
 </DashboardLayout>
 )}
 </ProtectedRoute>
 }
 />
 <Route
 path="/AdminAgents" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2Agents />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminAgents />
 </DashboardLayout>
 )}
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
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2Users />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminUsers />
 </DashboardLayout>
 )}
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

 {/* Redeem Ops — flag-gated internal staff surface (shared with ops.redeem.sg) */}
 {redeemOpsRouteElements()}

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
 path="/AdminAISettings" element={
 <ProtectedRoute requiredRole="admin">
 {ADMIN_V2 ? (
 <AdminV2Shell>
 <AdminV2AISettings />
 </AdminV2Shell>
 ) : (
 <DashboardLayout>
 <AdminAISettings />
 </DashboardLayout>
 )}
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
 )}
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
