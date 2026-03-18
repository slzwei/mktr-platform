import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="mktr-hero">
      {/* Background Video */}
      <video
        className="mktr-hero-video"
        autoPlay
        muted
        loop
        playsInline
        poster="https://images.pexels.com/photos/3152126/pexels-photo-3152126.jpeg?auto=compress&cs=tinysrgb&w=1920"
      >
        <source
          src="https://videos.pexels.com/video-files/3129671/3129671-uhd_2560_1440_30fps.mp4"
          type="video/mp4"
        />
      </video>

      <div className="mktr-hero-overlay" />

      <div className="mktr-hero-content">
        <div className="mktr-reveal">
          <p className="mktr-hero-eyebrow">AI-Powered Lead Generation</p>
        </div>

        <h1 className="mktr-hero-title mktr-reveal mktr-reveal-delay-1">
          Turn Every<br />
          Conversation Into<br />
          <span className="accent">A Client.</span>
        </h1>

        <p className="mktr-hero-subtitle mktr-reveal mktr-reveal-delay-2">
          The lead generation platform built for Singapore's top insurance agents.
          Capture, nurture, and convert prospects with AI — online and offline.
        </p>

        <div className="flex flex-wrap gap-4 justify-center mktr-reveal mktr-reveal-delay-3">
          <Link to="/AdminDashboard" className="mktr-hero-cta">
            Get Started Free
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/LeadCapture" className="mktr-hero-cta-secondary">
            Schedule Demo
          </Link>
        </div>
      </div>

      <div className="mktr-hero-scroll-indicator">
        <ChevronDown className="w-6 h-6" style={{ color: 'var(--mktr-text-dim)' }} />
      </div>
    </section>
  );
};

export default HeroSection;
