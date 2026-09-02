import { jest } from '@jest/globals';

/**
 * Deployment identity + fail-closed startup validation (plan §4, Gate G1).
 * Every case here is a boot that must be REFUSED.
 */

const ORIGINAL_ENV = { ...process.env };

async function load(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return {
    deploy: await import('../../src/utils/deployEnv.js'),
    validation: await import('../../src/config/sandboxValidation.js'),
    hosts: await import('../../src/utils/publicHost.js'),
    cookies: await import('../../src/utils/attributionCookies.js'),
  };
}

/** A sandbox configuration that is expected to PASS, so each test can break exactly one thing. */
const GOOD_SANDBOX = {
  NODE_ENV: 'production',
  DEPLOY_ENV: 'sandbox',
  DB_HOST: 'dpg-sandbox-instance-a.singapore-postgres.render.com',
  DB_NAME: 'mktr_sandbox',
  DB_USER: 'sandbox',
  DB_PASSWORD: 'x',
  SYNC_AGENT_CRON: 'false',
  SENTRY_ENVIRONMENT: 'sandbox',
  SANDBOX_PUBLIC_HOSTS: 'sandbox.mktr.sg',
  DO_SPACES_BUCKET: 'mktr-sandbox-assets',
  // Every production credential absent by construction.
  DNC_ORG_CODE: '', DNC_ESERVICE_ID: '', DNC_PRIVATE_KEY: '', DNC_BASE_URL: '',
  LYFE_SUPABASE_URL: '', LYFE_SUPABASE_SERVICE_ROLE_KEY: '',
  MKTR_LEADS_SUPABASE_URL: '', MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY: '',
  META_ACCESS_TOKEN: '', RETELL_API_KEY: '', HITPAY_API_KEY: '',
  OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_DM_REFRESH_TOKEN: '',
  LYFE_WEBHOOK_URL: '', MKTR_LEADS_WEBHOOK_URL: '', WEBHOOK_ENABLED: 'false',
  DNC_API_ENABLED: 'false',
  META_CAPI_ENABLED: 'false', TIKTOK_EVENTS_API_ENABLED: 'false',
  REDEEMED_AUDIENCE_SYNC_ENABLED: 'false', RETELL_SCREENING_ENABLED: 'false',
  META_LEAD_ADS_ENABLED: 'false', BILLING_ENABLED: 'false', DISCOVERY_ENABLED: 'false',
};

afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('deployEnv', () => {
  test('an unknown DEPLOY_ENV throws rather than defaulting to production', async () => {
    const { deploy } = await load({ DEPLOY_ENV: 'sandboxx' });
    expect(() => deploy.deployEnv()).toThrow(/not one of/);
  });

  test('isSandbox is true only for the exact string', async () => {
    expect((await load({ DEPLOY_ENV: 'sandbox' })).deploy.isSandbox()).toBe(true);
    expect((await load({ DEPLOY_ENV: 'production' })).deploy.isSandbox()).toBe(false);
    expect((await load({ NODE_ENV: 'production', DEPLOY_ENV: '' })).deploy.isSandbox()).toBe(false);
  });

  test('an absent DEPLOY_ENV falls back to NODE_ENV, never to sandbox', async () => {
    expect((await load({ NODE_ENV: 'production', DEPLOY_ENV: '' })).deploy.deployEnv()).toBe('production');
  });
});

describe('validateDeployment — a clean sandbox boots', () => {
  test('the reference configuration passes', async () => {
    const { validation } = await load(GOOD_SANDBOX);
    expect(() => validation.validateDeployment()).not.toThrow();
  });
});

