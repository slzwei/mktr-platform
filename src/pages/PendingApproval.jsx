import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader2 from 'lucide-react/icons/loader-2';
import SiteHeader from '@/components/layout/SiteHeader';
import { auth } from '@/api/client';
import { getPostAuthRedirectPath } from '@/lib/utils';

export default function PendingApproval() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('mktr_auth_token');
    if (!token) navigate('/');
    
    // Poll for approval status every 5 seconds and redirect once approved
    const checkStatus = async () => {
      try {
        setChecking(true);
        const freshUser = await auth.getCurrentUser(true);
        setLastCheckedAt(new Date());
        if (freshUser && freshUser.approvalStatus !== 'pending' && freshUser.status !== 'pending_approval') {
          // Keep local auth state fresh and navigate to the correct destination
          auth.setCurrentUser(freshUser);
          const target = getPostAuthRedirectPath(freshUser);
          navigate(target);
        }
      } catch (_) {
        // no-op: stay on page
      } finally {
        setChecking(false);
      }
    };

    // Initial check immediately, then poll
    checkStatus();
    intervalRef.current = setInterval(checkStatus, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [navigate]);

  return (
    <>
      <style>{`
        :root {
          --heading-font: 'Mindset', 'Inter', sans-serif;
          --body-font: 'Inter', sans-serif;
          --mono-font: 'PT Mono', 'Courier New', monospace;
          --black: #000000;
          --white: #ffffff;
          --grey: #909090;
        }

        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=PT+Mono:wght@400&display=swap');

        .section-title {
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 3px;
          font-size: 0.875rem;
          color: var(--black);
        }

        .body-text {
          font-family: var(--body-font);
          font-size: 1.05rem;
          line-height: 1.7;
          color: var(--grey);
        }
      `}</style>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
        <SiteHeader />
        <div className="h-20 md:h-24" />

        <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-6">
          <div className="max-w-lg mx-auto bg-white border rounded-2xl shadow-xl p-8 text-center">
            <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-black text-white flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'var(--heading-font)' }}>Thanks for signing up!</h1>
            <p className="body-text mb-6 text-gray-600">We’re reviewing your application. You’ll hear from us within the next 24 hours.</p>
            <div className="mx-auto w-24 h-24 relative">
              <div className="absolute inset-0 rounded-full border-4 border-dashed border-gray-300 animate-spin" style={{ animationDuration: '2.5s' }} />
              <div className="absolute inset-3 rounded-full bg-black flex items-center justify-center">
                <span className="text-white font-bold">✓</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-6">We'll automatically move you forward as soon as your account is approved.</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={async () => {
                  // Manual refresh
                  try {
                    setChecking(true);
                    const freshUser = await auth.getCurrentUser(true);
                    setLastCheckedAt(new Date());
                    if (freshUser && freshUser.approvalStatus !== 'pending' && freshUser.status !== 'pending_approval') {
                      auth.setCurrentUser(freshUser);
                      const target = getPostAuthRedirectPath(freshUser);
                      navigate(target);
                    }
                  } finally {
                    setChecking(false);
                  }
                }}
                className="px-4 py-2 rounded-md bg-black text-white hover:opacity-90 disabled:opacity-60"
                disabled={checking}
              >
                {checking ? 'Checking…' : 'Check status now'}
              </button>
              {lastCheckedAt && (
                <span className="text-xs text-gray-400">Last checked {lastCheckedAt.toLocaleTimeString()}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}


