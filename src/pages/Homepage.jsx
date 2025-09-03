
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Shield,
  Users,
  TrendingUp,
  QrCode,
  Car,
  DollarSign,
  ArrowRight,
  X,
  ChevronLeft,
  ChevronRight,
  Phone, // Added Phone icon
  MapPin, // Added MapPin icon
  Target,
  Zap,
  MessageSquare,
  Smartphone
} from
"lucide-react";

// Hamburger Menu Component
const HamburgerMenu = ({ isOpen, toggle }) =>
<button
  className={`hamburger hamburger--spring ${isOpen ? 'is-active' : ''}`}
  type="button"
  onClick={toggle}
  aria-label="Menu">

    <span className="hamburger-box">
      <span className="hamburger-inner"></span>
    </span>
  </button>;


// Typewriter Effect Component
// Note: Original code had duplicate imports and an export default here.
// These have been removed as TypewriterText is an internal component
// within this file and not a separate module export.
const TypewriterText = ({ text, speed = 100, delay = 0 }) => {
  // Normalize: replace literal "\n" with real newlines
  const sourceText = useMemo(
    () =>
    String(text).
    replace(/\r\n/g, "\n").
    replace(/\r/g, "\n").
    replace(/\\n/g, "\n"),
    [text]
  );

  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setDisplayText("");
    setCurrentIndex(0);
  }, [sourceText]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentIndex < sourceText.length) {
        setDisplayText((prev) => prev + sourceText[currentIndex]);
        setCurrentIndex((prev) => prev + 1);
      }
    }, currentIndex === 0 ? delay : speed);

    return () => clearTimeout(timer);
  }, [currentIndex, sourceText, speed, delay]);

  return (
    <span className="whitespace-pre-line text-white">
      {displayText}
      {/* Cursor always blinks, even after typing finishes */}
      <span className="blinking-cursor">|</span>
    </span>);

};

// Parallax Section Component (retained for potential future use, though sections below are changed)
const ParallaxSection = ({ children, backgroundImage, speed = 0.5, className = "" }) => {
  const parallaxRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      if (parallaxRef.current) {
        const scrolled = window.pageYOffset;
        const parallax = scrolled * speed;
        parallaxRef.current.style.transform = `translateY(${parallax}px)`;
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [speed]);

  return (
    <div className={`parallax-section ${className}`}>
      {backgroundImage &&
      <div
        ref={parallaxRef}
        className="parallax-bg"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }} />

      }
      <div className={`parallax-content ${className.includes('flex') ? 'flex items-center justify-center' : ''}`}>
        {children}
      </div>
    </div>);

};

// Modal Component
const AnnouncementModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasSeenModal = localStorage.getItem('mktr-modal-seen');
    if (!hasSeenModal) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const closeModal = () => {
    setIsOpen(false);
    localStorage.setItem('mktr-modal-seen', 'true');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={closeModal}>
          <X className="w-6 h-6" />
        </button>
        <div className="modal-body">
          <h3 className="modal-title">Welcome to MKTR.</h3>
          <p className="modal-text">
            Singapore's premier marketer platform for intelligent lead generation.
            Get started with smart prospect capture and campaign management.
          </p>
          <Link to={createPageUrl("AdminDashboard")}>
            <Button className="modal-cta">
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>);

};

// Floating Elements Component
const FloatingElements = () => {
  const elementsRef = useRef([]);

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.pageYOffset;
      elementsRef.current.forEach((el, index) => {
        if (el) {
          const speed = 0.1 + index * 0.05;
          const yPos = -(scrolled * speed);
          el.style.transform = `translate3d(0, ${yPos}px, 0)`;
        }
      });
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="floating-elements">
      <div
        ref={(el) => elementsRef.current[0] = el}
        className="floating-element floating-element-1">

        <QrCode className="w-8 h-8 text-gray-200" />
      </div>
      <div
        ref={(el) => elementsRef.current[1] = el}
        className="floating-element floating-element-2">

        <TrendingUp className="w-6 h-6 text-gray-300" />
      </div>
      <div
        ref={(el) => elementsRef.current[2] = el}
        className="floating-element floating-element-3">

        <Users className="w-10 h-10 text-gray-100" />
      </div>
      <div
        ref={(el) => elementsRef.current[3] = el}
        className="floating-element floating-element-4">

        <Car className="w-7 h-7 text-gray-200" />
      </div>
    </div>);

};

