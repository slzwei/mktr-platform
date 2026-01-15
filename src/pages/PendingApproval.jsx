import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, ArrowRight, ShieldCheck, Clock } from 'lucide-react';
import { auth } from '@/api/client';
import { getPostAuthRedirectPath } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import SiteHeader from '@/components/layout/SiteHeader';

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

  const handleManualCheck = async () => {
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
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">
      <SiteHeader />

      <div className="container max-w-lg mx-auto px-4 pt-24 md:pt-32 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
        >
          <div className="p-8 text-center space-y-6">

            {/* Status Icon */}
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-6">
              <Clock className="w-8 h-8 text-blue-600 animate-pulse" />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Application Under Review
              </h1>
              <p className="text-slate-500 text-base leading-relaxed">
                Thanks for signing up! We're currently reviewing your application details. You'll hear from us within the next 24 hours.
              </p>
            </div>

            {/* Check Status Section */}
            <div className="pt-6 border-t border-slate-100 space-y-4">
              <p className="text-sm text-slate-500">
                We'll automatically move you forward as soon as your account is approved.
              </p>

              <div className="flex flex-col items-center gap-3">
                <Button
                  onClick={handleManualCheck}
                  disabled={checking}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 transition-all shadow-md shadow-blue-100 hover:translate-y-[-1px] active:translate-y-[0px]"
                >
                  {checking ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Checking Status...
                    </>
                  ) : (
                    <>
                      Check Status Now
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                {lastCheckedAt && (
                  <span className="text-xs text-slate-400 font-medium">
                    Last checked {lastCheckedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>

            {/* Footer Trust Indicator */}
            <div className="pt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Secure Application Process</span>
            </div>

          </div>
        </motion.div>
      </div>
    </div>
  );
}


