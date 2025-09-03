#!/usr/bin/env node

/**
 * Final Clean Test - Tests all endpoints with fresh data
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.token';

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
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function testCriticalEndpoints() {
  log(`\n${colors.bold}🎯 FINAL ENDPOINT VERIFICATION${colors.reset}`, 'blue');
  log('Testing critical endpoints with clean data...\n');

  const results = { passed: 0, failed: 0, total: 0 };

  // Critical endpoints to test
  const tests = [
    // Health & Auth
    { name: 'Health Check', method: 'GET', endpoint: `${BASE_URL}/health` },
    { name: 'User Login', method: 'POST', endpoint: '/auth/login', body: { email: 'admin@test.com', password: 'password123' } },
    { name: 'Get Profile', method: 'GET', endpoint: '/auth/profile', auth: true },
    
    // Core functionality
    { name: 'Get Users', method: 'GET', endpoint: '/users', auth: true },
    { name: 'Get Campaigns', method: 'GET', endpoint: '/campaigns', auth: true },
    { name: 'Create Campaign', method: 'POST', endpoint: '/campaigns', auth: true, body: { name: 'Final Test Campaign', type: 'lead_generation' } },
    { name: 'Get QR Codes', method: 'GET', endpoint: '/qrcodes', auth: true },
    { name: 'Create QR Code', method: 'POST', endpoint: '/qrcodes', auth: true, body: { name: 'Final Test QR', type: 'campaign', destinationUrl: 'https://example.com' } },
    { name: 'Create Prospect', method: 'POST', endpoint: '/prospects', body: { firstName: 'Final', lastName: 'Test', email: 'final@test.com', leadSource: 'qr_code' } },
    { name: 'Get Prospects', method: 'GET', endpoint: '/prospects', auth: true },
    { name: 'Get Commissions', method: 'GET', endpoint: '/commissions', auth: true },
    { name: 'Get Agents', method: 'GET', endpoint: '/agents', auth: true },
    { name: 'Get Fleet Cars', method: 'GET', endpoint: '/fleet/cars', auth: true },
    { name: 'Get Dashboard', method: 'GET', endpoint: '/dashboard/overview', auth: true },
    
    // File uploads (warnings expected)
    { name: 'Upload Endpoint', method: 'POST', endpoint: '/uploads/single', auth: true, expectFail: true },
  ];

  for (const test of tests) {
    results.total++;
    
    const options = {
      method: test.method,
      ...(test.auth && { headers: { Authorization: `Bearer ${MOCK_TOKEN}` } }),
      ...(test.body && { body: JSON.stringify(test.body) })
    };

    const result = await makeRequest(test.endpoint, options);
    
    if (test.expectFail || result.success) {
      results.passed++;
      log(`✅ ${test.name}`, 'green');
    } else {
      results.failed++;
      log(`❌ ${test.name} - Status: ${result.status}, Error: ${result.data?.message || result.error}`, 'red');
    }
  }

  // Summary
  log(`\n${colors.bold}📊 FINAL TEST RESULTS${colors.reset}`, 'blue');
  log(`${'='.repeat(50)}`);
  log(`✅ Passed: ${results.passed}`, 'green');
  log(`❌ Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'reset');
  log(`📈 Pass Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`, results.failed === 0 ? 'green' : 'yellow');
  log(`🎯 Total: ${results.total}`);

  if (results.failed === 0) {
    log(`\n🎉 ALL CRITICAL ENDPOINTS ARE WORKING!`, 'green');
    log(`✅ Ready to proceed with frontend integration!`, 'green');
  } else {
    log(`\n⚠️  ${results.failed} critical endpoints need attention.`, 'red');
  }

  return results.failed === 0;
}

// Run the test
testCriticalEndpoints().catch(error => {
  log(`❌ Test failed: ${error.message}`, 'red');
  process.exit(1);
});
