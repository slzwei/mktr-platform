#!/usr/bin/env node

/**
 * Comprehensive Endpoint Testing Script
 * Tests ALL endpoints and reports which ones are not working
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.token';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: []
};

// Test data storage
let testData = {
  users: {},
  campaigns: {},
  prospects: {},
  qrTags: {},
  commissions: {},
  fleetOwners: {},
  cars: {},
  drivers: {}
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
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
    
    return { 
      success: response.ok, 
      data, 
      status: response.status,
      statusText: response.statusText
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message, 
      status: 0
    };
  }
}

function addResult(category, testName, endpoint, status, details = '') {
  results[category].push({
    testName,
    endpoint,
    status,
    details,
    timestamp: new Date().toISOString()
  });
}

async function testEndpoint(testName, method, endpoint, options = {}, expectedStatus = 200) {
  try {
    const result = await makeRequest(endpoint, { method, ...options });
    
    if (result.success && result.status === expectedStatus) {
      addResult('passed', testName, `${method} ${endpoint}`, result.status, 'SUCCESS');
      log(`✅ ${testName}`, 'green');
      return result;
    } else {
      addResult('failed', testName, `${method} ${endpoint}`, result.status, result.error || result.data?.message || 'Unexpected response');
      log(`❌ ${testName} - Status: ${result.status}, Details: ${result.error || result.data?.message || 'Unknown error'}`, 'red');
      return result;
    }
  } catch (error) {
    addResult('failed', testName, `${method} ${endpoint}`, 0, error.message);
    log(`❌ ${testName} - Error: ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  log(`\n${colors.bold}🧪 COMPREHENSIVE ENDPOINT TESTING${colors.reset}`, 'blue');
  log(`Testing all endpoints against: ${BASE_URL}\n`);

  // ===== HEALTH CHECK =====
  log(`\n${colors.bold}🏥 HEALTH CHECK${colors.reset}`, 'blue');
  await testEndpoint('Health Check', 'GET', `${BASE_URL}/health`);

  // ===== AUTHENTICATION ENDPOINTS =====
  log(`\n${colors.bold}🔐 AUTHENTICATION ENDPOINTS${colors.reset}`, 'blue');
  
  const registerResult = await testEndpoint('Register Admin User', 'POST', '/auth/register', {
    body: JSON.stringify({
      email: 'admin@test.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin'
    })
  }, 201);
  
  if (registerResult.success) {
    testData.users.admin = registerResult.data.data.user;
  }

  await testEndpoint('Register Agent User', 'POST', '/auth/register', {
    body: JSON.stringify({
      email: 'agent@test.com',
      password: 'password123',
      firstName: 'John',
      lastName: 'Agent',
      role: 'agent'
    })
  }, 201);

  await testEndpoint('Register Fleet Owner', 'POST', '/auth/register', {
    body: JSON.stringify({
      email: 'fleet@test.com',
      password: 'password123',
      firstName: 'Fleet',
      lastName: 'Owner',
      role: 'fleet_owner'
    })
  }, 201);

  const loginResult = await testEndpoint('User Login', 'POST', '/auth/login', {
    body: JSON.stringify({
      email: 'admin@test.com',
      password: 'password123'
    })
  });

  await testEndpoint('Get User Profile', 'GET', '/auth/profile', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  await testEndpoint('Update User Profile', 'PUT', '/auth/profile', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      firstName: 'Updated',
      lastName: 'Admin'
    })
  });

  await testEndpoint('Change Password', 'PUT', '/auth/change-password', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      currentPassword: 'password123',
      newPassword: 'newpassword123'
    })
  });

  // ===== USER MANAGEMENT =====
  log(`\n${colors.bold}👥 USER MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get All Users', 'GET', '/users', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  if (testData.users.admin) {
    await testEndpoint('Get User by ID', 'GET', `/users/${testData.users.admin.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Update User', 'PUT', `/users/${testData.users.admin.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        firstName: 'Updated Admin'
      })
    });
  } else {
    addResult('warnings', 'Get User by ID', 'GET /users/:id', 0, 'Skipped - no test user ID available');
    addResult('warnings', 'Update User', 'PUT /users/:id', 0, 'Skipped - no test user ID available');
  }

  await testEndpoint('Get Agents List', 'GET', '/users/agents/list', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  // ===== CAMPAIGN MANAGEMENT =====
  log(`\n${colors.bold}📊 CAMPAIGN MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get All Campaigns', 'GET', '/campaigns', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  const campaignResult = await testEndpoint('Create Campaign', 'POST', '/campaigns', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      name: 'Test Campaign',
      description: 'Comprehensive test campaign',
      type: 'lead_generation',
      budget: 5000,
      targetAudience: { age: '25-45' },
      landingPageUrl: 'https://example.com/test',
      callToAction: 'Test CTA',
      tags: ['test', 'automation']
    })
  }, 201);

  if (campaignResult.success) {
    testData.campaigns.test = campaignResult.data.data.campaign;
    
    await testEndpoint('Get Campaign by ID', 'GET', `/campaigns/${testData.campaigns.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Update Campaign', 'PUT', `/campaigns/${testData.campaigns.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        status: 'active',
        budget: 7500
      })
    });

    await testEndpoint('Get Campaign Analytics', 'GET', `/campaigns/${testData.campaigns.test.id}/analytics`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Duplicate Campaign', 'POST', `/campaigns/${testData.campaigns.test.id}/duplicate`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        name: 'Duplicated Test Campaign'
      })
    }, 201);
  } else {
    addResult('warnings', 'Campaign Operations', 'Various', 0, 'Skipped - campaign creation failed');
  }

  // ===== QR CODE MANAGEMENT =====
  log(`\n${colors.bold}📱 QR CODE MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get All QR Codes', 'GET', '/qrcodes', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  const qrResult = await testEndpoint('Create QR Code', 'POST', '/qrcodes', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      name: 'Test QR Code',
      description: 'Comprehensive test QR code',
      type: 'campaign',
      destinationUrl: 'https://example.com/qr-test',
      campaignId: testData.campaigns.test?.id,
      tags: ['test']
    })
  }, 201);

  if (qrResult.success) {
    testData.qrTags.test = qrResult.data.data.qrTag;
    
    await testEndpoint('Get QR Code by ID', 'GET', `/qrcodes/${testData.qrTags.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Update QR Code', 'PUT', `/qrcodes/${testData.qrTags.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        name: 'Updated QR Code'
      })
    });

    await testEndpoint('Record QR Scan', 'POST', `/qrcodes/${testData.qrTags.test.id}/scan`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        metadata: { location: 'Test Location' }
      })
    });

    await testEndpoint('Get QR Analytics', 'GET', `/qrcodes/${testData.qrTags.test.id}/analytics`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });
  }

  await testEndpoint('Bulk QR Operations', 'POST', '/qrcodes/bulk', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      operation: 'activate',
      qrTagIds: [testData.qrTags.test?.id || 'dummy-id']
    })
  });

  // ===== PROSPECT MANAGEMENT =====
  log(`\n${colors.bold}👤 PROSPECT MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get All Prospects', 'GET', '/prospects', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  const prospectResult = await testEndpoint('Create Prospect (Lead Capture)', 'POST', '/prospects', {
    body: JSON.stringify({
      firstName: 'Jane',
      lastName: 'Prospect',
      email: 'jane@example.com',
      phone: '555-123-4567',
      company: 'Test Corp',
      leadSource: 'qr_code',
      campaignId: testData.campaigns.test?.id,
      qrTagId: testData.qrTags.test?.id
    })
  }, 201);

  if (prospectResult.success) {
    testData.prospects.test = prospectResult.data.data.prospect;
    
    await testEndpoint('Get Prospect by ID', 'GET', `/prospects/${testData.prospects.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Update Prospect', 'PUT', `/prospects/${testData.prospects.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        leadStatus: 'qualified',
        priority: 'high'
      })
    });

    await testEndpoint('Assign Prospect to Agent', 'PATCH', `/prospects/${testData.prospects.test.id}/assign`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        agentId: testData.users.admin?.id || 'dummy-agent-id'
      })
    });
  }

  await testEndpoint('Bulk Assign Prospects', 'PATCH', '/prospects/bulk/assign', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      prospectIds: [testData.prospects.test?.id || 'dummy-id'],
      agentId: testData.users.admin?.id || 'dummy-agent-id'
    })
  });

  await testEndpoint('Get Prospect Statistics', 'GET', '/prospects/stats/overview', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  // ===== FLEET MANAGEMENT =====
  log(`\n${colors.bold}🚗 FLEET MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get Fleet Owners', 'GET', '/fleet/owners', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  const fleetOwnerResult = await testEndpoint('Create Fleet Owner Profile', 'POST', '/fleet/owners', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      companyName: 'Test Fleet LLC',
      businessType: 'transportation',
      businessLicense: 'BL123456'
    })
  }, 201);

  if (fleetOwnerResult.success) {
    testData.fleetOwners.test = fleetOwnerResult.data.data.fleetOwner;
  }

  await testEndpoint('Get All Cars', 'GET', '/fleet/cars', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  const carResult = await testEndpoint('Create Car', 'POST', '/fleet/cars', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      licensePlate: 'TEST123',
      type: 'sedan'
    })
  }, 201);

  if (carResult.success) {
    testData.cars.test = carResult.data.data.car;
    
    await testEndpoint('Get Car by ID', 'GET', `/fleet/cars/${testData.cars.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Update Car', 'PUT', `/fleet/cars/${testData.cars.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        status: 'active'
      })
    });
  }

  await testEndpoint('Get All Drivers', 'GET', '/fleet/drivers', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  await testEndpoint('Get Fleet Statistics', 'GET', '/fleet/stats/overview', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  // ===== COMMISSION MANAGEMENT =====
  log(`\n${colors.bold}💰 COMMISSION MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get All Commissions', 'GET', '/commissions', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  const commissionResult = await testEndpoint('Create Commission', 'POST', '/commissions', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
    body: JSON.stringify({
      agentId: testData.users.admin?.id || 'dummy-agent-id',
      amount: 150.00,
      type: 'conversion',
      description: 'Test commission'
    })
  }, 201);

  if (commissionResult.success) {
    testData.commissions.test = commissionResult.data.data.commission;
    
    await testEndpoint('Get Commission by ID', 'GET', `/commissions/${testData.commissions.test.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Approve Commission', 'PATCH', `/commissions/${testData.commissions.test.id}/approve`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        notes: 'Test approval'
      })
    });

    await testEndpoint('Mark Commission as Paid', 'PATCH', `/commissions/${testData.commissions.test.id}/pay`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` },
      body: JSON.stringify({
        paymentMethod: 'bank_transfer',
        transactionId: 'TEST123'
      })
    });
  }

  await testEndpoint('Get Commission Statistics', 'GET', '/commissions/stats/overview', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  // ===== AGENT MANAGEMENT =====
  log(`\n${colors.bold}👨‍💼 AGENT MANAGEMENT ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get All Agents', 'GET', '/agents', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  if (testData.users.admin) {
    await testEndpoint('Get Agent by ID', 'GET', `/agents/${testData.users.admin.id}`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Get Agent Prospects', 'GET', `/agents/${testData.users.admin.id}/prospects`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Get Agent Commissions', 'GET', `/agents/${testData.users.admin.id}/commissions`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });

    await testEndpoint('Get Agent Campaigns', 'GET', `/agents/${testData.users.admin.id}/campaigns`, {
      headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
    });
  }

  await testEndpoint('Get Performance Leaderboard', 'GET', '/agents/leaderboard/performance', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  // ===== FILE UPLOADS =====
  log(`\n${colors.bold}📁 FILE UPLOAD ENDPOINTS${colors.reset}`, 'blue');

  // Note: These are mock tests since we can't easily test file uploads with fetch
  addResult('warnings', 'Upload Single File', 'POST /uploads/single', 0, 'Requires multipart/form-data - test manually');
  addResult('warnings', 'Upload Multiple Files', 'POST /uploads/multiple', 0, 'Requires multipart/form-data - test manually');
  addResult('warnings', 'Upload Avatar', 'POST /uploads/avatar', 0, 'Requires multipart/form-data - test manually');
  addResult('warnings', 'Upload Campaign Assets', 'POST /uploads/campaign-assets', 0, 'Requires multipart/form-data - test manually');

  // ===== DASHBOARD =====
  log(`\n${colors.bold}📊 DASHBOARD ENDPOINTS${colors.reset}`, 'blue');

  await testEndpoint('Get Dashboard Overview', 'GET', '/dashboard/overview', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  await testEndpoint('Get Dashboard Analytics - Prospects', 'GET', '/dashboard/analytics?type=prospects&period=30d', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  await testEndpoint('Get Dashboard Analytics - Campaigns', 'GET', '/dashboard/analytics?type=campaigns&period=30d', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  await testEndpoint('Get Dashboard Analytics - Commissions', 'GET', '/dashboard/analytics?type=commissions&period=month', {
    headers: { Authorization: `Bearer ${MOCK_TOKEN}` }
  });

  // ===== GENERATE FINAL REPORT =====
  generateReport();
}

function generateReport() {
  const total = results.passed.length + results.failed.length + results.warnings.length;
  const passRate = ((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1);

  log(`\n${colors.bold}📋 COMPREHENSIVE TEST RESULTS${colors.reset}`, 'blue');
  log(`${'='.repeat(60)}`);
  
  log(`\n${colors.bold}📊 SUMMARY:${colors.reset}`);
  log(`✅ Passed: ${results.passed.length}`, 'green');
  log(`❌ Failed: ${results.failed.length}`, results.failed.length > 0 ? 'red' : 'reset');
  log(`⚠️  Warnings: ${results.warnings.length}`, 'yellow');
  log(`📈 Pass Rate: ${passRate}%`, passRate === '100.0' ? 'green' : 'yellow');
  log(`🎯 Total Tests: ${total}`);

  if (results.failed.length > 0) {
    log(`\n${colors.bold}❌ FAILED ENDPOINTS (MUST BE FIXED):${colors.reset}`, 'red');
    log(`${'='.repeat(60)}`);
    results.failed.forEach((test, index) => {
      log(`${index + 1}. ${test.testName}`, 'red');
      log(`   Endpoint: ${test.endpoint}`, 'red');
      log(`   Status: ${test.status}`, 'red');
      log(`   Details: ${test.details}`, 'red');
      log('');
    });
  }

  if (results.warnings.length > 0) {
    log(`\n${colors.bold}⚠️  WARNINGS (NEED MANUAL TESTING):${colors.reset}`, 'yellow');
    log(`${'='.repeat(60)}`);
    results.warnings.forEach((test, index) => {
      log(`${index + 1}. ${test.testName}`, 'yellow');
      log(`   Endpoint: ${test.endpoint}`, 'yellow');
      log(`   Details: ${test.details}`, 'yellow');
      log('');
    });
  }

  log(`\n${colors.bold}✅ WORKING ENDPOINTS:${colors.reset}`, 'green');
  log(`${'='.repeat(60)}`);
  results.passed.forEach((test, index) => {
    log(`${index + 1}. ${test.testName} - ${test.endpoint}`, 'green');
  });

  // Save detailed results
  const reportData = {
    timestamp: new Date().toISOString(),
    summary: {
      total,
      passed: results.passed.length,
      failed: results.failed.length,
      warnings: results.warnings.length,
      passRate: parseFloat(passRate)
    },
    results,
    testData
  };

  import('fs').then(fs => {
    fs.writeFileSync('comprehensive-test-results.json', JSON.stringify(reportData, null, 2));
    log(`\n📄 Detailed results saved to: comprehensive-test-results.json`);
    
    if (results.failed.length === 0) {
      log(`\n🎉 ALL ENDPOINTS ARE WORKING! Ready to proceed.`, 'green');
    } else {
      log(`\n⚠️  ${results.failed.length} endpoints need to be fixed before proceeding.`, 'red');
    }
  });
}

// Run all tests
runAllTests().catch(error => {
  log(`\n❌ Test runner failed: ${error.message}`, 'red');
  process.exit(1);
});
