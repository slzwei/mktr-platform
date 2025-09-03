import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { auth } from "@/api/client";
import { useNavigate } from "react-router-dom";
import { GOOGLE_CLIENT_ID } from "@/config/google";
import {
  ArrowLeft,
  Shield,
  LogIn,
  AlertCircle
} from "lucide-react";

export default function AdminLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });
  
  const navigate = useNavigate();

  // Google OAuth callback handler
  const handleGoogleCallback = async (credentialResponse) => {
    console.log('🔍 Admin Google OAuth callback triggered');
    
    if (!credentialResponse?.credential) {
      console.error('❌ No credential in Google response');
      setError('Google authentication failed: No credential received');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      console.log('🔍 Sending Google credential to backend...');
      
      // Call our backend API directly
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          credential: credentialResponse.credential 
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('🔍 Backend result:', result);
      
      if (result.success && result.data?.user) {
        const user = result.data.user;
        
        // Only allow admin users
        if (user.role === 'admin') {
          // Store the token
          if (result.data.token) {
            localStorage.setItem('mktr_auth_token', result.data.token);
            localStorage.setItem('mktr_user', JSON.stringify(user));
          }
          navigate('/AdminDashboard');
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
    setError("");
    
    try {
      // Validate form data
      if (!formData.email || !formData.password) {
        setError("Please enter both email and password");
        return;
      }

      // Call backend login API
      const result = await auth.login(formData.email, formData.password);
      
      if (result.success) {
        const user = result.data.user;
        
        // Only allow admin users
        if (user.role === 'admin') {
          navigate('/AdminDashboard');
        } else {
          setError('Access denied. Admin privileges required.');
        }
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (err) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    console.log('🔍 Admin Google login button clicked');
    
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
      
      console.log('🔍 Admin Google OAuth with direct URL redirect...');
      
      // Instead of using One Tap, redirect directly to Google OAuth
      const clientId = GOOGLE_CLIENT_ID;
      const redirectUri = encodeURIComponent(window.location.origin + '/auth/google/callback');
      const scope = encodeURIComponent('openid email profile');
      const responseType = 'code';
      const state = encodeURIComponent('admin_login_' + Date.now());
      
      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}&` +
        `redirect_uri=${redirectUri}&` +
        `response_type=${responseType}&` +
        `scope=${scope}&` +
        `access_type=offline&` +
        `state=${state}`;
      
      console.log('🔍 Admin redirecting to Google OAuth URL:', googleAuthUrl);
      
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
      [e.target.name]: e.target.value
    });
  };

  // Initialize Google OAuth
  useEffect(() => {
    let isInitialized = false;
    let scriptElement = null;
    
    const initializeGoogleOAuth = () => {
      if (isInitialized) return;
      
      console.log('🔍 Starting Admin Google OAuth initialization...');
      console.log('🔍 Client ID available:', !!GOOGLE_CLIENT_ID);
      console.log('🔍 Google script loaded:', !!window.google);
      
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
          use_fedcm_for_prompt: false
        });
        
        isInitialized = true;
        console.log('✅ Admin Google OAuth initialized successfully');
        
      } catch (error) {
        console.error('❌ Error initializing Admin Google OAuth:', error);
        setError('Failed to initialize Google authentication');
      }
    };

    // Load Google Identity Services script
    if (!window.google) {
      console.log('🔍 Loading Google Identity Services script for Admin...');
      scriptElement = document.createElement('script');
      scriptElement.src = 'https://accounts.google.com/gsi/client';
      scriptElement.async = true;
      scriptElement.defer = true;
      
      scriptElement.onload = () => {
        console.log('✅ Google script loaded successfully for Admin');
        setTimeout(initializeGoogleOAuth, 100);
      };
      
      scriptElement.onerror = (error) => {
        console.error('❌ Failed to load Google script for Admin:', error);
        setError('Failed to load Google authentication');
      };
      
      document.head.appendChild(scriptElement);
    } else {
      console.log('🔍 Google script already loaded for Admin');
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
    <>
      <style>{`
        /* Import Fonts */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=PT+Mono:wght@400&display=swap');

        /* Typography */
        :root {
          --heading-font: 'PT Mono', monospace;
          --body-font: 'Inter', sans-serif;
        }

        body {
          font-family: var(--body-font);
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
          position: relative;
          z-index: 2;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .container {
            padding: 0 1rem;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
        {/* Simple Header with Logo and Back Button */}
        <div className="absolute top-6 left-6 z-10">
          <Link to={createPageUrl("Homepage")}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>

        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-10">
          <h1 
            className="text-2xl font-bold text-black"
            style={{ fontFamily: 'var(--heading-font)' }}
          >
            MKTR.
          </h1>
        </div>

        {/* Login Section */}
        <div className="flex items-center justify-center min-h-screen py-12">
          <div className="w-full max-w-md mx-4">
            <Card className="shadow-xl">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <Shield className="w-8 h-8" />
                </div>
                <CardTitle className="text-2xl font-bold text-gray-900 mb-2">
                  Admin Portal
                </CardTitle>
                <p className="text-gray-600">
                  Administrative access to MKTR platform
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="admin-email" className="text-sm font-medium text-gray-700">
                      Email
                    </label>
                    <Input
                      id="admin-email"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="Enter your admin email"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label htmlFor="admin-password" className="text-sm font-medium text-gray-700">
                      Password
                    </label>
                    <Input
                      id="admin-password"
                      name="password"
                      type="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Enter your password"
                      required
                    />
                  </div>
                  
                  {error && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">{error}</span>
                    </div>
                  )}
                  
                  <Button 
                    type="submit"
                    disabled={loading}
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                    size="lg"
                  >
                    {loading ? (
                      "Signing In..."
                    ) : (
                      <>
                        <LogIn className="w-4 h-4 mr-2" />
                        Sign In as Admin
                      </>
                    )}
                  </Button>
                  
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white px-2 text-gray-500">Or continue with</span>
                    </div>
                  </div>
                  
                  <Button 
                    type="button"
                    onClick={handleGoogleLogin}
                    variant="outline"
                    className="w-full"
                    size="lg"
                  >
                    <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in with Google
                  </Button>
                </form>

                <div className="text-center pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-500 mb-3">
                    Need help accessing your account?
                  </p>
                  <Link 
                    to={createPageUrl("Contact")} 
                    className="text-sm text-red-600 hover:text-red-700 font-medium"
                  >
                    Contact Support
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
