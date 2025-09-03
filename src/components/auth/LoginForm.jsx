import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Mail from 'lucide-react/icons/mail';
import Lock from 'lucide-react/icons/lock';
import User from 'lucide-react/icons/user';
import Phone from 'lucide-react/icons/phone';
import Building from 'lucide-react/icons/building';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Loader2 from 'lucide-react/icons/loader-2';
import CheckCircle from 'lucide-react/icons/check-circle';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Shield from 'lucide-react/icons/shield';
import { auth } from '@/api/client';
import { useNavigate } from 'react-router-dom';
import { GOOGLE_CLIENT_ID } from '@/config/google';
import { getPostAuthRedirectPath } from '@/lib/utils';

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
        setSuccess('Registration successful! You can now login.');
        setActiveTab('login');
        setLoginData({ email: registerData.email, password: '' });
        setRegisterData({
          full_name: '',
          email: '',
          phone: '',
          password: '',
          confirm_password: '',
          role: 'customer',
          company_name: ''
        });
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
    <>
      <style>{`
        /* CSS Custom Properties - Matching Homepage */
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

        .auth-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          position: relative;
          overflow: hidden;
        }

        .auth-container::before {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: url("https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExYTFzZnpzZGwzbjJ2MzZ0ejQ2bDdnYmlqbWhsdnlkcnFwazlsNnpwZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/CKlafeh1NAxz35KTq4/giphy.gif") center/cover;
          opacity: 0.1;
          mix-blend-mode: screen;
          pointer-events: none;
        }

        .auth-card {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.2);
          width: 100%;
          max-width: 480px;
          position: relative;
          z-index: 10;
        }

        .auth-header {
          text-align: center;
          padding: 2rem 2rem 1rem;
          border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }

        .auth-logo {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 16px;
          margin: 0 auto 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }

        .auth-title {
          font-family: var(--heading-font);
          font-size: 2rem;
          font-weight: 700;
          color: var(--black);
          margin-bottom: 0.5rem;
        }

        .auth-subtitle {
          font-family: var(--body-font);
          color: var(--grey);
          font-size: 0.95rem;
        }

        .auth-content {
          padding: 2rem;
        }

        .auth-tabs {
          margin-bottom: 2rem;
        }

        .auth-tabs-list {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          background: rgba(0, 0, 0, 0.05);
          padding: 0.25rem;
          border-radius: 12px;
        }

        .auth-tab {
          padding: 0.75rem 1rem;
          border-radius: 8px;
          font-family: var(--mono-font);
          font-size: 0.875rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 500;
          transition: all 0.3s ease;
          cursor: pointer;
          border: none;
          background: transparent;
          color: var(--grey);
        }

        .auth-tab[data-state="active"] {
          background: var(--black);
          color: var(--white);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-label {
          font-family: var(--mono-font);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--black);
          font-weight: 600;
        }

        .form-input {
          position: relative;
        }

        .form-input input {
          width: 100%;
          padding: 0.875rem 1rem 0.875rem 3rem;
          border: 2px solid rgba(0, 0, 0, 0.1);
          border-radius: 12px;
          font-family: var(--body-font);
          font-size: 1rem;
          transition: all 0.3s ease;
          background: rgba(255, 255, 255, 0.8);
        }

        .form-input input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          background: white;
        }

        .form-input-icon {
          position: absolute;
          left: 1rem;
          top: 1/2;
          transform: translateY(-50%);
          color: var(--grey);
          width: 1.25rem;
          height: 1.25rem;
        }

        .form-input-toggle {
          position: absolute;
          right: 1rem;
          top: 1/2;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--grey);
          cursor: pointer;
          padding: 0.25rem;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .form-input-toggle:hover {
          color: var(--black);
          background: rgba(0, 0, 0, 0.05);
        }

        .form-select {
          width: 100%;
          padding: 0.875rem 1rem;
          border: 2px solid rgba(0, 0, 0, 0.1);
          border-radius: 12px;
          font-family: var(--body-font);
          font-size: 1rem;
          transition: all 0.3s ease;
          background: rgba(255, 255, 255, 0.8);
          cursor: pointer;
        }

        .form-select:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          background: white;
        }

        .auth-button {
          width: 100%;
          padding: 1rem 2rem;
          border: none;
          border-radius: 12px;
          font-family: var(--mono-font);
          font-size: 0.875rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .auth-button-primary {
          background: var(--black);
          color: var(--white);
        }

        .auth-button-primary:hover:not(:disabled) {
          background: #1a1a1a;
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        }

        .auth-button-google {
          background: white;
          color: #333;
          border: 2px solid rgba(0, 0, 0, 0.1);
        }

        .auth-button-google:hover:not(:disabled) {
          border-color: #667eea;
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        }

        .auth-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none !important;
        }

        .auth-divider {
          display: flex;
          align-items: center;
          margin: 1.5rem 0;
          color: var(--grey);
          font-size: 0.875rem;
        }

        .auth-divider::before,
        .auth-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: rgba(0, 0, 0, 0.1);
        }

        .auth-divider span {
          padding: 0 1rem;
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 1px;
          font-size: 0.75rem;
        }

        .auth-message {
          margin-top: 1rem;
          padding: 1rem;
          border-radius: 12px;
          font-family: var(--body-font);
          font-size: 0.875rem;
        }

        .auth-message.error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #dc2626;
        }

        .auth-message.success {
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.2);
          color: #16a34a;
        }

        .auth-footer {
          text-align: center;
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
        }

        .auth-footer-link {
          color: #667eea;
          text-decoration: none;
          font-family: var(--mono-font);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          transition: all 0.2s ease;
        }

        .auth-footer-link:hover {
          color: #5a67d8;
          text-decoration: underline;
        }

        /* Responsive Design */
        @media (max-width: 640px) {
          .auth-container {
            padding: 1rem;
          }
          
          .auth-card {
            border-radius: 16px;
          }
          
          .auth-header {
            padding: 1.5rem 1.5rem 1rem;
          }
          
          .auth-content {
            padding: 1.5rem;
          }
          
          .auth-title {
            font-size: 1.75rem;
          }
        }

        /* Loading Animation */
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>

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
              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="auth-form">
                  <div className="form-group">
                    <Label htmlFor="login-email" className="form-label">Email</Label>
                    <div className="form-input">
                      <Mail className="form-input-icon" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="Enter your email"
                        value={loginData.email}
                        onChange={(e) => handleInputChange('login', 'email', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="login-password" className="form-label">Password</Label>
                    <div className="form-input">
                      <Lock className="form-input-icon" />
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={loginData.password}
                        onChange={(e) => handleInputChange('login', 'password', e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="form-input-toggle"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="auth-button auth-button-primary"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Signing In...
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="auth-divider">
                  <span>OR</span>
                </div>

                {/* Google Sign-in Button Container - Rendered by Google */}
                <div id="google-signin-button" className="w-full mb-4"></div>
              </TabsContent>

              {/* Register Tab */}
              <TabsContent value="register" className="space-y-4">
                <form onSubmit={handleRegister} className="auth-form">
                  <div className="form-group">
                    <Label htmlFor="register-name" className="form-label">Full Name</Label>
                    <div className="form-input">
                      <User className="form-input-icon" />
                      <Input
                        id="register-name"
                        type="text"
                        placeholder="Enter your full name"
                        value={registerData.full_name}
                        onChange={(e) => handleInputChange('register', 'full_name', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="register-email" className="form-label">Email</Label>
                    <div className="form-input">
                      <Mail className="form-input-icon" />
                      <Input
                        id="register-email"
                        type="email"
                        placeholder="Enter your email"
                        value={registerData.email}
                        onChange={(e) => handleInputChange('register', 'email', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="register-phone" className="form-label">Phone Number</Label>
                    <div className="form-input">
                      <Phone className="form-input-icon" />
                      <Input
                        id="register-phone"
                        type="tel"
                        placeholder="Enter your phone number"
                        value={registerData.phone}
                        onChange={(e) => handleInputChange('register', 'phone', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="register-company" className="form-label">Company Name (Optional)</Label>
                    <div className="form-input">
                      <Building className="form-input-icon" />
                      <Input
                        id="register-company"
                        type="text"
                        placeholder="Enter company name"
                        value={registerData.company_name}
                        onChange={(e) => handleInputChange('register', 'company_name', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="register-role" className="form-label">Account Type</Label>
                    <select
                      id="register-role"
                      value={registerData.role}
                      onChange={(e) => handleInputChange('register', 'role', e.target.value)}
                      className="form-select"
                      required
                    >
                      <option value="customer">Customer</option>
                      <option value="agent">Sales Agent</option>
                      <option value="fleet_owner">Fleet Owner</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="register-password" className="form-label">Password</Label>
                    <div className="form-input">
                      <Lock className="form-input-icon" />
                      <Input
                        id="register-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Create a password"
                        value={registerData.password}
                        onChange={(e) => handleInputChange('register', 'password', e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="form-input-toggle"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <Label htmlFor="register-confirm-password" className="form-label">Confirm Password</Label>
                    <div className="form-input">
                      <Lock className="form-input-icon" />
                      <Input
                        id="register-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Confirm your password"
                        value={registerData.confirm_password}
                        onChange={(e) => handleInputChange('register', 'confirm_password', e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="form-input-toggle"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="auth-button auth-button-primary"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        Create Account
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
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
    </>
  );
}
