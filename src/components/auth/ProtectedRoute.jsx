import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import Loader2 from 'lucide-react/icons/loader-2';
import { getDefaultRouteForRole } from '@/lib/utils';

export default function ProtectedRoute({ children, requiredRole = null }) {
  const { user, token } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (token && user) {
      const status = user.approvalStatus || user.status;
      if (status === 'pending' || status === 'pending_approval') {
        navigate('/PendingApproval');
        return;
      }

      if (requiredRole && user.role !== requiredRole) {
        navigate(getDefaultRouteForRole(user.role));
        return;
      }
    } else {
      navigate('/CustomerLogin', { state: { from: location } });
      return;
    }

    setIsLoading(false);
  }, [navigate, requiredRole, location, token, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  return children;
}
