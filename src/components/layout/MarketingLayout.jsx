import { useEffect } from "react";
import SiteHeader from "./SiteHeader";
import { FooterSection, FloatingElements } from "@/components/homepage";

/**
 * Shared layout for all public marketing pages.
 * Provides the dark theme wrapper, header, floating particles, footer,
 * and scroll-reveal observer.
 */
export default function MarketingLayout({ children }) {
  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    // Observe on mount and re-observe on DOM changes (for lazy-loaded sections)
    const observe = () =>
      document.querySelectorAll(".mktr-reveal").forEach((el) => observer.observe(el));
    observe();

    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.documentElement.style.scrollBehavior = "auto";
      observer.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div style={{ background: "var(--mktr-bg, #060918)", minHeight: "100vh" }}>
      <FloatingElements />
      <SiteHeader />
      {/* Spacer for fixed header */}
      <div style={{ height: 72 }} />
      {children}
      <FooterSection />
    </div>
  );
}
