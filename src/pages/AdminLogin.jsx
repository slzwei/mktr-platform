import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { GOOGLE_CLIENT_ID } from '@/config/google';
import { ArrowLeft, Shield, LogIn, AlertCircle } from 'lucide-react';

export default function AdminLogin() {
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState('');
 const [formData, setFormData] = useState({
 email: '',
 password: '',
 });

 const navigate = useNavigate();
 const location = useLocation();
 const { login: storeLogin, setUser: storeSetUser } = useAuthStore();

 useEffect(() => {
 // If we have a return URL in the state, save it to session storage
 if (location.state?.from) {
 sessionStorage.setItem('mktr_auth_return_url', JSON.stringify(location.state.from));
 }
 }, [location]);

 // Google OAuth callback handler
 const handleGoogleCallback = async (credentialResponse) => {
 if (!credentialResponse?.credential) {
 console.error('❌ No credential in Google response');
 setError('Google authentication failed: No credential received');
 return;
 }

 setLoading(true);
 setError('');

 try {
 // Call our backend API directly
 const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/google`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 },
 body: JSON.stringify({
 credential: credentialResponse.credential,
 }),
 });

 if (!response.ok) {
 throw new Error(`HTTP error! status: ${response.status}`);
 }

 const result = await response.json();

 if (result.success && result.data?.user) {
 const user = result.data.user;

 // Only allow admin users
 if (user.role === 'admin') {
 // Sync store state. Auth lives in the httpOnly cookie set by the
 // server; we don't gate on a body token any more (audit 2.9).
 storeSetUser(user);
 // Redirect logic
 let targetUrl = '/AdminDashboard';

 if (location.state?.from) {
 const { pathname, search } = location.state.from;
 targetUrl = `${pathname}${search}`;
 sessionStorage.removeItem('mktr_auth_return_url');
 } else {
 const storedReturnUrl = sessionStorage.getItem('mktr_auth_return_url');
 if (storedReturnUrl) {
 try {
 const { pathname, search } = JSON.parse(storedReturnUrl);
 targetUrl = `${pathname}${search}`;
 sessionStorage.removeItem('mktr_auth_return_url');
 } catch (e) {
 console.error('Error parsing stored return URL:', e);
 }
 }
 }
 navigate(targetUrl);
 } else {
 setError('Access denied. Admin privileges required.');
 }
 } else {
 setError(result.message || 'Authentication failed');
 }
 } catch (error) {
 console.error('❌ Admin Google OAuth error:', error);
 setError(`Authentication failed: ${error.message}`);
 } finally {
 setLoading(false);
 }
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 setLoading(true);
 setError('');

 try {
 // Validate form data
 if (!formData.email || !formData.password) {
 setError('Please enter both email and password');
 setLoading(false);
 return;
 }

 // Call backend login API
 const result = await storeLogin(formData.email, formData.password);

 if (result.success) {
 const user = result.data.user;

 // Only allow admin users
 if (user.role === 'admin') {
 let targetUrl = '/AdminDashboard';

 if (location.state?.from) {
 const { pathname, search } = location.state.from;
 targetUrl = `${pathname}${search}`;
 sessionStorage.removeItem('mktr_auth_return_url');
 } else {
 const storedReturnUrl = sessionStorage.getItem('mktr_auth_return_url');
 if (storedReturnUrl) {
 try {
 const { pathname, search } = JSON.parse(storedReturnUrl);
 targetUrl = `${pathname}${search}`;
 sessionStorage.removeItem('mktr_auth_return_url');
 } catch (e) {
 console.error('Error parsing stored return URL:', e);
 }
 }
 }
 navigate(targetUrl);
 } else {
 setError('Access denied. Admin privileges required.');
 }
 } else {
 setError(result.message || 'Login failed');
 }
 } catch (err) {
 setError('Login failed. Please try again.');
 } finally {
 setLoading(false);
 }
 };

 const handleGoogleLogin = async () => {
 try {
 if (!GOOGLE_CLIENT_ID) {
 console.error('❌ No Google Client ID configured');
 setError('Google authentication not configured');
 return;
 }

 if (!window.google?.accounts?.id) {
 console.error('❌ Google Identity Services not available');
 setError('Google authentication service not loaded');
 return;
 }

 // Instead of using One Tap, redirect directly to Google OAuth
 const clientId = GOOGLE_CLIENT_ID;
 const redirectUri = encodeURIComponent(window.location.origin + '/auth/google/callback');
 const scope = encodeURIComponent('openid email profile');
 const responseType = 'code';

 // Backend-issued state (also sets the httpOnly oauth_state cookie used to verify the callback)
 const stateRes = await fetch(
 `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/google/state`,
 { credentials: 'include' }
 );
 if (!stateRes.ok) {
 throw new Error(`Failed to initialize Google sign-in (${stateRes.status})`);
 }
 const stateJson = await stateRes.json();
 const state = stateJson?.data?.state;
 if (!state) {
 throw new Error('Failed to initialize Google sign-in');
 }
 sessionStorage.setItem('mktr_oauth_state', state);

 const googleAuthUrl =
 `https://accounts.google.com/o/oauth2/v2/auth?` +
 `client_id=${clientId}&` +
 `redirect_uri=${redirectUri}&` +
 `response_type=${responseType}&` +
 `scope=${scope}&` +
 `access_type=offline&` +
 `state=${encodeURIComponent(state)}`;

 // Redirect to Google OAuth
 window.location.href = googleAuthUrl;
 } catch (error) {
 console.error('❌ Error triggering Google login:', error);
 setError('Failed to start Google authentication');
 }
 };

 const handleChange = (e) => {
 setFormData({
 ...formData,
 [e.target.name]: e.target.value,
 });
 };

 // Initialize Google OAuth
 useEffect(() => {
 let isInitialized = false;
 let scriptElement = null;

 const initializeGoogleOAuth = () => {
 if (isInitialized) return;

 if (!GOOGLE_CLIENT_ID) {
 console.error('❌ GOOGLE_CLIENT_ID not found');
 setError('Google OAuth not configured');
 return;
 }

 if (!window.google?.accounts?.id) {
 console.error('❌ Google Identity Services not loaded');
 return;
 }

 try {
 window.google.accounts.id.initialize({
 client_id: GOOGLE_CLIENT_ID,
 callback: handleGoogleCallback,
 auto_select: false,
 cancel_on_tap_outside: true,
 use_fedcm_for_prompt: false,
 });

 isInitialized = true;
 } catch (error) {
 console.error('❌ Error initializing Admin Google OAuth:', error);
 setError('Failed to initialize Google authentication');
 }
 };

 // Load Google Identity Services script
 if (!window.google) {
 scriptElement = document.createElement('script');
 scriptElement.src = 'https://accounts.google.com/gsi/client';
 scriptElement.async = true;
 scriptElement.defer = true;

 scriptElement.onload = () => {
 setTimeout(initializeGoogleOAuth, 100);
 };

 scriptElement.onerror = (error) => {
 console.error('❌ Failed to load Google script for Admin:', error);
 setError('Failed to load Google authentication');
 };

 document.head.appendChild(scriptElement);
 } else {
 initializeGoogleOAuth();
 }

 // Cleanup function
 return () => {
 isInitialized = false;
 if (scriptElement && document.head.contains(scriptElement)) {
 document.head.removeChild(scriptElement);
 }
 };
 }, []);

 return (
 <div className="min-h-screen flex bg-background">
 {/* Left Panel — Brand (always warm-dark / Tropic ink) */}
 <div className=" hidden lg:flex lg:w-[46%] bg-ink relative overflow-hidden">
 {/* Decorative glows — retinted to Tropic warm palette */}
 <div
 className="pointer-events-none absolute -top-32 -left-32 w-[500px] h-[500px] bg-terracotta/10 rounded-full blur-3xl" aria-hidden="true" />
 <div
 className="pointer-events-none absolute bottom-0 right-0 w-[400px] h-[400px] bg-butter/10 rounded-full blur-3xl" aria-hidden="true" />
 <div
 className="pointer-events-none absolute top-1/2 left-1/4 w-72 h-72 bg-plum/10 rounded-full blur-3xl" aria-hidden="true" />

 {/* Dot grid */}
 <div
 className="pointer-events-none absolute inset-0 opacity-[0.05]" aria-hidden="true" style={{
 backgroundImage: 'radial-gradient(circle, rgba(245,240,230,0.85) 1px, transparent 1px)',
 backgroundSize: '28px 28px',
 }}
 />

 <div className="relative z-10 flex flex-col justify-between p-10 xl:p-14 w-full">
 {/* Logo — Fraunces editorial wordmark on warm-dark */}
 <h1 className="text-3xl font-semibold text-background tracking-tight font-serif">MKTR.</h1>

 {/* Hero text */}
 <div className="my-auto py-12">
 <h2 className="text-4xl xl:text-[2.75rem] font-semibold text-background leading-[1.15] mb-5 tracking-tight font-serif">
 Command your
 <br />
 marketing empire.
 </h2>
 <p className="text-base text-background/60 leading-relaxed max-w-sm">
 Unified platform for campaigns, fleet management, and real-time performance analytics.
 </p>

 <div className="mt-12 space-y-5">
 {[
 { label: 'Real-time Analytics', desc: 'Track every impression and conversion' },
 { label: 'Fleet Management', desc: 'Monitor vehicles and ad campaigns' },
 { label: 'Lead Pipeline', desc: 'From prospect to close, automated' },
 ].map((f, i) => (
 <div key={i} className="flex items-center gap-4 group">
 <div className="w-9 h-9 rounded-lg bg-background/[0.04] border border-background/[0.08] flex items-center justify-center shrink-0 group-hover:bg-background/[0.08] transition-colors">
 <div className="w-1.5 h-1.5 rounded-full bg-terracotta" aria-hidden="true"/>
 </div>
 <div>
 <p className="text-sm font-medium text-background">{f.label}</p>
 <p className="text-xs text-background/50">{f.desc}</p>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Footer */}
 <p className="text-xs text-background/40">
 &copy; {new Date().getFullYear()} MKTR Platform &middot; Singapore
 </p>
 </div>
 </div>

 {/* Right Panel — Form */}
 <div className="flex-1 flex items-center justify-center px-6 py-12 sm:px-12">
 <div className="w-full max-w-[400px]">
 {/* Back link */}
 <Link
 to="/Homepage" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-10" >
 <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true"/>
 Back to Home
 </Link>

 {/* Header */}
 <div className="mb-8">
 <div
 className="w-11 h-11 bg-foreground rounded-xl flex items-center justify-center mb-5" aria-hidden="true" >
 <Shield className="w-5 h-5 text-background"/>
 </div>
 <h1 className="text-[1.65rem] font-semibold text-foreground tracking-tight mb-1.5 font-serif">
 Welcome back
 </h1>
 <p className="text-sm text-muted-foreground">Sign in to your admin account</p>
 </div>

 {/* Form */}
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-1.5">
 <label htmlFor="admin-email" className="text-sm font-medium text-foreground">
 Email
 </label>
 <Input
 id="admin-email" name="email" type="email" value={formData.email}
 onChange={handleChange}
 placeholder="you@company.com" required
 className="h-11 bg-background border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" />
 </div>

 <div className="space-y-1.5">
 <label htmlFor="admin-password" className="text-sm font-medium text-foreground">
 Password
 </label>
 <Input
 id="admin-password" name="password" type="password" value={formData.password}
 onChange={handleChange}
 placeholder="Enter your password" required
 className="h-11 bg-background border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0" />
 </div>

 {error && (
 <div
 role="alert" className="flex items-center gap-2.5 p-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20" >
 <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true"/>
 <span className="text-sm">{error}</span>
 </div>
 )}

 <Button
 type="submit" disabled={loading}
 className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors" size="lg" >
 {loading ? (
 <div className="flex items-center gap-2">
 <div
 className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" aria-hidden="true" />
 Signing in…
 </div>
 ) : (
 <>
 <LogIn className="w-4 h-4 mr-2" aria-hidden="true"/>
 Sign In
 </>
 )}
 </Button>

 {/* Divider */}
 <div className="relative my-2">
 <div className="absolute inset-0 flex items-center" aria-hidden="true">
 <div className="w-full border-t border-border"/>
 </div>
 <div className="relative flex justify-center">
 <span className="bg-background px-3 text-xs text-muted-foreground uppercase tracking-wider">
 or
 </span>
 </div>
 </div>

 <Button
 type="button" onClick={handleGoogleLogin}
 variant="outline" className="w-full h-11 border-border hover:bg-accent font-medium transition-colors" size="lg" >
 <svg className="w-4 h-4 mr-2.5" viewBox="0 0 24 24" aria-hidden="true">
 <path
 fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
 <path
 fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
 <path
 fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
 <path
 fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
 </svg>
 Continue with Google
 </Button>
 </form>

 {/* Footer */}
 <div className="text-center mt-8 pt-6 border-t border-border">
 <p className="text-sm text-muted-foreground">
 Need help?{' '}
 <Link
 to="/Contact" className="text-foreground hover:text-primary font-medium transition-colors" >
 Contact Support
 </Link>
 </p>
 </div>

 {/* Mobile branding */}
 <p className="lg:hidden text-center text-xs text-muted-foreground mt-8">
 &copy; {new Date().getFullYear()} MKTR Platform
 </p>
 </div>
 </div>
 </div>
 );
}
