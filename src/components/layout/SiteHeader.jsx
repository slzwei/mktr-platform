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

 useEffect(() => {
 setMenuOpen(false);
 }, [location.pathname]);

 const isActive = (href) => location.pathname === href;

 const linkColorClass = (href) =>
 isActive(href)
 ? "text-terracotta"
 : "text-background/60 hover:text-background/90";

 return (
 <>
 <header
 className={`fixed top-0 w-full z-[100] transition-colors duration-300 border-b ${
 scrolled ? "bg-ink border-background/10" : "bg-ink/80 border-transparent"
 }`}
 >
 <div className="max-w-[1200px] mx-auto px-6 flex items-center justify-between h-[72px]">
 {/* Logo */}
 <Link
 to="/"
 className="font-serif text-background text-xl font-semibold tracking-tight hover:opacity-80 transition-opacity"
 >
 MKTR.
 </Link>

 {/* Desktop Nav */}
 <nav className=" hidden md:flex items-center gap-1">
 {navLinks.map((link) => (
 <Link
 key={link.href}
 to={link.href}
 aria-current={isActive(link.href) ? "page" : undefined}
 className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta ${linkColorClass(link.href)}`}
 >
 {link.label}
 </Link>
 ))}
 </nav>

 {/* Desktop CTA */}
 <div className=" hidden md:flex items-center gap-3">
 {isAuthed ? (
 <Link
 to={dashboardPath}
 className="px-5 py-2 text-sm font-semibold text-background rounded-full transition-colors bg-terracotta hover:bg-terracotta-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
 >
 Dashboard
 </Link>
 ) : (
 <>
 <Link
 to="/CustomerLogin"
 className="px-4 py-2 text-sm font-medium text-background/60 hover:text-background/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta rounded-lg"
 >
 Log In
 </Link>
 <Link
 to="/AdminDashboard"
 className="px-5 py-2 text-sm font-semibold text-background rounded-full bg-terracotta hover:bg-terracotta-dark transition-colors hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
 >
 Get Started
 </Link>
 </>
 )}
 </div>

 {/* Mobile Menu Button */}
 <button
 className="md:hidden p-2 text-background hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta rounded-lg"
 onClick={toggleMenu}
 aria-label="Menu"
 aria-expanded={menuOpen}
 >
 {menuOpen ? <X className="w-6 h-6" aria-hidden="true" /> : <Menu className="w-6 h-6" aria-hidden="true" />}
 </button>
 </div>
 </header>

 {/* Mobile Menu Overlay */}
 {menuOpen && (
 <button
 type="button"
 aria-label="Close menu"
 className="fixed inset-0 bg-foreground/50 z-[998] md:hidden cursor-default"
 onClick={toggleMenu}
 />
 )}

 {/* Mobile Menu */}
 <nav
 className={`fixed top-0 right-0 h-full z-[999] md:hidden transition-transform duration-300 flex flex-col bg-ink border-l border-background/10 ${
 menuOpen ? "translate-x-0" : "translate-x-full"
 }`}
 style={{
 width: "min(85vw, 320px)",
 paddingBottom: "env(safe-area-inset-bottom)",
 }}
 aria-label="Mobile navigation"
 >
 <div className="flex items-center justify-between px-6 h-[72px] border-b border-background/10">
 <Link to="/" className="font-serif text-background text-xl font-semibold" onClick={toggleMenu}>
 MKTR.
 </Link>
 <button
 className="p-2 text-background/60 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta rounded-lg"
 onClick={toggleMenu}
 aria-label="Close menu"
 >
 <X className="w-5 h-5" aria-hidden="true" />
 </button>
 </div>

 <div className="flex-1 flex flex-col gap-1 px-4 pt-6">
 {navLinks.map((link) => (
 <Link
 key={link.href}
 to={link.href}
 onClick={toggleMenu}
 aria-current={isActive(link.href) ? "page" : undefined}
 className={`px-4 py-3 rounded-lg text-base font-medium transition-colors ${
 isActive(link.href) ? "text-terracotta bg-terracotta/10" : "text-background/60 hover:text-background/90"
 }`}
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
 className="block w-full text-center py-3 px-4 rounded-xl text-background text-sm font-semibold bg-terracotta hover:bg-terracotta-dark transition-colors"
 >
 Go to Dashboard
 </Link>
 <button
 onClick={() => {
 logout();
 toggleMenu();
 navigate("/");
 }}
 className="w-full py-3 px-4 rounded-xl text-sm font-medium border border-background/10 text-background/60 hover:text-background/90 hover:border-background/20 transition-colors"
 >
 Log Out
 </button>
 </>
 ) : (
 <>
 <Link
 to="/CustomerLogin"
 onClick={toggleMenu}
 className="block w-full text-center py-3 px-4 rounded-xl text-sm font-medium border border-background/10 text-background/60 hover:text-background/90 hover:border-background/20 transition-colors"
 >
 Log In
 </Link>
 <Link
 to="/AdminDashboard"
 onClick={toggleMenu}
 className="block w-full text-center py-3 px-4 rounded-xl text-background text-sm font-semibold bg-terracotta hover:bg-terracotta-dark transition-colors"
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
