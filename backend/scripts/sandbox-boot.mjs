#!/usr/bin/env node
/**
 * Sandbox start wrapper.
 *
 * Render has no first-class one-off job, so initialization and seeding run here
 * — but only when their own explicit flags are armed. The underlying commands
 * stay strict: invoked directly without their flag they still refuse. This
 * wrapper only decides WHETHER to invoke them, so the guards are never softened.
 *
 * It refuses to do anything at all outside DEPLOY_ENV=sandbox, so it can never
 * become a production start or release command
 * (docs/plans/mktr-production-sandbox.md §5.1).
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');

const flagOn = (name) => String(process.env[name] || '').trim().toLowerCase() === 'true';
const isSandbox = String(process.env.DEPLOY_ENV || '').trim().toLowerCase() === 'sandbox';

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SRC, script)], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  if (!isSandbox) {
    console.error('[sandbox-boot] DEPLOY_ENV is not "sandbox" — refusing to run initialization or seeding.');
    process.exit(1);
  }

  if (flagOn('SANDBOX_INIT_DB_ALLOWED')) {
    console.log('[sandbox-boot] SANDBOX_INIT_DB_ALLOWED=true — running database initialization');
    await run('database/sandboxInit.js');
  } else {
    console.log('[sandbox-boot] initialization skipped (SANDBOX_INIT_DB_ALLOWED is not true)');
  }

  if (flagOn('SANDBOX_SEED_ALLOWED')) {
    console.log('[sandbox-boot] SANDBOX_SEED_ALLOWED=true — running seed');
    await run('database/sandboxSeed.js');
  } else {
    console.log('[sandbox-boot] seed skipped (SANDBOX_SEED_ALLOWED is not true)');
  }

  console.log('[sandbox-boot] starting the API');
  const server = spawn(process.execPath, [path.join(SRC, 'server.js')], { stdio: 'inherit' });
  const forward = (signal) => server.kill(signal);
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));
  server.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(`[sandbox-boot] ABORTED: ${err.message}`);
  process.exit(1);
});
