import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import CheckCircle from 'lucide-react/icons/check-circle';
import XCircle from 'lucide-react/icons/x-circle';
import AlertCircle from 'lucide-react/icons/alert-circle';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import User from 'lucide-react/icons/user';
import LogOut from 'lucide-react/icons/log-out';
import Shield from 'lucide-react/icons/shield';
import { auth } from '@/api/client';
import { useNavigate } from 'react-router-dom';

export default function AuthTest() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ passed: 0, failed: 0, total: 0 });
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  const navigate = useNavigate();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const user = await auth.getCurrentUser();
      setCurrentUser(user);
      setIsAuthenticated(!!user);
    } catch (error) {
      console.error('Auth status check failed:', error);
    }
  };

  const runAuthTests = async () => {
    setLoading(true);
    setResults([]);
    
    const testResults = [];
    let passed = 0;
    let failed = 0;

    const addResult = (name, success, details = '') => {
      testResults.push({
        name,
        success,
        details,
        timestamp: new Date().toLocaleTimeString()
      });
      
      if (success) passed++;
      else failed++;
      
      setResults([...testResults]);
      setSummary({ passed, failed, total: passed + failed });
    };

    try {
      // Test 1: Check if user is currently authenticated
      try {
        const user = await auth.getCurrentUser();
        addResult('Current Auth Status', !!user, user ? `Logged in as: ${user.email}` : 'No user logged in');
      } catch (error) {
        addResult('Current Auth Status', false, error.message);
      }

      // Test 2: Test Registration
      try {
        const testEmail = `test.${Date.now()}@example.com`;
        const registerResult = await auth.register({
          full_name: 'Test User',
          email: testEmail,
          password: 'testpass123',
          confirm_password: 'testpass123',
          role: 'customer'
        });
        addResult('User Registration', registerResult.success, `Created user: ${testEmail}`);
      } catch (error) {
        addResult('User Registration', false, error.message);
      }

      // Test 3: Test Login
      try {
        const testEmail = `test.${Date.now() - 1000}@example.com`;
        // First register a user
        await auth.register({
          full_name: 'Test User',
          email: testEmail,
          password: 'testpass123',
          confirm_password: 'testpass123',
          role: 'customer'
        });
        
        // Then try to login
        const loginResult = await auth.login(testEmail, 'testpass123');
        addResult('User Login', loginResult.success, `Logged in: ${testEmail}`);
      } catch (error) {
        addResult('User Login', false, error.message);
      }

      // Test 4: Test Google OAuth (Mock)
      try {
        const googleResult = await auth.googleLogin('mock-google-token');
        addResult('Google OAuth', googleResult.success, 'Google authentication successful');
      } catch (error) {
        addResult('Google OAuth', false, error.message);
      }

      // Test 5: Test Protected Route Access
      try {
        const user = await auth.getCurrentUser();
        if (user) {
          addResult('Protected Route Access', true, `User ${user.email} can access protected routes`);
        } else {
          addResult('Protected Route Access', false, 'No authenticated user');
        }
      } catch (error) {
        addResult('Protected Route Access', false, error.message);
      }

      // Test 6: Test Logout
      try {
        auth.logout();
        const userAfterLogout = await auth.getCurrentUser();
        addResult('User Logout', !userAfterLogout, 'User successfully logged out');
      } catch (error) {
        addResult('User Logout', false, error.message);
      }

    } catch (error) {
      addResult('Auth Test Suite', false, `Test suite failed: ${error.message}`);
    }

    setLoading(false);
    // Refresh auth status after tests
    checkAuthStatus();
  };

  const handleLogin = () => {
    navigate('/CustomerLogin');
  };

  const handleLogout = () => {
    auth.logout();
    checkAuthStatus();
  };

  const getStatusIcon = (success) => {
    if (success) {
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    } else {
      return <XCircle className="w-4 h-4 text-red-600" />;
    }
  };

  const getStatusBadge = (success) => {
    if (success) {
      return <Badge className="bg-green-100 text-green-800">PASS</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800">FAIL</Badge>;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Authentication System Test</h1>
        <p className="text-gray-600">Testing MKTR authentication system with Google OAuth</p>
      </div>

      {/* Auth Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Authentication Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <User className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="font-medium text-gray-900">Authenticated</p>
                    <p className="text-sm text-gray-600">{currentUser?.email}</p>
                    <p className="text-xs text-gray-500">Role: {currentUser?.role}</p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-600" />
                  <div>
                    <p className="font-medium text-gray-900">Not Authenticated</p>
                    <p className="text-sm text-gray-600">Please log in to continue</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {isAuthenticated ? (
                <Button onClick={handleLogout} variant="outline" className="flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  Logout
                </Button>
              ) : (
                <Button onClick={handleLogin} className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Login
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Summary Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Test Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
              <div className="text-sm text-gray-600">Total Tests</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{summary.passed}</div>
              <div className="text-sm text-gray-600">Passed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">
                {summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : 0}%
              </div>
              <div className="text-sm text-gray-600">Success Rate</div>
            </div>
          </div>
          
          <div className="mt-4 flex gap-2">
            <Button onClick={runAuthTests} disabled={loading} className="flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Running Tests...' : 'Run Authentication Tests'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Card>
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && results.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Running authentication tests...</span>
            </div>
          )}

          <div className="space-y-3">
            {results.map((result, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {getStatusIcon(result.success)}
                  <div>
                    <div className="font-medium">{result.name}</div>
                    {result.details && (
                      <div className="text-sm text-gray-600">{result.details}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{result.timestamp}</span>
                  {getStatusBadge(result.success)}
                </div>
              </div>
            ))}
          </div>

          {results.length === 0 && !loading && (
            <div className="text-center py-8 text-gray-500">
              No test results yet. Click "Run Authentication Tests" to start.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Alert */}
      {summary.total > 0 && (
        <Alert className={`mt-6 ${summary.failed === 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {summary.failed === 0 ? (
              <span className="text-green-800">
                🎉 All authentication tests passed! Your auth system is working perfectly.
              </span>
            ) : (
              <span className="text-red-800">
                ⚠️ {summary.failed} test(s) failed. Check the authentication system configuration.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Quick Actions */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Button onClick={() => navigate('/CustomerLogin')} className="w-full">
              Test Login Form
            </Button>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 text-center">
            <Button onClick={() => navigate('/AdminDashboard')} variant="outline" className="w-full">
              Test Protected Route
            </Button>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 text-center">
            <Button onClick={() => navigate('/ApiTest')} variant="outline" className="w-full">
              Test API Endpoints
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
