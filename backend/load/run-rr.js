#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const BACKEND_DIR = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const RUN_ID = `${Date.now()}`;
const TMP_ROOT = path.join(BACKEND_DIR, '.tmp', `rr-${RUN_ID}`);
const SQLITE_PATH = path.join(TMP_ROOT, 'sqlite.db');
const UPLOADS_DIR = path.join(TMP_ROOT, 'uploads');
const PORT = process.env.SAFE_HARNESS_PORT || '3101';
const TARGET_BASE_URL = process.env.TARGET_BASE_URL || `http://localhost:${PORT}`;

function ensureDirs() { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); }

function spawnServer() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT,
    DATABASE_URL: SQLITE_PATH,
    JWT_SECRET: process.env.JWT_SECRET || 'rr-secret-' + RUN_ID,
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

async function waitForHealth(timeoutMs = 45000) {
  const { default: fetch } = await import('node-fetch');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${TARGET_BASE_URL}/health`); if (r.ok) return true; } catch {}
    await wait(500);
  }
  return false;
}

async function runRR() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['load/round_robin_check.js'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, TARGET_BASE_URL, RR_N: process.env.RR_N || '90', RR_AGENTS: process.env.RR_AGENTS || '3' },
      stdio: 'inherit'
    });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('round_robin_check exited with code ' + code)));
  });
}

async function main() {
  ensureDirs();
  const server = spawnServer();
  try {
    const ok = await waitForHealth();
    if (!ok) throw new Error('health check failed');
    await runRR();
    process.exitCode = 0;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    try { server.kill('SIGINT'); } catch {}
  }
}

main();


