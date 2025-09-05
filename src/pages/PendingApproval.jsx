import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader2 from 'lucide-react/icons/loader-2';
import SiteHeader from '@/components/layout/SiteHeader';

export default function PendingApproval() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('mktr_auth_token');
    if (!token) navigate('/');
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
            <p className="text-sm text-gray-500 mt-6">If you try to sign in again, we’ll bring you back here while your account is pending approval.</p>
          </div>
        </div>
      </div>
    </>
  );
}


