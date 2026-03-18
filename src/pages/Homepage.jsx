import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import SiteHeader from "@/components/layout/SiteHeader";
import {
  FloatingElements,
  HeroSection,
  LeadSourcesSection,
  FeaturesSection,
  TestimonialSection,
  PricingSection,
  CTASection,
  FooterSection,
  AnnouncementModal,
} from "@/components/homepage";
import './Homepage.css';

export default function Homepage() {
  const { user: authUser, token: authToken } = useAuthStore();

  useEffect(() => {
    // Smooth scrolling
    document.documentElement.style.scrollBehavior = 'smooth';

    // Scroll-reveal observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    const observe = () =>
      document.querySelectorAll('.mktr-reveal').forEach((el) => observer.observe(el));
    observe();

    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.documentElement.style.scrollBehavior = 'auto';
      observer.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div style={{ background: 'var(--mktr-bg)' }}>
      <FloatingElements />
      <SiteHeader />
      <HeroSection />
      <LeadSourcesSection />
      <FeaturesSection />
      <TestimonialSection />
      <PricingSection />
      <CTASection />
      <FooterSection />
      <AnnouncementModal />
    </div>
  );
}
