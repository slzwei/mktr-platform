import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import TypewriterText from "./TypewriterText";

const HeroSection = () => {
  return (
    <section className="hero-section text-white pb-16 pt-20">
  <div className="container relative z-10 w-full">
    <div className="text-center max-w-4xl mx-auto hero-desktop-padding hero-mobile-padding">
      <p className="section-title !text-white mb-8">
        Singapore's First Dual-Channel Lead Gen for Agents.
      </p>

      <h1 className="mb-10 hero-title text-white">
        <TypewriterText
          text="LEAD GEN\nFROM STREET, TO SCREEN."
          speed={120}
          delay={500}
        />
      </h1>

      <p className="mt-6 mb-10 mx-auto text-lg body-text max-w-2xl text-white leading-relaxed">
        <span>Singapore's only lead gen system built for salespeople</span>
        <span className="block">to capture leads online and offline.</span>
      </p>

      <div className="flex flex-col sm:flex-row gap-8 justify-center mobile-button-container">
        <Link
          to={"/AdminDashboard"}
          className="btn-primary bg-white text-black hover:bg-gray-100 dark:hover:bg-gray-200 hover:text-black transition-all duration-300"
        >
          Get Started
          <ArrowRight className="w-4 h-4" />
        </Link>
        <Link
          to={"/LeadCapture"}
          className="btn-primary bg-white text-black hover:bg-gray-100 dark:hover:bg-gray-200 hover:text-black transition-all duration-300"
        >
          Schedule DEMO
        </Link>
      </div>
    </div>
  </div>
</section>
  );
};

export default HeroSection;
