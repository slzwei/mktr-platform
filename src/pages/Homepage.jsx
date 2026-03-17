import { useState, useEffect } from "react";
import { getDefaultRouteForRole } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import SiteHeader from "@/components/layout/SiteHeader";
import {
  FloatingElements,
  HeroSection,
  LeadSourcesSection,
  FeaturesSection,
  CTASection,
  FooterSection,
  AnnouncementModal,
} from "@/components/homepage";
import './Homepage.css';

export default function Homepage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user: authUser, token: authToken } = useAuthStore();

  const toggleMenu = () => setMenuOpen(!menuOpen);

  useEffect(() => {
    // Smooth scrolling behavior
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = 'auto';
    };
  }, []);

  const isAuthed = !!authToken && !!authUser;
  const dashboardPath = authUser ? getDefaultRouteForRole(authUser.role) : '/AdminDashboard';

  return (
    <>
      {/* Floating Background Elements */}
      <FloatingElements />

      <SiteHeader />

      {/* Hero Section - Responsive Design */}
      <HeroSection />

      {/* Lead Sources Section - WHITE BACKGROUND */}
      <LeadSourcesSection />

      {/* Features Section - BLACK BACKGROUND */}
      <FeaturesSection />

      {/* CTA Section - WHITE BACKGROUND */}
      <CTASection />

      {/* Footer - BLACK BACKGROUND */}
      <FooterSection />

      {/* Modal */}
      <AnnouncementModal />

      {/* Analytics Scripts */}
      <script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
      <script dangerouslySetInnerHTML={{
        __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('config', 'GA_MEASUREMENT_ID');
        `
      }} />
    </>
  );
}
