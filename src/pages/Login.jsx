import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { auth } from "@/api/client";
import { GOOGLE_CLIENT_ID } from "@/config/google";
import { getPostAuthRedirectPath } from "@/lib/utils";
import { LogIn, AlertCircle } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";

export default function CustomerLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // If we have a return URL in the state, save it to session storage
    // This ensures it persists if the user clicks "Continue with Google"
    if (location.state?.from) {
      console.log('Login: Saving return URL to session storage:', location.state.from);
      sessionStorage.setItem('mktr_auth_return_url', JSON.stringify(location.state.from));
    }
  }, [location]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!email || !password) {
        setError("Please enter both email and password");
        return;
      }

      const result = await auth.login(email, password);
      if (result.success) {
        const user = result.data.user;

        // Check for return URL in state (primary) or session storage (secondary)
        let targetUrl = getPostAuthRedirectPath(user);

        if (location.state?.from) {
          const { pathname, search } = location.state.from;
          targetUrl = `${pathname}${search}`;
          // Clear session storage just in case
          sessionStorage.removeItem('mktr_auth_return_url');
        } else {
          // Check session storage
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
        setError(result.message || "Login failed");
      }
    } catch (err) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setError("");
    try {
      if (!GOOGLE_CLIENT_ID) {
        setError("Google authentication not configured");
        return;
      }

      const clientId = GOOGLE_CLIENT_ID;
      const redirectUri = encodeURIComponent(window.location.origin + "/auth/google/callback");
      const scope = encodeURIComponent("openid email profile");
      const responseType = "code";
      const state = encodeURIComponent("customer_login_" + Date.now());

      const googleAuthUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}` +
        `&redirect_uri=${redirectUri}` +
        `&response_type=${responseType}` +
        `&scope=${scope}` +
        `&access_type=offline` +
        `&prompt=select_account` +
        `&include_granted_scopes=false` +
        `&state=${state}`;

      window.location.href = googleAuthUrl;
    } catch (err) {
      setError("Failed to start Google authentication");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <SiteHeader />
      <div className="h-20 md:h-24" />

      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)] py-12 px-4">
        <div className="w-full max-w-md">
          <Card className="bg-white border-zinc-200 text-black shadow-2xl">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold">Sign in to MKTR</CardTitle>
              <p className="text-sm text-zinc-600 mt-1">Use Google or your email and password</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              <Button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full bg-zinc-900 text-white hover:bg-black"
                size="lg"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-zinc-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-zinc-500">or</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-zinc-700">Email</label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="bg-white border-zinc-300 text-black placeholder:text-zinc-500"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium text-zinc-700">Password</label>
                    <Link to="/ForgotPassword" className="text-xs text-zinc-500 hover:text-black">Forgot password?</Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    required
                    className="bg-white border-zinc-300 text-black placeholder:text-zinc-500"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-black text-white hover:bg-zinc-800"
                  size="lg"
                >
                  {loading ? "Signing In..." : (
                    <>
                      <LogIn className="w-4 h-4 mr-2" />
                      Sign In
                    </>
                  )}
                </Button>
              </form>

              <div className="text-center pt-4 border-t border-zinc-200">
                <p className="text-sm text-zinc-600 mb-3">New to MKTR?</p>
                <Link to={createPageUrl("Contact")}>
                  <Button className="w-full bg-black text-white hover:bg-zinc-800">
                    Contact Us to Get Started
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


