/**
 * P2-10 regression: the login lockout is durable and client-scoped.
 *
 * It used to be `const loginAttempts = new Map()`:
 *   - PER-PROCESS, so every Render deploy reset it and the 5-attempt limit was
 *     trivially cleared by waiting for the next deploy;
 *   - keyed on the attacker-suppliable EMAIL alone, so five bad passwords
 *     locked a known victim out of their own account from anywhere;
 *   - never evicted, so a few million distinct probe emails grew it without
 *     bound.
 *
 * It now rides the same durable Postgres counter as the rate limiters, keyed on
 * (email × client), with the window's TTL doing the eviction.
 */
import { login } from '../src/services/authService.js';
import { peek, reset, bump, blindIdentifier } from '../src/services/rateCounter.js';
import { sequelize } from '../src/models/index.js';
import { getApp, closeDb, createTestUser } from './helpers.js';

const CLIENT_A = '203.0.113.7';
const CLIENT_B = '198.51.100.4';
const PASSWORD = 'TestPassword123!';

let user;

const keyFor = (email, client) =>
  `auth:login:${blindIdentifier(String(email).toLowerCase())}:${blindIdentifier(client)}`;

const failFrom = (email, client) =>
  login(email, 'wrong-password', { clientKey: client }).catch((e) => e);

beforeAll(async () => {
  await getApp();
  ({ user } = await createTestUser({ role: 'agent', password: PASSWORD }));
});

afterEach(async () => {
  await reset(keyFor(user.email, CLIENT_A));
  await reset(keyFor(user.email, CLIENT_B));
});

afterAll(async () => { await closeDb(); });

describe('lockout is durable, not per-process', () => {
  it('locks after 5 failures from one client', async () => {
    for (let i = 0; i < 5; i += 1) {
      const err = await failFrom(user.email, CLIENT_A);
      expect(err.statusCode).toBe(401);
    }

    const locked = await failFrom(user.email, CLIENT_A);
    expect(locked.statusCode).toBe(429);
    expect(locked.message).toMatch(/Too many login attempts/i);
  });

  it('survives a process restart — the strikes live in Postgres, not in a Map', async () => {
    // What a PREVIOUS process left behind. A module-local Map could not see
    // this; the durable counter does.
    const key = keyFor(user.email, CLIENT_A);
    for (let i = 0; i < 5; i += 1) await bump(key, new Date(Date.now() + 15 * 60_000));

    // This process has recorded nothing itself, yet the lock holds.
    const locked = await failFrom(user.email, CLIENT_A);
    expect(locked.statusCode).toBe(429);
  });

  it('even a CORRECT password is refused while the client is locked', async () => {
    for (let i = 0; i < 5; i += 1) await failFrom(user.email, CLIENT_A);

    const err = await login(user.email, PASSWORD, { clientKey: CLIENT_A }).catch((e) => e);
    expect(err.statusCode).toBe(429);
  });
});

describe('lockout cannot be used to lock a victim out', () => {
  it('a different client is NOT locked by the attacker’s strikes', async () => {
    for (let i = 0; i < 6; i += 1) await failFrom(user.email, CLIENT_A);
    expect((await failFrom(user.email, CLIENT_A)).statusCode).toBe(429);

    // The real owner, on their own connection, still gets in.
    const result = await login(user.email, PASSWORD, { clientKey: CLIENT_B });
    expect(result.token).toBeTruthy();
    expect(result.user.id).toBe(user.id);
  });

  it('keys on the email too — one client attacking two accounts locks each separately', async () => {
    const other = await createTestUser({ role: 'agent', password: PASSWORD });
    for (let i = 0; i < 6; i += 1) await failFrom(user.email, CLIENT_A);

    // Same client, different account: its own budget.
    const err = await failFrom(other.user.email, CLIENT_A);
    expect(err.statusCode).toBe(401);
    await reset(keyFor(other.user.email, CLIENT_A));
  });
});

describe('entries expire and clear', () => {
  it('a successful login clears that client’s strikes', async () => {
    for (let i = 0; i < 3; i += 1) await failFrom(user.email, CLIENT_A);
    expect((await peek(keyFor(user.email, CLIENT_A))).count).toBe(3);

    await login(user.email, PASSWORD, { clientKey: CLIENT_A });

    expect((await peek(keyFor(user.email, CLIENT_A))).count).toBe(0);
  });

  it('an expired window frees the client — no unbounded growth, no permanent lock', async () => {
    const key = keyFor(user.email, CLIENT_A);
    for (let i = 0; i < 5; i += 1) await failFrom(user.email, CLIENT_A);
    expect((await failFrom(user.email, CLIENT_A)).statusCode).toBe(429);

    // Age the window past its TTL — what 15 minutes of wall clock would do.
    await sequelize.query(
      `UPDATE rate_counters SET "expiresAt" = now() - interval '1 minute' WHERE key = :key`,
      { replacements: { key } }
    );

    expect((await peek(key)).count).toBe(0);
    const afterExpiry = await failFrom(user.email, CLIENT_A);
    expect(afterExpiry.statusCode).toBe(401); // ordinary refusal, not a lock
  });

  it('stores no readable email — rate_counters stays PII-free', async () => {
    await failFrom(user.email, CLIENT_A);

    const [rows] = await sequelize.query(
      `SELECT key FROM rate_counters WHERE key LIKE 'auth:login:%'`
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key).not.toContain(user.email);
      expect(row.key).not.toContain(CLIENT_A);
    }
  });
});
