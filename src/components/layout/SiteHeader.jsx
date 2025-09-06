import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { createPageUrl } from "@/utils";
import { auth } from "@/api/client";
import { getDefaultRouteForRole } from "@/lib/utils";

const HamburgerMenu = ({ isOpen, toggle }) => (
  <button
    className={`hamburger hamburger--spring ${isOpen ? 'is-active' : ''}`}
    type="button"
    onClick={toggle}
    aria-label="Menu"
  >
    <span className="hamburger-box">
      <span className="hamburger-inner"></span>
    </span>
  </button>
);

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [dashboardPath, setDashboardPath] = useState('/AdminDashboard');
  const navigate = useNavigate();

  const toggleMenu = () => setMenuOpen((v) => !v);

  useEffect(() => {
    try {
      const token = localStorage.getItem('mktr_auth_token');
      const storedUser = localStorage.getItem('mktr_user');
      if (token && storedUser) {
        setIsAuthed(true);
        const user = JSON.parse(storedUser);
        setDashboardPath(getDefaultRouteForRole(user?.role));
      } else {
        setIsAuthed(false);
      }
    } catch (_) {
      setIsAuthed(false);
    }
  }, [menuOpen]);

  return (
    <>
      <style>{`
        :root {
          --heading-font: 'Mindset', 'Inter', sans-serif;
          --black: #000000;
          --white: #ffffff;
          --grey: #909090;
        }

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

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
          position: relative;
          z-index: 2;
        }

        .logo {
          font-family: var(--heading-font);
          font-size: 2rem;
          font-weight: 700;
          color: var(--black);
          text-decoration: none;
          transition: transform 0.3s ease;
        }

        .logo:hover { transform: scale(1.05); }

        .hamburger { padding: 15px 15px; display: inline-block; cursor: pointer; transition: opacity 0.15s linear; background: transparent; border: 0; position: relative; z-index: 1000; }
        .hamburger:hover { opacity: 0.7; }
        .hamburger-box { width: 40px; height: 24px; display: inline-block; position: relative; }
        .hamburger-inner { display: block; top: 50%; margin-top: -2px; }
        .hamburger-inner, .hamburger-inner::before, .hamburger-inner::after { width: 40px; height: 4px; background-color: var(--black); border-radius: 4px; position: absolute; transition: transform 0.15s ease; }
        .hamburger-inner::before, .hamburger-inner::after { content: ""; display: block; }
        .hamburger-inner::before { top: -10px; }
        .hamburger-inner::after { bottom: -10px; }
        .hamburger--spring .hamburger-inner { top: 2px; transition: background-color 0s 0.13s linear; }
        .hamburger--spring .hamburger-inner::before { top: 10px; transition: top 0.1s 0.2s, transform 0.13s; }
        .hamburger--spring .hamburger-inner::after { top: 20px; transition: top 0.2s 0.2s, transform 0.13s; }
        .hamburger--spring.is-active .hamburger-inner { transition-delay: 0.22s; background-color: transparent !important; }
        .hamburger--spring.is-active .hamburger-inner::before { top: 0; transform: translate3d(0, 10px, 0) rotate(45deg); }
        .hamburger--spring.is-active .hamburger-inner::after { top: 0; transform: translate3d(0, 10px, 0) rotate(-45deg); }

        .fixed.inset-0.bg-black.bg-opacity-50.z-998 { z-index: 998; }
        .mobile-menu { position: fixed; top: 0; right: 0; width: 100%; max-width: 320px; height: 100vh; height: 100dvh; background: var(--white); z-index: 999; transform: translateX(100%); transition: transform 0.3s ease; display: flex; flex-direction: column; justify-content: flex-start; align-items: center; box-shadow: -4px 0 20px rgba(0,0,0,0.15); padding-bottom: env(safe-area-inset-bottom); padding-bottom: constant(safe-area-inset-bottom); overflow-y: auto; }
        .mobile-menu.open { transform: translateX(0); }
        .mobile-menu-link { font-family: 'PT Mono', 'Courier New', monospace; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 2px; color: var(--black); text-decoration: none; transition: opacity 0.2s ease; padding: 0.75rem 0; }
        .mobile-menu-link:hover { opacity: 0.7; }

        /* Ensure footer actions clear iOS Safari bottom bar */
        .mobile-menu-footer { padding-bottom: calc(2rem + env(safe-area-inset-bottom)); padding-bottom: calc(2rem + constant(safe-area-inset-bottom)); }
      `}</style>

      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link to="/" className="logo">MKTR.</Link>
            <HamburgerMenu isOpen={menuOpen} toggle={toggleMenu} />
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-998" onClick={toggleMenu} />
      )}

      <nav className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
        <button className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-lg transition-colors" onClick={toggleMenu}>
          <X className="w-6 h-6 text-gray-600" />
        </button>

        <div className="w-full px-6 pt-8 flex justify-start">
          <Link to="/" className="logo" onClick={toggleMenu}>MKTR.</Link>
        </div>

        <div className="flex flex-col items-center gap-6 flex-1 justify-center px-6">
          <Link to={createPageUrl("Homepage")} className="mobile-menu-link" onClick={toggleMenu}>
            Home
          </Link>
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

        <div className="mobile-menu-footer w-full px-6 pb-8 space-y-4">
          {isAuthed ? (
            <>
              <Link to={dashboardPath} onClick={toggleMenu} className="block">
                <button className="w-full bg-black text-white border-2 border-black py-3 px-4 font-mono text-sm uppercase tracking-wider hover:bg-gray-900 hover:shadow-lg hover:translate-y-[-2px] transition-all duration-200">
                  Go to Dashboard
                </button>
              </Link>
              <button
                onClick={() => {
                  auth.logout();
                  setIsAuthed(false);
                  toggleMenu();
                  navigate('/');
                }}
                className="w-full bg-white text-black border-2 border-black py-3 px-4 font-mono text-sm uppercase tracking-wider hover:bg-gray-100 hover:shadow-lg hover:translate-y-[-2px] transition-all duration-200"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to={createPageUrl("CustomerLogin")} onClick={toggleMenu} className="block">
                <button className="w-full bg-white text-black border-2 border-black py-3 px-4 font-mono text-sm uppercase tracking-wider hover:bg-gray-100 hover:shadow-lg hover:translate-y-[-2px] transition-all duration-200">
                  Login
                </button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </>
  );
}