describe('validateDeployment — refusals', () => {
  const refuses = async (override, pattern) => {
    const { validation } = await load({ ...GOOD_SANDBOX, ...override });
    expect(() => validation.validateDeployment()).toThrow(pattern);
  };

  test('a sandbox not running production security behaviour', () =>
    refuses({ NODE_ENV: 'development' }, /NODE_ENV=production/));

  test('a database pointed at the production instance', () =>
    refuses({ DB_HOST: 'dpg-d2s2h7nfte5s739gnl7g-a.singapore-postgres.render.com' }, /production resources/));

  test('the production Lyfe Supabase project anywhere in the environment', () =>
    refuses({ SOME_COPIED_VAR: 'https://nvtedkyjwulkzjeoqjgx.supabase.co' }, /production resources/));

  test('the production Meta pixel copied into the environment', () =>
    refuses({ META_PIXEL_ID: '1402034528611431' }, /production resources/));

  // A client id carries the PROJECT number, not the client's identity, so a
  // sandbox-only client legitimately shares production's prefix. The guard must
  // accept it; only an exact operator-pinned id is refused.
  test('a separate Google client in the same project is accepted', async () => {
    const { validation } = await load({
      ...GOOD_SANDBOX,
      GOOGLE_CLIENT_ID: '917664265015-sandboxclient.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    expect(() => validation.validateDeployment()).not.toThrow();
  });

  test("production's exact client id is refused once pinned", () =>
    refuses(
      {
        GOOGLE_CLIENT_ID: '917664265015-productionclient.apps.googleusercontent.com',
        SANDBOX_FORBIDDEN_MARKERS: '917664265015-productionclient',
      },
      /production resources/,
    ));

  test('the PDPC production endpoint configured directly', () =>
    refuses({ DNC_BASE_URL: 'https://www.dnc.gov.sg/realtime' }, /production/));

  test('a DNC credential present in the application', () =>
    refuses({ DNC_ORG_CODE: 'ORGL000000018702' }, /production-only credentials/));

  test('a Retell key present', () => refuses({ RETELL_API_KEY: 'key_live' }, /production-only credentials/));

  test('agent sync left at its default (production Lyfe)', () =>
    refuses({ SYNC_AGENT_CRON: 'true' }, /SYNC_AGENT_CRON/));

  test('a background writer armed', () =>
    refuses({ META_CAPI_ENABLED: 'true' }, /background integrations/));

  test('the live OTP rail armed with no allowlist', () =>
    refuses({ SANDBOX_LIVE_OTP_ENABLED: 'true', SANDBOX_ALLOWED_PHONES: '' }, /SANDBOX_ALLOWED_PHONES/));

  test('DNC enabled without the sandbox rail switch', () =>
    refuses({ DNC_API_ENABLED: 'true', SANDBOX_ALLOWED_PHONES: '+6596989089' }, /SANDBOX_LIVE_DNC_ENABLED/));

  test('DNC enabled without the shared gateway', () =>
    refuses(
      { DNC_API_ENABLED: 'true', SANDBOX_LIVE_DNC_ENABLED: 'true', SANDBOX_ALLOWED_PHONES: '+6596989089' },
      /DNC_GATEWAY_URL/,
    ));

  test('webhooks enabled with no local sink', () =>
    refuses({ WEBHOOK_ENABLED: 'true' }, /SANDBOX_WEBHOOK_SINK_URL/));

  test('a webhook destination that is not the sink', () =>
    refuses(
      { LYFE_WEBHOOK_URL: 'https://example.supabase.co/functions/v1/receive-mktr-lead', SANDBOX_WEBHOOK_SINK_URL: 'https://sandbox.mktr.sg/api/sandbox/webhook-sink' },
      /never deliver to a production receiver/,
    ));

  test('Sentry claiming to be production', () =>
    refuses({ SENTRY_ENVIRONMENT: 'production' }, /SENTRY_ENVIRONMENT/));

  test('a production deployment carrying sandbox switches', async () => {
    const { validation } = await load({ NODE_ENV: 'production', DEPLOY_ENV: 'production', SANDBOX_LIVE_DNC_ENABLED: 'true' });
    expect(() => validation.validateDeployment()).toThrow(/sandbox switches are armed/);
  });

  test('a plain-http gateway on a remote host is refused', () =>
    refuses(
      {
        DNC_API_ENABLED: 'true',
        SANDBOX_LIVE_DNC_ENABLED: 'true',
        SANDBOX_ALLOWED_PHONES: '+6596989089',
        DNC_GATEWAY_URL: 'http://gateway.example.com',
        DNC_GATEWAY_TOKEN: 'token',
      },
      /DNC_GATEWAY_URL/,
    ));

  test('the fully armed DNC rail passes once the gateway is configured', async () => {
    const { validation } = await load({
      ...GOOD_SANDBOX,
      DNC_API_ENABLED: 'true',
      SANDBOX_LIVE_DNC_ENABLED: 'true',
      SANDBOX_ALLOWED_PHONES: '+6596989089',
      DNC_GATEWAY_URL: 'https://mktr-dnc-gateway.onrender.com',
      DNC_GATEWAY_TOKEN: 'token',
    });
    expect(() => validation.validateDeployment()).not.toThrow();
  });
});

describe('hosts and cookies', () => {
  test('a sandbox host never widens a cookie to the parent domain', async () => {
    const { hosts } = await load({ DEPLOY_ENV: 'sandbox', SANDBOX_PUBLIC_HOSTS: 'sandbox.mktr.sg' });
    expect(hosts.isSandboxHost('sandbox.mktr.sg')).toBe(true);
    expect(hosts.cookieDomainForPublicHost('sandbox.mktr.sg')).toBeUndefined();
    // …while production keeps its existing behaviour.
    expect(hosts.cookieDomainForPublicHost('mktr.sg')).toBe('.mktr.sg');
  });

  test('production never learns a sandbox host', async () => {
    const { hosts } = await load({ DEPLOY_ENV: 'production' });
    expect(hosts.isAllowedPublicHost('sandbox.mktr.sg')).toBe(false);
    expect(hosts.isSandboxHost('sandbox.mktr.sg')).toBe(false);
  });

  test('a forged Host header for an unknown domain is ignored in both deployments', async () => {
    const req = (host) => ({ get: (h) => (h.toLowerCase() === 'host' ? host : undefined) });
    const sandbox = await load({ DEPLOY_ENV: 'sandbox', SANDBOX_PUBLIC_HOSTS: 'sandbox.mktr.sg' });
    expect(sandbox.hosts.publicHostFromRequest(req('evil.example.com'))).toBeUndefined();
    expect(sandbox.hosts.publicHostFromRequest(req('sandbox.mktr.sg'))).toBe('sandbox.mktr.sg');
    const prod = await load({ DEPLOY_ENV: 'production' });
    expect(prod.hosts.publicHostFromRequest(req('sandbox.mktr.sg'))).toBeUndefined();
    expect(prod.hosts.publicHostFromRequest(req('mktr.sg'))).toBe('mktr.sg');
  });

  test('attribution cookies are namespaced so production values cannot be mistaken for sandbox state', async () => {
    const sandbox = await load({ DEPLOY_ENV: 'sandbox' });
    expect(sandbox.cookies.sidCookieName()).toBe('sbx_sid');
    expect(sandbox.cookies.atkCookieName()).toBe('sbx_atk');
    // A production `sid` riding the parent-domain cookie is invisible to the sandbox.
    expect(sandbox.cookies.readSidCookie({ cookies: { sid: 'production-session' } })).toBeUndefined();
    expect(sandbox.cookies.readSidCookie({ cookies: { sbx_sid: 'sandbox-session' } })).toBe('sandbox-session');

    const prod = await load({ DEPLOY_ENV: 'production' });
    expect(prod.cookies.sidCookieName()).toBe('sid');
    expect(prod.cookies.readSidCookie({ cookies: { sid: 'production-session' } })).toBe('production-session');
  });
});

describe('database configuration accepts either shape', () => {
  const load = async (env) => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, ...env };
    return import('../../src/config/envValidation.js');
  };

  // Regression: connection.js accepts DATABASE_URL, validateEnv did not. A
  // sandbox wired with only a connection string initialized and seeded its
  // database and then refused to boot the API on "Missing required environment
  // variables: DB_HOST, …".
  test('a connection string alone satisfies the production check', async () => {
    const { validateEnv } = await load({
      NODE_ENV: 'production',
      DEPLOY_ENV: 'production',
      JWT_SECRET: 'x',
      DB_HOST: '', DB_NAME: '', DB_USER: '', DB_PASSWORD: '',
      DATABASE_URL: 'postgresql://user:pw@dpg-example-a/db',
    });
    expect(() => validateEnv()).not.toThrow();
  });

  test('the discrete variables alone still satisfy it', async () => {
    const { validateEnv } = await load({
      NODE_ENV: 'production',
      DEPLOY_ENV: 'production',
      JWT_SECRET: 'x',
      DB_HOST: 'db.internal', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p',
      DATABASE_URL: '',
    });
    expect(() => validateEnv()).not.toThrow();
  });

  test('neither shape present refuses to boot at all', async () => {
    // connection.js throws during MODULE EVALUATION, so the refusal happens on
    // import rather than on the call — which is why a database-less deploy never
    // mounts a single route. The shell renders the boot-status page instead.
    await expect(load({
      NODE_ENV: 'production',
      DEPLOY_ENV: 'production',
      JWT_SECRET: 'x',
      DB_HOST: '', DB_NAME: '', DB_USER: '', DB_PASSWORD: '', DATABASE_URL: '',
    })).rejects.toThrow(/DB_HOST \(or DATABASE_URL\) is required/);
  });
});

