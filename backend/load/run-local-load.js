#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const BACKEND_DIR = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const RUN_ID = `${Date.now()}`;
const TMP_ROOT = path.join(BACKEND_DIR, '.tmp', `load-${RUN_ID}`);
const SQLITE_PATH = path.join(TMP_ROOT, 'sqlite.db');
const UPLOADS_DIR = path.join(TMP_ROOT, 'uploads');
const PORT = process.env.SAFE_HARNESS_PORT || '3101';
const TARGET_BASE_URL = process.env.TARGET_BASE_URL || `http://localhost:${PORT}`;
const ARTILLERY_BIN = process.env.npm_config_artillery || 'npx';
const PROFILE = process.env.LOAD_PROFILE || 'smoke';

function ensureDirs() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function spawnServer() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT,
    DATABASE_URL: SQLITE_PATH,
    JWT_SECRET: process.env.JWT_SECRET || 'load-secret-' + RUN_ID,
    LEGACY_SHIM_FORCE_OFF: 'true',
    MANIFEST_ENABLED: 'false',
    BEACONS_ENABLED: 'false',
    UPLOAD_PATH: UPLOADS_DIR
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

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${TARGET_BASE_URL}/health`);
      if (res.ok) return true;
    } catch {}
    await wait(500);
  }
  return false;
}

async function runArtillery() {
  return new Promise((resolve, reject) => {
    const args = [];
    if (ARTILLERY_BIN === 'npx') {
      args.push('artillery');
    }
    args.push('run', '--overrides', JSON.stringify({ config: { phases: phaseFor(PROFILE) } }), 'load/artillery.local.yml');
    const child = spawn(ARTILLERY_BIN, args, {
      cwd: BACKEND_DIR,
      env: { ...process.env, TARGET_BASE_URL },
      stdio: 'inherit'
    });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('artillery exited with code ' + code)));
  });
}

function phaseFor(profile) {
  switch (profile) {
    case 'spike':
      return [{ name: 'ramp', duration: 10, arrivalRate: 5 }, { name: 'spike', duration: 30, arrivalRate: 100 }, { name: 'recover', duration: 20, arrivalRate: 10 }];
    case 'stress':
      return [{ name: 'baseline', duration: 20, arrivalRate: 20 }, { name: 'push', duration: 60, arrivalRate: 60 }];
    case 'soak':
      return [{ name: 'soak', duration: 600, arrivalRate: 5 }];
    case 'smoke':
    default:
      return [{ name: 'smoke', duration: 30, arrivalRate: 5 }];
  }
}

async function main() {
  ensureDirs();
  const server = spawnServer();
  try {
    // dynamic import to keep Node 18 happy
    const { default: fetch } = await import('node-fetch');
    global.fetch = fetch;
    const ok = await waitForHealth(45000);
    if (!ok) throw new Error('health check failed');
    // Optional: pre-seed admin for login-only flows
    if (process.env.LOAD_EMAIL) {
      try {
        const regRes = await fetch(`${TARGET_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: process.env.LOAD_EMAIL,
            password: process.env.LOAD_PASSWORD || 'password123',
            firstName: 'Load',
            lastName: 'Admin',
            role: 'admin'
          })
        });
        // 201 is created, 400 likely means already exists; both are fine
        if (regRes.status !== 201 && regRes.status !== 400) {
          console.warn('admin pre-seed returned status', regRes.status);
        }
      } catch (e) {
        console.warn('admin pre-seed failed:', e.message);
      }
    }
    await runArtillery();
    process.exitCode = 0;
  } catch (e) {
    console.error('load run failed:', e.message);
    process.exitCode = 1;
  } finally {
    try { server.kill('SIGINT'); } catch {}
  }
}

main();


