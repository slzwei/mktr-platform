import { readFile } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sequelize } from './connection.js';
import { runMigrations } from './runMigrations.js';
import { validateDeployment } from '../config/sandboxValidation.js';
import { isSandbox, flagOn } from '../utils/deployEnv.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.join(__dirname, 'baseline');
const INIT_LOCK_KEY = 918_273_645; // distinct from the migration lock (870778001)

/**
 * `sandbox:init-db` — bring a BLANK sandbox database up to the current schema.
 *
 * The test-boot path (restoreBaseline.js) cannot be reused: it runs
 * `DROP SCHEMA public CASCADE` first, which is correct for a disposable test
 * database and catastrophic for a persistent sandbox. This initializer never
 * drops anything.
 *
 * Guards, in order (docs/plans/mktr-production-sandbox.md §6.1):
 *   1. NODE_ENV=production, DEPLOY_ENV=sandbox, SANDBOX_INIT_DB_ALLOWED=true.
 *   2. Full deployment validation — a database pointed at production fails here.
 *   3. A transaction-scoped advisory lock, so two initializers cannot interleave.
 *   4. The database must be BLANK, or already initialized by this tool with the
 *      same baseline. A non-empty database with no initialization marker is
 *      refused outright — that is somebody else's data.
 *
 * Re-running on an already-initialized database is a no-op plus any pending
 * migrations, and exits 0.
 */

export async function loadBaseline() {
  const ddl = await readFile(path.join(BASELINE_DIR, 'schema.sql'), 'utf8');
  const applied = JSON.parse(await readFile(path.join(BASELINE_DIR, 'applied.json'), 'utf8'));
  const checksum = crypto.createHash('sha256').update(ddl).digest('hex').slice(0, 32);
  return { ddl, applied, checksum };
}

/** Names of the user tables already present in `public`, excluding our own marker. */
export async function existingTables(seq = sequelize) {
  const [rows] = await seq.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

async function readMarker(seq) {
  const [rows] = await seq.query(
    `SELECT to_regclass('public._sandbox_init') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) return null;
  const [marker] = await seq.query('SELECT * FROM "_sandbox_init" WHERE id = 1');
  return marker[0] || null;
}

function assertAllowed() {
  if (!isSandbox()) {
    throw new Error('sandbox:init-db refuses to run outside DEPLOY_ENV=sandbox.');
  }
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('sandbox:init-db requires NODE_ENV=production (the sandbox runs production security behaviour).');
  }
  if (!flagOn('SANDBOX_INIT_DB_ALLOWED')) {
    throw new Error('sandbox:init-db requires the explicit flag SANDBOX_INIT_DB_ALLOWED=true.');
  }
  // A misconfigured sandbox must never reach a production resource, not even to
  // count its tables.
  validateDeployment();
}

export async function initSandboxDatabase({ seq = sequelize, log = console } = {}) {
  assertAllowed();
  await seq.authenticate();

  const { ddl, applied, checksum } = await loadBaseline();

  const outcome = await seq.transaction(async (tx) => {
    await seq.query(`SET LOCAL lock_timeout = '60s'`, { transaction: tx });
    await seq.query('SELECT pg_advisory_xact_lock(:key)', {
      replacements: { key: INIT_LOCK_KEY },
      transaction: tx,
    });

    const tables = (await existingTables(seq)).filter((t) => t !== '_sandbox_init');
    const marker = await readMarker(seq);

    if (tables.length === 0 && !marker) {
      log.log?.('[sandbox:init-db] blank database — applying the frozen baseline schema');
      await seq.query(ddl);
      await seq.query(
        `CREATE TABLE IF NOT EXISTS "_sandbox_init" (
           id integer PRIMARY KEY,
           baseline_checksum text NOT NULL,
           initialized_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      await seq.query(
        'INSERT INTO "_sandbox_init" (id, baseline_checksum) VALUES (1, :checksum) ON CONFLICT (id) DO NOTHING',
        { replacements: { checksum } },
      );
      for (const name of applied) {
        await seq.query('INSERT INTO "_migrations" (name) VALUES (:name) ON CONFLICT DO NOTHING', {
          replacements: { name },
        });
      }
      return { action: 'initialized', tables: 0 };
    }

    if (!marker) {
      throw new Error(
        `sandbox:init-db refuses to touch a non-empty database with no initialization marker ` +
        `(${tables.length} table(s) present, e.g. ${tables.slice(0, 5).join(', ')}). ` +
        'This tool only initializes databases it created. Provision a fresh sandbox database instead.',
      );
    }

    if (marker.baseline_checksum !== checksum) {
      throw new Error(
        'sandbox:init-db refuses to continue: this database was initialized from a DIFFERENT baseline ' +
        `(recorded ${String(marker.baseline_checksum).slice(0, 12)}…, current ${checksum.slice(0, 12)}…). ` +
        'Rebuild from a fresh database rather than mixing baselines.',
      );
    }

    log.log?.(`[sandbox:init-db] already initialized on ${new Date(marker.initialized_at).toISOString()} — schema untouched`);
    return { action: 'already_initialized', tables: tables.length };
  });

  // Migrations run OUTSIDE the init lock: runMigrations takes its own advisory
  // lock, and holding both would deadlock a second initializer.
  await runMigrations();
  log.log?.('[sandbox:init-db] migrations up to date');

  const finalTables = await existingTables(seq);
  log.log?.(`[sandbox:init-db] done — ${outcome.action}, ${finalTables.length} table(s)`);
  return { ...outcome, tableCount: finalTables.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initSandboxDatabase()
    .then(async () => {
      await sequelize.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`[sandbox:init-db] ABORTED: ${err.message}`);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}

export default { initSandboxDatabase, loadBaseline, existingTables };
