import Layout from "./Layout.jsx";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import DashboardLayout from "@/components/layout/DashboardLayout";

import LeadCapture from "./LeadCapture";

import AdminDashboard from "./AdminDashboard";

import AdminProspects from "./AdminProspects";

import AdminCampaigns from "./AdminCampaigns";

import AdminQRCodes from "./AdminQRCodes";

import AdminAgents from "./AdminAgents";

import AdminFleet from "./AdminFleet";

import AdminCampaignDesigner from "./AdminCampaignDesigner";

import AdminCommissions from "./AdminCommissions";

import Homepage from "./Homepage";

import Contact from "./Contact";

import CustomerLogin from "./CustomerLogin";

import AdminLogin from "./AdminLogin";

import GoogleCallback from "./GoogleCallback";

import AgentDashboard from "./AgentDashboard";

import FleetOwnerDashboard from "./FleetOwnerDashboard";

import ApiTest from "./ApiTest";
import AuthTest from "./AuthTest";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PublicPreview from './public/Preview';

const PAGES = {
    
    LeadCapture: LeadCapture,
    
    AdminDashboard: AdminDashboard,
    
    AdminProspects: AdminProspects,
    
    AdminCampaigns: AdminCampaigns,
    
    AdminQRCodes: AdminQRCodes,
    
    AdminAgents: AdminAgents,
    
    AdminFleet: AdminFleet,
    
    AdminCampaignDesigner: AdminCampaignDesigner,
    
    AdminCommissions: AdminCommissions,
    
    Homepage: Homepage,
    
    Contact: Contact,
    
    CustomerLogin: CustomerLogin,
    
    AdminLogin: AdminLogin,
    
    GoogleCallback: GoogleCallback,
    
    AgentDashboard: AgentDashboard,
    
    FleetOwnerDashboard: FleetOwnerDashboard,
    
    ApiTest: ApiTest,
    
    AuthTest: AuthTest,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    return (
        <Routes>            
            {/* Public routes - no protection needed */}
            <Route path="/" element={<Homepage />} />
            <Route path="/LeadCapture" element={<LeadCapture />} />
            <Route path="/p/:slug" element={<PublicPreview />} />
            <Route path="/Homepage" element={<Homepage />} />
            <Route path="/Contact" element={<Contact />} />
            <Route path="/CustomerLogin" element={<CustomerLogin />} />
            <Route path="/AdminLogin" element={<AdminLogin />} />
            <Route path="/auth/google/callback" element={<GoogleCallback />} />
            <Route path="/ApiTest" element={<ApiTest />} />
            <Route path="/AuthTest" element={<AuthTest />} />
            
            {/* Protected Admin routes */}
            <Route path="/AdminDashboard" element={
                <ProtectedRoute requiredRole="admin">
                    <DashboardLayout>
                        <AdminDashboard />
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
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}