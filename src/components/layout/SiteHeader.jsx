import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { X, Menu } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { getDefaultRouteForRole } from "@/lib/utils";

const navLinks = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/Contact" },
];

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, token, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const toggleMenu = () => setMenuOpen((v) => !v);

  const isAuthed = !!token && !!user;
  const dashboardPath = user ? getDefaultRouteForRole(user.role) : "/AdminDashboard";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isActive = (href) => location.pathname === href;

  return (
    <>
      <header
        className="fixed top-0 w-full z-[100] transition-all duration-300"
        style={{
          background: scrolled
            ? "rgba(6, 9, 24, 0.92)"
            : "rgba(6, 9, 24, 0.4)",
          backdropFilter: "blur(20px)",
          borderBottom: scrolled
            ? "1px solid rgba(255,255,255,0.06)"
            : "1px solid transparent",
        }}
      >
        <div className="max-w-[1200px] mx-auto px-6 flex items-center justify-between h-[72px]">
          {/* Logo */}
          <Link
            to="/"
            className="text-white text-xl font-extrabold tracking-tight hover:opacity-80 transition-opacity"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            MKTR.
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className="px-4 py-2 text-sm font-medium transition-colors rounded-lg"
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  color: isActive(link.href)
                    ? "#00c2ff"
                    : "rgba(255,255,255,0.6)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive(link.href))
                    e.target.style.color = "rgba(255,255,255,0.9)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive(link.href))
                    e.target.style.color = "rgba(255,255,255,0.6)";
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            {isAuthed ? (
              <Link
                to={dashboardPath}
                className="px-5 py-2 text-sm font-semibold text-white rounded-full transition-all"
                style={{
                  background: "linear-gradient(135deg, #00c2ff 0%, #0066ff 100%)",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/CustomerLogin"
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontFamily: "'Outfit', sans-serif",
                  }}
                  onMouseEnter={(e) =>
                    (e.target.style.color = "rgba(255,255,255,0.9)")
                  }
                  onMouseLeave={(e) =>
                    (e.target.style.color = "rgba(255,255,255,0.6)")
                  }
                >
                  Log In
                </Link>
                <Link
                  to="/AdminDashboard"
                  className="px-5 py-2 text-sm font-semibold text-white rounded-full transition-all hover:shadow-lg hover:-translate-y-0.5"
                  style={{
                    background: "linear-gradient(135deg, #00c2ff 0%, #0066ff 100%)",
                    fontFamily: "'Outfit', sans-serif",
                  }}
                >
                  Get Started
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-white hover:opacity-70 transition-opacity"
            onClick={toggleMenu}
            aria-label="Menu"
          >
            {menuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[998] md:hidden"
          onClick={toggleMenu}
        />
      )}

      {/* Mobile Menu */}
      <nav
        className="fixed top-0 right-0 h-full z-[999] md:hidden transition-transform duration-300 flex flex-col"
        style={{
          width: "min(85vw, 320px)",
          background: "#060918",
          transform: menuOpen ? "translateX(0)" : "translateX(100%)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex items-center justify-between px-6 h-[72px] border-b border-white/5">
          <Link
            to="/"
            className="text-white text-xl font-extrabold"
            style={{ fontFamily: "'Outfit', sans-serif" }}
            onClick={toggleMenu}
          >
            MKTR.
          </Link>
          <button
            className="p-2 text-white/60 hover:text-white"
            onClick={toggleMenu}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-1 px-4 pt-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              onClick={toggleMenu}
              className="px-4 py-3 rounded-lg text-base font-medium transition-colors"
              style={{
                fontFamily: "'Outfit', sans-serif",
                color: isActive(link.href)
                  ? "#00c2ff"
                  : "rgba(255,255,255,0.6)",
                background: isActive(link.href)
                  ? "rgba(0, 194, 255, 0.08)"
                  : "transparent",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="px-4 pb-8 space-y-3">
          {isAuthed ? (
            <>
              <Link
                to={dashboardPath}
                onClick={toggleMenu}
                className="block w-full text-center py-3 px-4 rounded-xl text-white text-sm font-semibold"
                style={{
                  background: "linear-gradient(135deg, #00c2ff 0%, #0066ff 100%)",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                Go to Dashboard
              </Link>
              <button
                onClick={() => {
                  logout();
                  toggleMenu();
                  navigate("/");
                }}
                className="w-full py-3 px-4 rounded-xl text-sm font-medium border transition-colors"
                style={{
                  color: "rgba(255,255,255,0.6)",
                  borderColor: "rgba(255,255,255,0.1)",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                Log Out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/CustomerLogin"
                onClick={toggleMenu}
                className="block w-full text-center py-3 px-4 rounded-xl text-sm font-medium border transition-colors"
                style={{
                  color: "rgba(255,255,255,0.6)",
                  borderColor: "rgba(255,255,255,0.1)",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                Log In
              </Link>
              <Link
                to="/AdminDashboard"
                onClick={toggleMenu}
                className="block w-full text-center py-3 px-4 rounded-xl text-white text-sm font-semibold"
                style={{
                  background: "linear-gradient(135deg, #00c2ff 0%, #0066ff 100%)",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                Get Started Free
              </Link>
            </>
          )}
        </div>
      </nav>
    </>
  );
}
