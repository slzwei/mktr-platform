import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import CheckCircle from 'lucide-react/icons/check-circle';
import XCircle from 'lucide-react/icons/x-circle';
import MKTRAnimatedLogo from '@/components/MKTRAnimatedLogo';
import { useAuthStore } from '@/stores/authStore';
import { getPostAuthRedirectPath } from '@/lib/utils';

export default function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Processing Google authentication...');
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');

        // Validate OAuth state parameter (CSRF protection)
        const expectedState = sessionStorage.getItem('mktr_oauth_state');
        sessionStorage.removeItem('mktr_oauth_state');
        if (!state || state !== expectedState) {
          setStatus('error');
          setMessage('Invalid OAuth state parameter. Please try logging in again.');
          return;
        }

        if (error) {
          console.error('❌ OAuth error:', error);
          setStatus('error');
          setMessage(`Google authentication failed: ${error}`);
          return;
        }

        if (!code) {
          console.error('❌ No authorization code received');
          setStatus('error');
          setMessage('No authorization code received from Google');
          return;
        }

        setMessage('Verifying with backend...');

        // Send the authorization code to our backend
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/google/callback`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              code: code,
              state: state,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.success && result.data?.user) {
          const user = result.data.user;

          // Store the token and update API client + store atomically
          if (result.data.token) {
            setAuth(user, result.data.token);
          }

          setStatus('success');
          setMessage('Authentication successful! Redirecting...');

          // Unified redirect (client-side navigation to avoid conflicts)
          let targetUrl = getPostAuthRedirectPath(user);

          // Check session storage for return URL
          const storedReturnUrl = sessionStorage.getItem('mktr_auth_return_url');
          if (storedReturnUrl) {
            try {
              const { pathname, search } = JSON.parse(storedReturnUrl);
              targetUrl = `${pathname}${search}`;
              sessionStorage.removeItem('mktr_auth_return_url'); // Clear it
            } catch (e) {
              console.error('❌ Error parsing stored return URL:', e);
            }
          }

          navigate(targetUrl);
        } else {
          console.error('❌ Backend authentication failed:', result.message);
          setStatus('error');
          setMessage(result.message || 'Authentication failed');
        }
      } catch (error) {
        console.error('❌ Callback error:', error);
        setStatus('error');
        setMessage(`Authentication failed: ${error.message}`);
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  if (status === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <MKTRAnimatedLogo message="Verifying your login credentials…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-gray-900 mb-2">Google Authentication</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full mx-auto flex items-center justify-center">
                <CheckCircle className="w-8 h-8" />
              </div>
              <p className="text-gray-600">{message}</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full mx-auto flex items-center justify-center">
                <XCircle className="w-8 h-8" />
              </div>
              <p className="text-red-600">{message}</p>
              <div className="pt-4">
                <button
                  onClick={() => navigate('/CustomerLogin')}
                  className="text-blue-600 hover:text-blue-700 underline"
                >
                  Return to Login
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