describe('Google sign-in cannot be a side door into the sandbox', () => {
  // Models are mocked so this stays a unit test: the lookups return "no such
  // user", which is exactly the state in which the real code would CREATE one.
  const loadAuth = async (env) => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      DB_HOST: '127.0.0.1', DB_NAME: 'x', DB_USER: 'x', DB_PASSWORD: 'x',
      JWT_SECRET: 'x',
      ...env,
    };
    const created = [];
    jest.unstable_mockModule('../../src/models/index.js', () => ({
      User: {
        findOne: async () => null,
        findByPk: async () => null,
        create: async (values) => { created.push(values); return { id: 'new', ...values }; },
      },
      sequelize: {},
    }));
    const auth = await import('../../src/services/authService.js');
    return { auth, created };
  };

  test('an unknown Google address is refused rather than provisioned', async () => {
    const { auth, created } = await loadAuth({ DEPLOY_ENV: 'sandbox' });
    await expect(
      auth.googleIdTokenLogin({ email: 'stranger@gmail.com', googleSub: 'sub-1', name: 'A Stranger' }),
    ).rejects.toThrow(/not provisioned in the sandbox/);
    expect(created).toHaveLength(0); // nothing was minted
  });

  test('the refusal carries 403, not a 500', async () => {
    const { auth } = await loadAuth({ DEPLOY_ENV: 'sandbox' });
    await expect(
      auth.googleIdTokenLogin({ email: 'stranger@gmail.com', googleSub: 'sub-2' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('the same switch that reopens password registration reopens this', async () => {
    const { auth, created } = await loadAuth({
      DEPLOY_ENV: 'sandbox',
      SANDBOX_SELF_REGISTRATION_ENABLED: 'true',
    });
    await auth.googleIdTokenLogin({ email: 'stranger@gmail.com', googleSub: 'sub-3' });
    expect(created).toHaveLength(1);
  });

  test('production is untouched by the guard', async () => {
    const { auth, created } = await loadAuth({ DEPLOY_ENV: 'production' });
    await auth.googleIdTokenLogin({ email: 'stranger@gmail.com', googleSub: 'sub-4' });
    expect(created).toHaveLength(1);
    expect(created[0].role).toBe('customer');
  });
});
