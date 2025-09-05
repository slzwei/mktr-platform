import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Loader2 from 'lucide-react/icons/loader-2';
import CheckCircle from 'lucide-react/icons/check-circle';
import XCircle from 'lucide-react/icons/x-circle';
import MKTRAnimatedLogo from '@/components/MKTRAnimatedLogo';
import { apiClient, auth } from '@/api/client';
import { getPostAuthRedirectPath } from '@/lib/utils';

export default function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Processing Google authentication...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');

        console.log('🔍 Google OAuth callback received');
        console.log('🔍 Code:', code ? 'Present' : 'Missing');
        console.log('🔍 State:', state);
        console.log('🔍 Error:', error);

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

        console.log('🔍 Sending authorization code to backend...');
        setMessage('Verifying with backend...');

        // Send the authorization code to our backend
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/google/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            code: code,
            state: state 
          }),
        });

        console.log('🔍 Backend response status:', response.status);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('🔍 Backend result:', result);

        if (result.success && result.data?.user) {
          const user = result.data.user;
          console.log('✅ Authentication successful, user:', user);

          // Store the token and update API client
          if (result.data.token) {
            localStorage.setItem('mktr_auth_token', result.data.token);
            localStorage.setItem('mktr_user', JSON.stringify(user));
            
            // CRITICAL: Update the API client with the new token
            apiClient.setToken(result.data.token);
            
            // CRITICAL: Set the current user in the auth module
            auth.setCurrentUser(user);
            
            console.log('✅ API client updated with authentication token');
            console.log('✅ Current user set in auth module:', user);
          }

          setStatus('success');
          setMessage('Authentication successful! Redirecting...');

          // Unified redirect (client-side navigation to avoid conflicts)
          const targetUrl = getPostAuthRedirectPath(user);
          console.log('🔄 Redirecting to:', targetUrl);
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
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-gray-900 mb-2">
            Google Authentication
          </CardTitle>
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
  )
}
