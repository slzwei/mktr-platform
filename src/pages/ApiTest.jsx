import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import CheckCircle from 'lucide-react/icons/check-circle';
import XCircle from 'lucide-react/icons/x-circle';
import AlertCircle from 'lucide-react/icons/alert-circle';
import RefreshCw from 'lucide-react/icons/refresh-cw';

// Import our new API client
import { auth, entities, dashboard, agents } from '@/api/client';

export default function ApiTest() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ passed: 0, failed: 0, total: 0 });

  const runTests = async () => {
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
      // Test 1: Health Check
      try {
        const response = await fetch('http://localhost:3001/health');
        const data = await response.json();
        addResult('Backend Health Check', response.ok, data.status);
      } catch (error) {
        addResult('Backend Health Check', false, error.message);
      }

      // Test 2: Authentication
      try {
        const loginResult = await auth.login('admin@test.com', 'password123');
        addResult('User Login', loginResult.success, 'JWT token received');
      } catch (error) {
        addResult('User Login', false, error.message);
      }

      // Test 3: Get Campaigns
      try {
        const campaigns = await entities.Campaign.list();
        addResult('Get Campaigns', Array.isArray(campaigns), `${campaigns.length} campaigns loaded`);
      } catch (error) {
        addResult('Get Campaigns', false, error.message);
      }

      // Test 4: Create Campaign
      try {
        const newCampaign = await entities.Campaign.create({
          name: 'Frontend Test Campaign',
          description: 'Testing frontend integration',
          type: 'lead_generation',
          budget: 1000
        });
        addResult('Create Campaign', !!newCampaign.id, `Campaign ID: ${newCampaign.id}`);
      } catch (error) {
        addResult('Create Campaign', false, error.message);
      }

      // Test 5: Get Prospects
      try {
        const prospects = await entities.Prospect.list();
        addResult('Get Prospects', Array.isArray(prospects), `${prospects.length} prospects loaded`);
      } catch (error) {
        addResult('Get Prospects', false, error.message);
      }

      // Test 6: Create Prospect (Lead Capture)
      try {
        const newProspect = await entities.Prospect.create({
          firstName: 'Frontend',
          lastName: 'Test',
          email: `frontend.test.${Date.now()}@example.com`,
          leadSource: 'website'
        });
        addResult('Create Prospect', !!newProspect.id, `Prospect ID: ${newProspect.id}`);
      } catch (error) {
        addResult('Create Prospect', false, error.message);
      }

      // Test 7: Get QR Codes
      try {
        const qrTags = await entities.QrTag.list();
        addResult('Get QR Codes', Array.isArray(qrTags), `${qrTags.length} QR codes loaded`);
      } catch (error) {
        addResult('Get QR Codes', false, error.message);
      }

      // Test 8: Dashboard Data
      try {
        const dashboardData = await dashboard.getOverview();
        addResult('Dashboard Overview', !!dashboardData.stats, 'Dashboard data loaded');
      } catch (error) {
        addResult('Dashboard Overview', false, error.message);
      }

      // Test 9: Get Agents
      try {
        const agentsList = await agents.getAll();
        addResult('Get Agents', Array.isArray(agentsList.agents), `${agentsList.agents?.length || 0} agents loaded`);
      } catch (error) {
        addResult('Get Agents', false, error.message);
      }

      // Test 10: User Profile
      try {
        const currentUser = await auth.getCurrentUser();
        addResult('Get User Profile', !!currentUser, `User: ${currentUser?.email || 'Not found'}`);
      } catch (error) {
        addResult('Get User Profile', false, error.message);
      }

    } catch (error) {
      addResult('Test Suite', false, `Test suite failed: ${error.message}`);
    }

    setLoading(false);
  };

  useEffect(() => {
    // Auto-run tests when component mounts
    runTests();
  }, []);

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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">API Integration Test</h1>
        <p className="text-gray-600">Testing frontend connection to MKTR backend API</p>
      </div>

      {/* Summary Card */}
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
            <Button onClick={runTests} disabled={loading} className="flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Running Tests...' : 'Run Tests Again'}
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
              <span>Running API tests...</span>
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
              No test results yet. Click "Run Tests" to start.
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
                🎉 All tests passed! Frontend is successfully connected to the backend API.
              </span>
            ) : (
              <span className="text-red-800">
                ⚠️ {summary.failed} test(s) failed. Check the backend server and API endpoints.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
