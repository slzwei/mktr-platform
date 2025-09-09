#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import fetch from 'node-fetch';

// Config
const BACKEND_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const RUN_ID = `${Date.now()}`;
const TMP_ROOT = path.join(BACKEND_DIR, '.tmp', `legacy-safe-${RUN_ID}`);
const SQLITE_PATH = path.join(TMP_ROOT, 'sqlite.db');
const UPLOADS_DIR = path.join(TMP_ROOT, 'uploads');
const PORT = process.env.SAFE_HARNESS_PORT || '3101';
const BASE_URL = `http://localhost:${PORT}`;
const API = `${BASE_URL}/api`;

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function ensureDirs() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function spawnServer() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT,
    // Use absolute path for sqlite to avoid stray files
    DATABASE_URL: SQLITE_PATH,
    // Ensure JWT secret is present
    JWT_SECRET: process.env.JWT_SECRET || 'test-secret-' + RUN_ID,
    // Keep proxy shim off
    LEGACY_SHIM_FORCE_OFF: 'true',
    // Disable Phase C
    MANIFEST_ENABLED: 'false',
    BEACONS_ENABLED: 'false',
    // Sandbox uploads under temp dir if route honors it; otherwise static serving still safe under /uploads
    UPLOAD_PATH: UPLOADS_DIR,
  };
  const child = spawn('node', ['src/server.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));
  return child;
}

async function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`, { method: 'GET' });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function request(pathname, { method = 'GET', token, body, headers } = {}) {
  const url = pathname.startsWith('http') ? pathname : `${API}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

async function runSuite() {
  const results = [];
  function record(name, ok, detail) {
    results.push({ name, ok, detail });
    log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`, ok ? 'green' : 'red');
  }

  // 1) Register admin
  const register = await request('/auth/register', {
    method: 'POST',
    body: { email: `admin_${RUN_ID}@test.com`, password: 'password123', firstName: 'Admin', lastName: 'User', role: 'admin' }
  });
  record('Register admin', register.ok, register.data?.message);

  // 2) Login
  const login = await request('/auth/login', { method: 'POST', body: { email: `admin_${RUN_ID}@test.com`, password: 'password123' } });
  record('Login admin', login.ok, login.data?.message);
  const token = login.data?.data?.token;

  // 3) Profile
  const profile = await request('/auth/profile', { token });
  record('Get profile', profile.ok);

  // 4) Campaign CRUD (minimal)
  const createCampaign = await request('/campaigns', { method: 'POST', token, body: { name: `Legacy Safe ${RUN_ID}`, type: 'lead_generation' } });
  record('Create campaign', createCampaign.ok, createCampaign.data?.message);
  const campaignId = createCampaign.data?.data?.campaign?.id;
  if (campaignId) {
    const getCampaign = await request(`/campaigns/${campaignId}`, { token });
    record('Get campaign by id', getCampaign.ok);
  }

  // 5) QR create + analytics (if campaign exists)
  const createQr = await request('/qrcodes', { method: 'POST', token, body: { name: 'Test QR', type: 'campaign', destinationUrl: 'https://example.com', campaignId } });
  record('Create QR', createQr.ok, createQr.data?.message);
  const qrId = createQr.data?.data?.qrTag?.id;
  if (qrId) {
    const scan = await request(`/qrcodes/${qrId}/scan`, { method: 'POST', token, body: { metadata: { test: true } } });
    record('Record QR scan', scan.ok);
    const qrAnalytics = await request(`/qrcodes/${qrId}/analytics`, { token });
    record('Get QR analytics', qrAnalytics.ok);
  }

  // 6) Public prospect creation (no auth)
  const createProspect = await request('/prospects', { method: 'POST', body: { firstName: 'Jane', lastName: 'Prospect', email: `jane_${RUN_ID}@test.com`, leadSource: 'qr_code', campaignId: campaignId || null } });
  record('Create prospect (public)', createProspect.ok, createProspect.data?.message);

  // 7) Admin reads
  const listProspects = await request('/prospects', { token });
  record('List prospects (admin)', listProspects.ok);
  const listUsers = await request('/users', { token });
  record('List users (admin)', listUsers.ok);
  const dashboard = await request('/dashboard/overview', { token });
  record('Dashboard overview', dashboard.ok);

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  const report = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: { total: results.length, passed, failed, passRate: results.length ? passed / results.length : 0 },
    results
  };
  const outPath = path.join(BACKEND_DIR, 'comprehensive-test-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  log(`\n📄 Wrote report to ${outPath}`);
  if (failed > 0) {
    log(`\n⚠️  ${failed} checks failed.`, 'red');
  } else {
    log(`\n🎉 All checks passed.`, 'green');
  }
  return failed === 0;
}

async function main() {
  log(`\n${colors.bold}🧪 Legacy Safe Harness (ephemeral)${colors.reset}`,'blue');
  ensureDirs();
  const server = spawnServer();
  try {
    const healthy = await waitForHealth(45000);
    if (!healthy) {
      throw new Error('Server failed health check');
    }
    log('✅ Server is healthy');
    const ok = await runSuite();
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    log(`❌ Harness error: ${e.message}`, 'red');
    process.exitCode = 1;
  } finally {
    try { server.kill('SIGINT'); } catch {}
    // Best-effort cleanup; keep artifacts for debugging if tests failed
    if (process.exitCode === 0) {
      try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
    } else {
      log(`ℹ️  Keeping temp dir for debugging: ${TMP_ROOT}`, 'yellow');
    }
  }
}

main();


