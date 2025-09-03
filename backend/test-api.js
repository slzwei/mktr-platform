#!/usr/bin/env node

/**
 * API Testing Script for MKTR Backend
 * Run with: node test-api.js
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;

// Test data
let authTokens = {
  admin: '',
  agent: '',
  fleetOwner: ''
};

let testData = {
  users: {},
  campaigns: {},
  prospects: {},
  qrTags: {},
  cars: {},
  drivers: {},
  commissions: {}
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName) {
  log(`\n${colors.bold}🧪 Testing: ${testName}${colors.reset}`, 'blue');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

async function makeRequest(endpoint, options = {}) {
  try {
    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data.message || 'Request failed'}`);
    }

    return { success: true, data, status: response.status };
  } catch (error) {
    return { success: false, error: error.message, status: error.status || 0 };
  }
}

async function testHealthCheck() {
  logTest('Health Check');
  
  const result = await makeRequest(`${BASE_URL}/health`);
  
  if (result.success) {
    logSuccess('Health check passed');
    return true;
  } else {
    logError(`Health check failed: ${result.error}`);
    return false;
  }
}

async function testAuthentication() {
  logTest('Authentication');
  
  // Test user registration
  const users = [
    { email: 'admin@test.com', password: 'password123', firstName: 'Admin', lastName: 'User', role: 'admin' },
    { email: 'agent@test.com', password: 'password123', firstName: 'John', lastName: 'Agent', role: 'agent' },
    { email: 'fleet@test.com', password: 'password123', firstName: 'Fleet', lastName: 'Owner', role: 'fleet_owner' }
  ];

  for (const user of users) {
    const registerResult = await makeRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify(user)
    });

    if (registerResult.success) {
      logSuccess(`Registered ${user.role}: ${user.email}`);
      testData.users[user.role] = registerResult.data.user;
      authTokens[user.role] = registerResult.data.token;
    } else if (registerResult.error.includes('already exists')) {
      logWarning(`User ${user.email} already exists, trying login...`);
      
      // Try login instead
      const loginResult = await makeRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: user.email, password: user.password })
      });

      if (loginResult.success) {
        logSuccess(`Logged in ${user.role}: ${user.email}`);
        testData.users[user.role] = loginResult.data.user;
        authTokens[user.role] = loginResult.data.token;
      } else {
        logError(`Failed to login ${user.role}: ${loginResult.error}`);
        return false;
      }
    } else {
      logError(`Failed to register ${user.role}: ${registerResult.error}`);
      return false;
    }
  }

  // Test profile retrieval
  const profileResult = await makeRequest('/auth/profile', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (profileResult.success) {
    logSuccess('Profile retrieval successful');
    return true;
  } else {
    logError(`Profile retrieval failed: ${profileResult.error}`);
    return false;
  }
}

async function testCampaigns() {
  logTest('Campaign Management');
  
  // Create campaign
  const campaignData = {
    name: 'Test Campaign ' + Date.now(),
    description: 'Automated test campaign',
    type: 'lead_generation',
    budget: 1000,
    targetAudience: { age: '25-45' },
    landingPageUrl: 'https://example.com/test',
    callToAction: 'Test CTA',
    tags: ['test', 'automation']
  };

  const createResult = await makeRequest('/campaigns', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authTokens.admin}` },
    body: JSON.stringify(campaignData)
  });

  if (createResult.success) {
    logSuccess('Campaign created successfully');
    testData.campaigns.test = createResult.data.campaign;
  } else {
    logError(`Campaign creation failed: ${createResult.error}`);
    return false;
  }

  // Get campaigns
  const getResult = await makeRequest('/campaigns', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (getResult.success) {
    logSuccess(`Retrieved ${getResult.data.campaigns.length} campaigns`);
  } else {
    logError(`Campaign retrieval failed: ${getResult.error}`);
    return false;
  }

  // Update campaign
  const updateResult = await makeRequest(`/campaigns/${testData.campaigns.test.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authTokens.admin}` },
    body: JSON.stringify({ status: 'active' })
  });

  if (updateResult.success) {
    logSuccess('Campaign updated successfully');
    return true;
  } else {
    logError(`Campaign update failed: ${updateResult.error}`);
    return false;
  }
}

async function testQRCodes() {
  logTest('QR Code Management');
  
  if (!testData.campaigns.test) {
    logWarning('No test campaign available, skipping QR code test');
    return true;
  }

  // Create QR code
  const qrData = {
    name: 'Test QR Code ' + Date.now(),
    description: 'Automated test QR code',
    type: 'campaign',
    destinationUrl: 'https://example.com/qr-test',
    campaignId: testData.campaigns.test.id,
    tags: ['test']
  };

  const createResult = await makeRequest('/qrcodes', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authTokens.admin}` },
    body: JSON.stringify(qrData)
  });

  if (createResult.success) {
    logSuccess('QR code created successfully');
    testData.qrTags.test = createResult.data.qrTag;
  } else {
    logError(`QR code creation failed: ${createResult.error}`);
    return false;
  }

  // Get QR codes
  const getResult = await makeRequest('/qrcodes', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (getResult.success) {
    logSuccess(`Retrieved ${getResult.data.qrTags.length} QR codes`);
    return true;
  } else {
    logError(`QR code retrieval failed: ${getResult.error}`);
    return false;
  }
}

async function testProspects() {
  logTest('Prospect Management');
  
  // Create prospect
  const prospectData = {
    firstName: 'Test',
    lastName: 'Prospect',
    email: `test.prospect.${Date.now()}@example.com`,
    phone: '555-TEST-001',
    company: 'Test Company',
    leadSource: 'qr_code',
    campaignId: testData.campaigns.test?.id,
    qrTagId: testData.qrTags.test?.id
  };

  const createResult = await makeRequest('/prospects', {
    method: 'POST',
    body: JSON.stringify(prospectData)
  });

  if (createResult.success) {
    logSuccess('Prospect created successfully');
    testData.prospects.test = createResult.data.prospect;
  } else {
    logError(`Prospect creation failed: ${createResult.error}`);
    return false;
  }

  // Get prospects
  const getResult = await makeRequest('/prospects', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (getResult.success) {
    logSuccess(`Retrieved ${getResult.data.prospects.length} prospects`);
  } else {
    logError(`Prospect retrieval failed: ${getResult.error}`);
    return false;
  }

  // Assign prospect to agent
  if (testData.users.agent && testData.prospects.test) {
    const assignResult = await makeRequest(`/prospects/${testData.prospects.test.id}/assign`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authTokens.admin}` },
      body: JSON.stringify({ agentId: testData.users.agent.id })
    });

    if (assignResult.success) {
      logSuccess('Prospect assigned to agent successfully');
      return true;
    } else {
      logError(`Prospect assignment failed: ${assignResult.error}`);
      return false;
    }
  }

  return true;
}

async function testCommissions() {
  logTest('Commission Management');
  
  if (!testData.users.agent || !testData.prospects.test) {
    logWarning('Missing test data for commission test');
    return true;
  }

  // Create commission
  const commissionData = {
    agentId: testData.users.agent.id,
    amount: 100.00,
    type: 'conversion',
    description: 'Test commission',
    campaignId: testData.campaigns.test?.id,
    prospectId: testData.prospects.test.id
  };

  const createResult = await makeRequest('/commissions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authTokens.admin}` },
    body: JSON.stringify(commissionData)
  });

  if (createResult.success) {
    logSuccess('Commission created successfully');
    testData.commissions.test = createResult.data.commission;
  } else {
    logError(`Commission creation failed: ${createResult.error}`);
    return false;
  }

  // Get commissions
  const getResult = await makeRequest('/commissions', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (getResult.success) {
    logSuccess(`Retrieved ${getResult.data.commissions.length} commissions`);
    return true;
  } else {
    logError(`Commission retrieval failed: ${getResult.error}`);
    return false;
  }
}

async function testDashboard() {
  logTest('Dashboard Analytics');
  
  // Get dashboard overview
  const overviewResult = await makeRequest('/dashboard/overview', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (overviewResult.success) {
    logSuccess('Dashboard overview retrieved successfully');
  } else {
    logError(`Dashboard overview failed: ${overviewResult.error}`);
    return false;
  }

  // Get analytics
  const analyticsResult = await makeRequest('/dashboard/analytics?type=prospects&period=30d', {
    headers: { Authorization: `Bearer ${authTokens.admin}` }
  });

  if (analyticsResult.success) {
    logSuccess('Dashboard analytics retrieved successfully');
    return true;
  } else {
    logError(`Dashboard analytics failed: ${analyticsResult.error}`);
    return false;
  }
}

async function runAllTests() {
  log(`${colors.bold}🚀 Starting MKTR Backend API Tests${colors.reset}`, 'blue');
  log(`Base URL: ${BASE_URL}`);
  log(`API URL: ${API_URL}\n`);

  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Authentication', fn: testAuthentication },
    { name: 'Campaigns', fn: testCampaigns },
    { name: 'QR Codes', fn: testQRCodes },
    { name: 'Prospects', fn: testProspects },
    { name: 'Commissions', fn: testCommissions },
    { name: 'Dashboard', fn: testDashboard }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      logError(`Test "${test.name}" threw an error: ${error.message}`);
      failed++;
    }
  }

  // Summary
  log(`\n${colors.bold}📊 Test Results Summary${colors.reset}`, 'blue');
  logSuccess(`Passed: ${passed}`);
  if (failed > 0) {
    logError(`Failed: ${failed}`);
  }
  
  const total = passed + failed;
  const successRate = ((passed / total) * 100).toFixed(1);
  log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'green' : 'yellow');

  // Save test data for reference
  const testResultsPath = path.join(process.cwd(), 'test-results.json');
  fs.writeFileSync(testResultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results: { passed, failed, total, successRate },
    testData,
    authTokens: {
      admin: authTokens.admin ? 'SET' : 'NOT_SET',
      agent: authTokens.agent ? 'SET' : 'NOT_SET',
      fleetOwner: authTokens.fleetOwner ? 'SET' : 'NOT_SET'
    }
  }, null, 2));

  log(`\n📄 Test results saved to: ${testResultsPath}`);
  
  if (failed === 0) {
    log(`\n🎉 All tests passed! Your API is working correctly.`, 'green');
  } else {
    log(`\n⚠️  Some tests failed. Check the logs above for details.`, 'yellow');
  }
}

// Check if node-fetch is available
try {
  await import('node-fetch');
} catch (error) {
  logError('node-fetch is required. Install it with: npm install node-fetch');
  process.exit(1);
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    logError(`Test runner failed: ${error.message}`);
    process.exit(1);
  });
}
