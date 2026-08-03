import pg from 'pg';
import { sequelize } from './connection.js';

/**
 * One jest process per test database, enforced.
 *
 * Test boot runs sequelize.sync({ force: true }) — it DROPS every table. When
 * a second jest process overlaps on the same database (a backgrounded run, an
 * orphaned child of a killed run, two terminals), its sync drops the tables
 * under the first run's open transactions and the two wedge on each other's
 * locks: the suite "hangs forever" or dies with transport-level noise
 * ("Parse Error: Expected HTTP/"). CI never overlaps runs, which is why the
 * flake family was local-only.
 *
 * The lock is a Postgres session advisory lock held on a DEDICATED client
 * (the pool's own connections are idle-evicted after ~10s, which would
 * silently release it). Process exit — including jest's forceExit and
 * SIGKILL — closes the connection and frees the lock.
 *
 * Same-process re-entry is detected THROUGH the database, not process memory:
 * jest's ESM mode gives every test file its own vm context, so module state,
 * globalThis, and even process properties do not reliably cross suite files.
 * The holder's connection carries application_name "mktr-test-lock:<pid>" — a
 * refused acquirer whose own pid matches the holder is a later suite of the
 * SAME run and proceeds; anything else is a rival process and fails fast.
 */
const LOCK_KEY = 'mktr_test_run';
const appName = () => `mktr-test-lock:${process.pid}`;

function clientConfig() {
  const { database, username, password, host, port } = sequelize.config;
  // sequelize.config carries port as a string; pg.Client wants a number.
  return { host, port: Number(port), database, user: username, password, application_name: appName() };
}

async function tryLock(client) {
  const { rows } = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
    [LOCK_KEY]
  );
  return rows[0]?.locked === true;
}

async function lockHolderAppName(client) {
  const { rows } = await client.query(
    `SELECT a.application_name
       FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND a.application_name LIKE 'mktr-test-lock:%'
      LIMIT 1`
  );
  return rows[0]?.application_name || null;
}

export async function acquireTestRunLock() {
  const client = new pg.Client(clientConfig());
  await client.connect();

  if (await tryLock(client)) {
    // First suite of this run: hold the client (and the lock) until the
    // process exits. jest's forceExit closes it; Postgres then frees the lock.
    return;
  }

  const holder = await lockHolderAppName(client);
  if (holder === appName()) {
    // A later suite of the SAME jest process — the run already owns the lock.
    await client.end();
    return;
  }

  // The previous holder may have exited between the try and the check.
  if (await tryLock(client)) return;

  const { database } = sequelize.config;
  await client.end();
  throw new Error(
    `Another test run (${holder || 'unknown holder'}) holds the "${LOCK_KEY}" advisory lock on database "${database}". ` +
    'Starting a second jest process would drop its tables mid-run (sync({force:true})) and wedge both. ' +
    'Wait for the other run, kill it (check `ps -eo pid,command | grep jest`), or point DB_NAME at a different database.'
  );
}
