import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/api/client';
import { Loader2 } from 'lucide-react';
import { getDefaultRouteForRole } from '@/lib/utils';

export default function ProtectedRoute({ children, requiredRole = null }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      console.log('🔍 PROTECTED ROUTE: Checking authentication...');
      console.log('🔍 PROTECTED ROUTE: Required role:', requiredRole);
      
      try {
        // CRITICAL FIX: Check localStorage first to avoid unnecessary API calls
        const token = localStorage.getItem('mktr_auth_token');
        const storedUser = localStorage.getItem('mktr_user');
        
        console.log('🔍 PROTECTED ROUTE: Token present:', !!token);
        console.log('🔍 PROTECTED ROUTE: Stored user present:', !!storedUser);
        
        if (token && storedUser) {
          // Fast path: Use cached data directly
          const currentUser = JSON.parse(storedUser);
          console.log('🔍 PROTECTED ROUTE: Using cached user:', currentUser);
          
          // Ensure API client has the token
          auth.setCurrentUser(currentUser);
          
          setUser(currentUser);
          setIsAuthenticated(true);
          
          // Check role requirement if specified
          if (requiredRole && currentUser.role !== requiredRole) {
            console.log('🚫 PROTECTED ROUTE: Role mismatch! Required:', requiredRole, 'Actual:', currentUser.role);
            const target = getDefaultRouteForRole(currentUser.role);
            console.log('🚀 PROTECTED ROUTE: Redirecting to', target);
            navigate(target);
            return;
          } else {
            console.log('✅ PROTECTED ROUTE: Access granted!');
          }
        } else {
          console.log('🔍 PROTECTED ROUTE: No cached data, checking with backend...');
          // Fallback: Check with backend
          const currentUser = await auth.getCurrentUser();
          console.log('🔍 PROTECTED ROUTE: Backend user:', currentUser);
          
          if (currentUser) {
            setUser(currentUser);
            setIsAuthenticated(true);
            console.log('✅ PROTECTED ROUTE: Access granted via backend!');
          } else {
            console.log('❌ PROTECTED ROUTE: No user found, redirecting to login...');
            navigate('/CustomerLogin');
            return;
          }
        }
      } catch (error) {
        console.error('❌ PROTECTED ROUTE: Authentication check failed:', error);
        navigate('/CustomerLogin');
        return;
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [navigate, requiredRole]);

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

  if (!isAuthenticated) {
    return null; // Will redirect to login
  }

  return children;
}
