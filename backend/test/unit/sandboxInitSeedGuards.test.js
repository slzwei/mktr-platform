import { jest } from '@jest/globals';

/**
 * Gate G2 guards. The happy path is exercised against a real Postgres in the
 * runbook (docs/runbooks/mktr-sandbox.md); what belongs in CI is the set of
 * refusals, because those are what stop `sandbox:init-db` or `sandbox:seed`
 * from ever running against something that is not a disposable sandbox.
 */

const ORIGINAL_ENV = { ...process.env };

const SANDBOX_ENV = {
  NODE_ENV: 'production',
  DEPLOY_ENV: 'sandbox',
  DB_HOST: 'dpg-sandbox-a.singapore-postgres.render.com',
  DB_NAME: 'mktr_sandbox',
  DB_USER: 'sandbox',
  DB_PASSWORD: 'x',
  SYNC_AGENT_CRON: 'false',
  SENTRY_ENVIRONMENT: 'sandbox',
  DO_SPACES_BUCKET: 'mktr-sandbox-assets',
  SANDBOX_PUBLIC_HOSTS: 'sandbox.mktr.sg',
};

async function loadInit(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../../src/database/sandboxInit.js');
}

async function loadSeed(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../../src/database/sandboxSeed.js');
}

afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('sandbox:init-db refusals', () => {
  test('refuses outside a sandbox deployment', async () => {
    const mod = await loadInit({ ...SANDBOX_ENV, DEPLOY_ENV: 'production', SANDBOX_INIT_DB_ALLOWED: 'true' });
    await expect(mod.initSandboxDatabase()).rejects.toThrow(/outside DEPLOY_ENV=sandbox/);
  });

  test('refuses without the explicit initialization flag', async () => {
    const mod = await loadInit({ ...SANDBOX_ENV, SANDBOX_INIT_DB_ALLOWED: 'false' });
    await expect(mod.initSandboxDatabase()).rejects.toThrow(/SANDBOX_INIT_DB_ALLOWED=true/);
  });

  test('refuses when the sandbox is not running production security behaviour', async () => {
    const mod = await loadInit({ ...SANDBOX_ENV, NODE_ENV: 'development', SANDBOX_INIT_DB_ALLOWED: 'true' });
    await expect(mod.initSandboxDatabase()).rejects.toThrow(/NODE_ENV=production/);
  });

  test('refuses when the deployment points at a production resource', async () => {
    const mod = await loadInit({
      ...SANDBOX_ENV,
      SANDBOX_INIT_DB_ALLOWED: 'true',
      DB_HOST: 'dpg-d2s2h7nfte5s739gnl7g-a.singapore-postgres.render.com',
    });
    await expect(mod.initSandboxDatabase()).rejects.toThrow(/production resources/);
  });

  test('the baseline it applies is the frozen one, recorded by checksum', async () => {
    const mod = await loadInit({ ...SANDBOX_ENV, SANDBOX_INIT_DB_ALLOWED: 'true' });
    const { ddl, applied, checksum } = await mod.loadBaseline();
    expect(ddl).toContain('CREATE TABLE public._migrations');
    // The initializer must never drop anything — that is what makes it safe to
    // point at a persistent database.
    expect(ddl).not.toMatch(/DROP SCHEMA/i);
    expect(applied.length).toBeGreaterThan(100);
    expect(checksum).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('sandbox:seed refusals', () => {
  test('refuses outside a sandbox deployment', async () => {
    const mod = await loadSeed({ ...SANDBOX_ENV, DEPLOY_ENV: 'production', SANDBOX_SEED_ALLOWED: 'true', SANDBOX_SEED_PASSWORD: 'x' });
    await expect(mod.seedSandbox()).rejects.toThrow(/outside DEPLOY_ENV=sandbox/);
  });

  test('refuses without the explicit seed flag', async () => {
    const mod = await loadSeed({ ...SANDBOX_ENV, SANDBOX_SEED_PASSWORD: 'x' });
    await expect(mod.seedSandbox()).rejects.toThrow(/SANDBOX_SEED_ALLOWED=true/);
  });

  test('refuses without a password from the secret store', async () => {
    const mod = await loadSeed({ ...SANDBOX_ENV, SANDBOX_SEED_ALLOWED: 'true', SANDBOX_SEED_PASSWORD: '' });
    await expect(mod.seedSandbox()).rejects.toThrow(/SANDBOX_SEED_PASSWORD is required/);
  });
});

describe('seed fixtures', () => {
  test('identifiers are stable across runs, so a re-seed updates in place', async () => {
    const first = await loadSeed(SANDBOX_ENV);
    const second = await loadSeed(SANDBOX_ENV);
    expect(first.stableUuid('user:admin')).toBe(second.stableUuid('user:admin'));
    expect(first.stableUuid('user:admin')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.stableUuid('user:admin')).not.toBe(first.stableUuid('user:agent'));
  });

  test('every seeded identity is synthetic and on a hard-denied fixed-OTP number', async () => {
    const seed = await loadSeed(SANDBOX_ENV);
    const policy = await import('../../src/services/outboundPolicy.js');
    expect(seed.SEED_USERS).toHaveLength(10);
    for (const user of seed.SEED_USERS) {
      expect(user.email.endsWith('@sandbox.example.com')).toBe(true);
      expect(policy.isDeniedPhone(user.phone)).toBe(true);
    }
    // One user per authorization boundary acceptance needs.
    const boundaries = seed.SEED_USERS.map((u) => u.redeemOpsRole || u.role);
    expect(new Set(boundaries).size).toBe(boundaries.length);
  });
});
