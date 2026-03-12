import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Shield from 'lucide-react/icons/shield';
import CheckCircle from 'lucide-react/icons/check-circle';
import { auth } from '@/api/client';
import { useNavigate } from 'react-router-dom';
import { GOOGLE_CLIENT_ID } from '@/config/google';
import { getPostAuthRedirectPath } from '@/lib/utils';
import LoginTab from '@/components/auth/LoginTab';
import RegisterTab from '@/components/auth/RegisterTab';
import './LoginForm.css';

export default function LoginForm() {
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Login form state
  const [loginData, setLoginData] = useState({
    email: '',
    password: ''
  });

  // Registration form state
  const [registerData, setRegisterData] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    role: 'customer',
    company_name: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();



  // Google OAuth callback handler
  const handleGoogleCallback = async (response) => {
    if (!response.credential) {
      setError('Google authentication failed: No credential received');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Send credential to backend for verification
      const result = await auth.googleLogin(response.credential);

      if (result.success) {
        setSuccess('Google login successful! Redirecting...');
        const targetUrl = getPostAuthRedirectPath(result.data.user);
        navigate(targetUrl);
      } else {
        setError(result.message || 'Google login failed');
      }
    } catch (error) {
      setError('Google login failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await auth.login(loginData.email, loginData.password);

      if (result.success) {
        setSuccess('Login successful! Redirecting...');
        const targetUrl = getPostAuthRedirectPath(result.data.user);
        navigate(targetUrl);
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (error) {
      setError(error.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    // Validation
    if (registerData.password !== registerData.confirm_password) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (registerData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      setLoading(false);
      return;
    }

    try {
      const result = await auth.register(registerData);

      if (result.success) {
        setSuccess('Registration successful! Redirecting...');
        const targetUrl = '/PendingApproval';
        navigate(targetUrl);
      } else {
        setError(result.message || 'Registration failed');
      }
    } catch (error) {
      setError(error.message || 'An error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (form, field, value) => {
    if (form === 'login') {
      setLoginData(prev => ({ ...prev, [field]: value }));
    } else {
      setRegisterData(prev => ({ ...prev, [field]: value }));
    }
  };



  // Load Google OAuth script
  useEffect(() => {
    const loadGoogleScript = () => {
      if (!window.google) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          try {
            // Initialize Google Identity Services
            if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;

            window.google.accounts.id.initialize({
              client_id: GOOGLE_CLIENT_ID,
              callback: handleGoogleCallback,
              auto_select: false,
              cancel_on_tap_outside: true
            });

            // Render button immediately after initialization
            setTimeout(() => {
              const buttonElement = document.getElementById('google-signin-button');
              if (buttonElement) {
                window.google.accounts.id.renderButton(buttonElement, {
                  theme: 'outline',
                  size: 'large',
                  width: 400,
                  text: 'continue_with',
                  shape: 'rectangular'
                });
              }
            }, 100);
          } catch (error) {
            console.error('Google OAuth initialization failed:', error);
          }
        };

        script.onerror = (error) => {
          console.error('Failed to load Google OAuth script:', error);
        };

        document.head.appendChild(script);
      } else if (window.google && window.google.accounts) {
        // Google already loaded, just initialize
        if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;

        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCallback,
            auto_select: false,
            cancel_on_tap_outside: true
          });

          // Render button immediately after re-initialization
          setTimeout(() => {
            const buttonElement = document.getElementById('google-signin-button');
            if (buttonElement) {
              window.google.accounts.id.renderButton(buttonElement, {
                theme: 'outline',
                size: 'large',
                width: 400,
                text: 'continue_with',
                shape: 'rectangular'
              });
            }
          }, 100);
        } catch (error) {
          console.error('Google OAuth re-initialization failed:', error);
        }
      }
    };

    loadGoogleScript();
  }, []);



  return (
    <div className="auth-container">
      <Card className="auth-card">
        <CardHeader className="auth-header">
          <div className="auth-logo">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="auth-title">Welcome to MKTR</CardTitle>
          <p className="auth-subtitle">Sign in to your account or create a new one</p>
        </CardHeader>

        <CardContent className="auth-content">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="auth-tabs">
            <TabsList className="auth-tabs-list">
              <TabsTrigger value="login" className="auth-tab">Sign In</TabsTrigger>
              <TabsTrigger value="register" className="auth-tab">Sign Up</TabsTrigger>
            </TabsList>

            {/* Login Tab */}
            <LoginTab
              loginData={loginData}
              handleInputChange={handleInputChange}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              loading={loading}
              handleLogin={handleLogin}
            >
              <div id="google-signin-button" className="w-full mb-4"></div>
            </LoginTab>

            {/* Register Tab */}
            <RegisterTab
              registerData={registerData}
              handleInputChange={handleInputChange}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              showConfirmPassword={showConfirmPassword}
              setShowConfirmPassword={setShowConfirmPassword}
              loading={loading}
              handleRegister={handleRegister}
            />
          </Tabs>

          {/* Error/Success Messages */}
          {error && (
            <Alert className="auth-message error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="auth-message success">
              <CheckCircle className="w-4 h-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <div className="auth-footer">
            <button
              className="auth-footer-link"
              onClick={() => setActiveTab('forgot-password')}
            >
              Forgot your password?
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