export default function Homepage() {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => setMenuOpen(!menuOpen);

  useEffect(() => {
    // Smooth scrolling behavior
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = 'auto';
    };
  }, []);

  return (
    <>
      <style jsx>{`
        /* CSS Custom Properties */
        :root {
          --heading-font: 'Mindset', 'Inter', sans-serif;
          --body-font: 'Inter', sans-serif;
          --mono-font: 'PT Mono', 'Courier New', monospace;
          --black: #000000;
          --white: #ffffff;
          --grey: #909090;
        }

        /* Import Fonts */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=PT+Mono:wght@400&display=swap');

        /* Hero Section with GIF Background */
        .hero-section {
          position: relative;
          background: black;
          overflow: hidden;
          min-height: 100vh; /* Full height for desktop */
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .hero-section::before {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: url("https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExYTFzZnpzZGwzbjJ2MzZ0ejQ2bDdnYmlqbWhsdnlkcnFwazlsNnpwZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/CKlafeh1NAxz35KTq4/giphy.gif") center/cover;
          opacity: 0.15;
          mix-blend-mode: screen;
          pointer-events: none;
        }

        /* Desktop Hero Padding */
        .hero-desktop-padding {
          /* Defined globally, but intended for desktop.
             Will be applied conditionally or overridden by mobile-specific padding. */
          padding: 8rem 2rem;
        }

        /* Mobile Hero Padding */
        .hero-mobile-padding {
          /* Defined globally, then overridden below for actual mobile */
          padding: 6rem 1rem 4rem 1rem;
        }

        /* Typography - Responsive Hero Title */
        .hero-title {
          font-family: var(--heading-font);
          font-size: clamp(2.5rem, 8vw, 6rem); /* Default/Tablet range */
          line-height: 0.9;
          font-weight: 700;
          color: var(--white);
          margin: 0;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        /* Mobile Adjustments for Hero Section */
        @media (max-width: 768px) {
          .hero-section {
            min-height: auto; /* Remove full height constraint on mobile */
            padding: 0; /* Reset padding, let classes handle it */
          }

          .hero-title {
            font-size: clamp(2rem, 8vw, 3.5rem);
            line-height: 1.1;
          }

          .hero-mobile-padding { /* Specific override for hero-mobile-padding on actual mobile */
            padding-top: 120px; /* Account for fixed header */
            padding-bottom: 3rem;
            padding-left: 1rem;
            padding-right: 1rem;
          }
        }

        /* Desktop Adjustments */
        @media (min-width: 769px) {
          .hero-section {
            min-height: 100vh;
          }
          
          .hero-title {
            font-size: clamp(3rem, 6vw, 5rem);
            line-height: 0.9;
          }
        }

        /* Parallax Styles (retained for ParallaxSection component definition) */
        .parallax-section {
          position: relative;
          overflow: hidden;
        }

        .parallax-bg {
          position: absolute;
          top: -20%;
          left: 0;
          width: 100%;
          height: 120%;
          z-index: -1;
          will-change: transform;
        }

        .parallax-content {
          position: relative;
          z-index: 1;
        }

        .floating-elements {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
        }

        .floating-element {
          position: absolute;
          will-change: transform;
          opacity: 0.3;
        }

        .floating-element-1 {
          top: 20%;
          right: 10%;
          animation: float 6s ease-in-out infinite;
        }

        .floating-element-2 {
          top: 60%;
          left: 5%;
          animation: float 8s ease-in-out infinite reverse;
        }

        .floating-element-3 {
          top: 40%;
          right: 5%;
          animation: float 7s ease-in-out infinite;
        }

        .floating-element-4 {
          top: 80%;
          left: 15%;
          animation: float 9s ease-in-out infinite reverse;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
        }

        /* Decorative icons specific animations for hero section */
        /* Removed as RandomDecorativeIcons component is removed */

        .parallax-card {
          transition: transform 0.3s ease;
        }

        .parallax-card:hover {
          transform: translateY(-10px);
        }

        /* Hamburger Menu Styles */
        .hamburger {
          padding: 15px 15px;
          display: inline-block;
          cursor: pointer;
          transition-property: opacity, filter;
          transition-duration: 0.15s;
          transition-timing-function: linear;
          font: inherit;
          color: inherit;
          text-transform: none;
          background-color: transparent;
          border: 0;
          margin: 0;
          overflow: visible;
          z-index: 1000;
          position: relative;
        }

        .hamburger:hover {
          opacity: 0.7;
        }

        .hamburger-box {
          width: 40px;
          height: 24px;
          display: inline-block;
          position: relative;
        }

        .hamburger-inner {
          display: block;
          top: 50%;
          margin-top: -2px;
        }

        .hamburger-inner,
        .hamburger-inner::before,
        .hamburger-inner::after {
          width: 40px;
          height: 4px;
          background-color: var(--black);
          border-radius: 4px;
          position: absolute;
          transition-property: transform;
          transition-duration: 0.15s;
          transition-timing-function: ease;
        }

        .hamburger-inner::before,
        .hamburger-inner::after {
          content: "";
          display: block;
        }

        .hamburger-inner::before {
          top: -10px;
        }

        .hamburger-inner::after {
          bottom: -10px;
        }

        /* Spring Animation */
        .hamburger--spring .hamburger-inner {
          top: 2px;
          transition: background-color 0s 0.13s linear;
        }

        .hamburger--spring .hamburger-inner::before {
          top: 10px;
          transition: top 0.1s 0.2s cubic-bezier(0.33333, 0.66667, 0.66667, 1), transform 0.13s cubic-bezier(0.55, 0.055, 0.675, 0.19);
        }

        .hamburger--spring .hamburger-inner::after {
          top: 20px;
          transition: top 0.2s 0.2s cubic-bezier(0.33333, 0.66667, 0.66667, 1), transform 0.13s cubic-bezier(0.55, 0.055, 0.675, 0.19);
        }

        .hamburger--spring.is-active .hamburger-inner {
          transition-delay: 0.22s;
          background-color: transparent !important;
        }

        .hamburger--spring.is-active .hamburger-inner::before {
          top: 0;
          transition: top 0.1s 0.15s cubic-bezier(0.33333, 0, 0.66667, 0.33333), transform 0.13s 0.22s cubic-bezier(0.215, 0.61, 0.355, 1);
          transform: translate3d(0, 10px, 0) rotate(45deg);
        }

        .hamburger--spring.is-active .hamburger-inner::after {
          top: 0;
          transition: top 0.2s cubic-bezier(0.33333, 0, 0.66667, 0.33333), transform 0.13s 0.22s cubic-bezier(0.215, 0.61, 0.355, 1);
          transform: translate3d(0, 10px, 0) rotate(-45deg);
        }

        /* Blinker */
        .blinking-cursor {
          display: inline-block;
          width: 1ch;
          animation: blink 1s steps(2, start) infinite;
        }

        @keyframes blink {
          to {
            visibility: hidden;
          }
        }

        /* Mobile Menu Overlay */
        .fixed.inset-0.bg-black.bg-opacity-50.z-998 {
          z-index: 998;
        }

        /* Mobile Menu */
        .mobile-menu {
          position: fixed;
          top: 0;
          right: 0;
          width: 100%; /* Default for larger screens until max-width kicks in */
          max-width: 320px; /* Constrain width on larger screens */
          height: 100vh;
          background: var(--white);
          z-index: 999;
          transform: translateX(100%);
          transition: transform 0.3s ease;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
          box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
        }

        .mobile-menu.open {
          transform: translateX(0);
        }

        .mobile-menu-link {
          font-family: var(--mono-font);
          font-size: 1.1rem; /* Adjusted font size */
          text-transform: uppercase;
          letter-spacing: 2px;
          color: var(--black);
          text-decoration: none;
          transition: opacity 0.2s ease;
          padding: 0.75rem 0; /* Added padding for better touch targets */
        }

        .mobile-menu-link:hover {
          opacity: 0.7;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease;
        }

        .modal-content {
          background: var(--white);
          padding: 2rem; /* Adjusted padding */
          max-width: 90vw; /* Max width relative to viewport */
          width: 100%; /* Take full width within max-width */
          max-width: 500px; /* Absolute max-width */
          position: relative;
          animation: scaleIn 0.3s ease;
        }

        .modal-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--black);
        }

        .modal-title {
          font-family: var(--heading-font);
          font-size: 1.8rem; /* Adjusted font size */
          margin-bottom: 1rem;
          color: var(--black);
        }

        .modal-text {
          font-family: var(--body-font);
          color: var(--grey);
          margin-bottom: 2rem;
          line-height: 1.6;
        }

        .modal-cta {
          background: var(--black);
          color: var(--white);
          border: none;
          padding: 0.75rem 1.5rem;
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 1px;
          cursor: pointer;
          transition: opacity 0.2s ease;
          width: 100%; /* Made button full width */
        }

        .modal-cta:hover {
          opacity: 0.8;
        }

        /* Animations */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        /* Typography */
        /* These are defaults, overridden by responsive rules for hero-title */
        .section-title {
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 3px;
          font-size: 0.875rem;
          color: var(--black);
          margin-bottom: 2rem;
        }

        .body-text {
          font-family: var(--body-font);
          font-size: 1.125rem;
          line-height: 1.7;
          color: var(--grey);
        }

        /* Layout */
        .section-spacing {
          padding: 6rem 0;
          position: relative;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
          position: relative;
          z-index: 2;
        }

        /* Buttons */
        .btn-primary {
          background: var(--black);
          color: var(--white);
          border: none;
          padding: 1rem 2rem;
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 1px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          cursor: pointer;
          width: 100%; /* Default to full width for better mobile behavior */
          justify-content: center; /* Center content */
        }

        .btn-primary:hover {
          opacity: 0.8;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }

        .btn-outline {
          background: transparent;
          color: var(--black);
          border: 2px solid var(--black);
          padding: 1rem 2rem;
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 1px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          cursor: pointer;
          width: 100%; /* Default to full width for better mobile behavior */
          justify-content: center; /* Center content */
        }

        .btn-outline:hover {
          background: var(--black);
          color: var(--white);
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }

        /* Header */
        .header {
          position: fixed;
          top: 0;
          width: 100%;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          z-index: 100;
          border-bottom: 1px solid var(--grey);
          transition: all 0.3s ease;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 0;
        }

        .logo {
          font-family: var(--heading-font);
          font-size: 2rem;
          font-weight: 700;
          color: var(--black);
          text-decoration: none;
          transition: transform 0.3s ease;
        }

        .logo:hover {
          transform: scale(1.05);
        }

        /* Mobile Optimizations */
        @media (max-width: 768px) {
          .section-spacing {
            padding: 3rem 0; /* Reduced padding for mobile sections */
          }

          .container {
            padding: 0 1rem; /* Smaller horizontal padding */
          }

          .floating-elements {
            display: none; /* Hide floating elements on smaller screens */
          }

          .mobile-menu {
            width: 85vw; /* Adjust width for mobile menu */
            max-width: none; /* Override max-width set for larger screens */
          }

          .btn-primary, .btn-outline {
            padding: 0.875rem 1.5rem; /* Smaller padding for mobile buttons */
            font-size: 0.9rem; /* Smaller font size for mobile buttons */
            margin-bottom: 0.75rem; /* Space between stacked buttons */
          }

          .body-text {
            font-size: 1rem; /* Smaller body text for mobile */
            line-height: 1.6; /* Adjusted line height */
          }

          .modal-content {
            padding: 1.5rem; /* Reduced modal padding */
            margin: 1rem; /* Added margin to prevent edge-to-edge on very small screens */
          }

          .modal-title {
            font-size: 1.5rem; /* Reduced modal title size */
          }

          /* New mobile-specific utility classes */
          .mobile-button-container {
            flex-direction: column; /* Stack buttons vertically */
            width: 100%; /* Take full width */
            max-width: 300px; /* Constrain stacked buttons width */
            margin: 0 auto; /* Center stacked buttons */
          }

          .mobile-button-container .btn-primary,
          .mobile-button-container .btn-outline {
            width: 100%; /* Ensure buttons take full width of container */
            margin-bottom: 1rem; /* Spacing between stacked buttons */
          }

          /* Grid Mobile Adjustments */
          /* mobile-grid-fix CSS is no longer relevant for Lead Sources section */
          .mobile-grid-fix {
            grid-template-columns: 1fr !important; /* Force single column on grids */
            gap: 2rem !important; /* Adjust gap for single column layout */
          }
        }

        /* Tablet Adjustments */
        @media (max-width: 1024px) and (min-width: 769px) {
          .container {
            padding: 0 1.5rem; /* Slightly smaller horizontal padding for tablets */
          }

          .mobile-grid-fix {
            grid-template-columns: repeat(2, 1fr) !important; /* Two columns for tablets */
          }
        }

        /* Small Mobile Devices */
        @media (max-width: 480px) {
          .section-title {
            font-size: 0.75rem; /* Smaller section title */
            letter-spacing: 2px;
          }

          .body-text {
            font-size: 0.95rem; /* Slightly smaller body text */
          }

          .btn-primary, .btn-outline {
            padding: 0.75rem 1.25rem; /* Even smaller buttons */
            font-size: 0.85rem;
          }

          .logo {
            font-size: 1.5rem; /* Smaller logo in header */
          }
        }

        /* Scroll Animations */
        @media (prefers-reduced-motion: no-preference) {
          .parallax-card {
            opacity: 0;
            transform: translateY(50px);
            animation: slideUp 0.8s ease forwards;
          }

          .parallax-card:nth-child(1) { animation-delay: 0.1s; }
          .parallax-card:nth-child(2) { animation-delay: 0.2s; }
          .parallax-card:nth-child(3) { animation-delay: 0.3s; }
          .parallax-card:nth-child(4) { animation-delay: 0.4s; }

          @keyframes slideUp {
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        }
      `}</style>

      {/* Floating Background Elements */}
      <FloatingElements />

      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link to="/" className="logo">
              MKTR.
            </Link>
            <HamburgerMenu isOpen={menuOpen} toggle={toggleMenu} />
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {menuOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-998"
          onClick={toggleMenu}
        />
      )}

      {/* Mobile Menu */}
      <nav className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
        <button 
          className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
          onClick={toggleMenu}
        >
          <X className="w-6 h-6 text-gray-600" />
        </button>
        
        <div className="flex flex-col items-center gap-6 flex-1 justify-center px-6">
          <a 
            href="#features" 
            className="mobile-menu-link" 
            onClick={(e) => {
              e.preventDefault();
              toggleMenu();
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Features
          </a>
          <Link to={createPageUrl("Contact")} className="mobile-menu-link" onClick={toggleMenu}>
            Contact
          </Link>
        </div>
        
        <div className="w-full px-6 pb-8 space-y-4">
          <Link to={createPageUrl("CustomerLogin")} onClick={toggleMenu} className="block">
            <button className="w-full bg-white text-black border-2 border-black py-3 px-4 font-mono text-sm uppercase tracking-wider 
                              hover:bg-gray-100 hover:shadow-lg hover:translate-y-[-2px] transition-all duration-200">
              Customer Login
            </button>
          </Link>
          
          <Link to={createPageUrl("AdminDashboard")} onClick={toggleMenu} className="block">
            <button className="w-full bg-black text-white border-2 border-black py-3 px-4 font-mono text-sm uppercase tracking-wider 
                              hover:bg-gray-900 hover:shadow-lg hover:translate-y-[-2px] transition-all duration-200">
              Admin Portal
            </button>
          </Link>
        </div>
      </nav>

      {/* Hero Section - Responsive Design */}
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
          to={createPageUrl("AdminDashboard")}
          className="btn-primary bg-white text-black hover:bg-gray-100 hover:text-black transition-all duration-300"
        >
          Get Started
          <ArrowRight className="w-4 h-4" />
        </Link>
        <Link
          to={createPageUrl("LeadCapture")}
          className="btn-primary bg-white text-black hover:bg-gray-100 hover:text-black transition-all duration-300"
        >
          Schedule DEMO
        </Link>
      </div>
    </div>
  </div>
</section>


  

      {/* Lead Sources Section - WHITE BACKGROUND */}
      <section className="section-spacing bg-white">
        <div className="container">
          <p className="section-title text-center text-black">Where Our Leads Come From</p>
          <h2 className="text-center mb-16 text-black" style={{ fontFamily: 'var(--heading-font)', fontSize: 'clamp(1.5rem, 4vw, 3rem)', lineHeight: '1.1' }}>
            Multi-Channel Lead<br />
            Generation Strategy
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black flex items-center justify-center bg-white hover:bg-black hover:text-white transition-all duration-300">
                <TrendingUp className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500">01</span>
                <h3 className="section-title mb-2 text-lg">Social Media Ads</h3>
              </div>
              <p className="body-text text-sm text-gray-600 leading-relaxed">
                Facebook, Instagram, and TikTok campaigns driving qualified prospects to your landing pages
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black flex items-center justify-center bg-white hover:bg-black hover:text-white transition-all duration-300">
                <QrCode className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500">02</span>
                <h3 className="section-title mb-2 text-lg">Physical Flyers</h3>
              </div>
              <p className="body-text text-sm text-gray-600 leading-relaxed">
                QR-enabled flyers distributed at MRTs, shopping centers, and high-traffic locations
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black flex items-center justify-center bg-white hover:bg-black hover:text-white transition-all duration-300">
                <Car className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500">03</span>
                <h3 className="section-title mb-2 text-lg">Private Transport</h3>
              </div>
              <p className="body-text text-sm text-gray-600 leading-relaxed">
                Vehicle-mounted QR codes on Grab cars, taxis, and private hire vehicles across Singapore
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black flex items-center justify-center bg-white hover:bg-black hover:text-white transition-all duration-300">
                <Users className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500">04</span>
                <h3 className="section-title mb-2 text-lg">Digital Campaigns</h3>
              </div>
              <p className="body-text text-sm text-gray-600 leading-relaxed">
                Targeted online advertising reaching prospects when they're actively searching
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section - BLACK BACKGROUND */}
      <section id="features" className="section-spacing bg-black text-white pb-12">
        <div className="container">
          <p className="section-title text-center !text-white">Core Features</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mt-12 mobile-grid-fix">
            <div className="text-center parallax-card">
              <div className="w-16 h-16 mx-auto mb-6 border-2 border-white flex items-center justify-center">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="section-title mb-4 text-white">Lead Capture</h3>
              <p className="body-text text-gray-300">
                Mobile-optimized forms with Singapore phone verification and postal code validation.
              </p>
            </div>

            <div className="text-center parallax-card">
              <div className="w-16 h-16 mx-auto mb-6 border-2 border-white flex items-center justify-center">
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
              <h3 className="section-title mb-4 text-white">Campaign Mgmt</h3>
              <p className="body-text text-gray-300">
                Create targeted campaigns with custom designs and real-time tracking.
              </p>
            </div>

            <div className="text-center parallax-card">
              <div className="w-16 h-16 mx-auto mb-6 border-2 border-white flex items-center justify-center">
                <QrCode className="w-8 h-8 text-white" />
              </div>
              <h3 className="section-title mb-4 text-white">QR Integration</h3>
              <p className="body-text text-gray-300">
                Generate QR codes for physical marketing with tracking and commission management.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section - WHITE BACKGROUND */}
      <section className="section-spacing bg-white">
        <div className="container text-center">
          <h2 className="!text-black mb-8 hero-title" style={{ fontSize: 'clamp(2rem, 6vw, 4rem)' }}>
            Ready to Transform<br />Your Marketing?
          </h2>
          <p className="mx-auto my-2 body-text max-w-2xl text-black" style={{ fontSize: '1.2rem' }}>
            Join hundreds of agents already using MKTR to capture and convert more leads.
          </p>
          <div className="mt-8">
            <Link to={createPageUrl("AdminDashboard")} className="btn-primary bg-black text-white hover:bg-gray-800 max-w-xs mx-auto">
              Get Started Now
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer - BLACK BACKGROUND */}
      <footer className="section-spacing border-t bg-black text-white">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8 mobile-grid-fix">
            <div>
              <h3 className="logo mb-4 !text-white">MKTR.</h3>
              <p className="body-text text-gray-300">
                Singapore's leading marketer platform for intelligent lead generation.
              </p>
            </div>
            <div>
              <h4 className="section-title mb-4 !text-white">Platform</h4>
              <ul className="space-y-2">
                <li><Link to={createPageUrl("LeadCapture")} className="body-text text-gray-300 hover:text-white">Lead Capture</Link></li>
                <li><Link to={createPageUrl("AdminDashboard")} className="body-text text-gray-300 hover:text-white">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="section-title mb-4 !text-white">Support</h4>
              <ul className="space-y-2">
                <li><a href="#" className="body-text text-gray-300 hover:text-white">Documentation</a></li>
                <li><a href="#" className="body-text text-gray-300 hover:text-white">Help Center</a></li>
              </ul>
            </div>
            <div>
              <h4 className="section-title mb-4 !text-white">Company</h4>
              <ul className="space-y-2">
                <li><a href="#" className="body-text text-gray-300 hover:text-white">About Us</a></li>
                <li><a href="#" className="body-text text-gray-300 hover:text-white">Privacy Policy</a></li>
                <li><Link to={createPageUrl("Contact")} className="body-text text-gray-300 hover:text-white">Contact</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-12 pt-8 text-center">
            <p className="body-text text-gray-400">&copy; 2025 MKTR. Singapore. All rights reserved.</p>
          </div>
        </div>
      </footer>

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
