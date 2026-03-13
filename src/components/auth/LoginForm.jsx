import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Shield from 'lucide-react/icons/shield';
import CheckCircle from 'lucide-react/icons/check-circle';
import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';
import { GOOGLE_CLIENT_ID } from '@/config/google';
import { getPostAuthRedirectPath } from '@/lib/utils';
import { loginSchema, registerSchema } from '@/schemas/auth';
import LoginTab from '@/components/auth/LoginTab';
import RegisterTab from '@/components/auth/RegisterTab';
import './LoginForm.css';

export default function LoginForm() {
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();
  const { login: storeLogin, googleLogin: storeGoogleLogin, register: storeRegister } = useAuthStore();

  const loginForm = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const registerForm = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      password: '',
      confirm_password: '',
      role: 'customer',
      company_name: '',
    },
  });

  // Google OAuth callback handler
  const handleGoogleCallback = async (response) => {
    if (!response.credential) {
      setError('Google authentication failed: No credential received');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await storeGoogleLogin(response.credential);

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

  const handleLogin = async (data) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await storeLogin(data.email, data.password);

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

  const handleRegister = async (data) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await storeRegister(data);

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
            if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;

            window.google.accounts.id.initialize({
              client_id: GOOGLE_CLIENT_ID,
              callback: handleGoogleCallback,
              auto_select: false,
              cancel_on_tap_outside: true
            });

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
        if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;

        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCallback,
            auto_select: false,
            cancel_on_tap_outside: true
          });

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
              form={loginForm}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              loading={loading}
              onSubmit={loginForm.handleSubmit(handleLogin)}
            >
              <div id="google-signin-button" className="w-full mb-4"></div>
            </LoginTab>

            {/* Register Tab */}
            <RegisterTab
              form={registerForm}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              showConfirmPassword={showConfirmPassword}
              setShowConfirmPassword={setShowConfirmPassword}
              loading={loading}
              onSubmit={registerForm.handleSubmit(handleRegister)}
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
