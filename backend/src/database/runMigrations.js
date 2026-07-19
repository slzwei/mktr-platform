import { Sequelize } from 'sequelize';
import { sequelize } from './connection.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Lightweight migration runner.
 * Tracks applied migrations in a `_migrations` table.
 * Each migration module must export { up(queryInterface, Sequelize) }.
 *
 * The second arg passed to each migration combines:
 *   - Sequelize class statics: DataTypes, fn(), literal(), col(), where(), cast()
 *   - sequelize instance methods: getDialect(), query(), …
 * This keeps both old-style (instance) and new-style (class) migrations happy.
 */
export async function runMigrations() {
  // Serialize concurrent runners — rolling deploys briefly run old+new
  // instances together, and this runner has no other coordination. The
  // advisory lock is session-scoped and auto-released at COMMIT; the wrapping
  // transaction does nothing else, so each migration still executes its own
  // statements on other pool connections exactly as before. A second runner
  // blocks on the lock, then re-reads _migrations and skips everything the
  // first one applied.
  await sequelize.transaction(async (lockTx) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(870778001)', { transaction: lockTx });
    await runPendingMigrations();
  });
}

async function runPendingMigrations() {
  const qi = sequelize.getQueryInterface();

  // Build a merged context so migrations can use both
  // Sequelize.DataTypes.UUID and sequelize.getDialect() / sequelize.query().
  // Prefers Sequelize class statics (DataTypes, fn, literal); falls back to instance.
  const SeqContext = new Proxy(Sequelize, {
    get(target, prop, receiver) {
      if (prop in target) return target[prop];
      const val = sequelize[prop];
      return typeof val === 'function' ? val.bind(sequelize) : val;
    }
  });

  // Ensure tracking table exists
  await qi.createTable('_migrations', {
    name: { type: 'VARCHAR(255)', primaryKey: true },
    appliedAt: { type: 'DATE', defaultValue: sequelize.literal('CURRENT_TIMESTAMP') }
  }).catch(() => {
    // Table already exists — fine
  });

  // Get already-applied migrations
  const [applied] = await sequelize.query('SELECT name FROM "_migrations" ORDER BY name');
  const appliedSet = new Set(applied.map(r => r.name));

  // Discover JS migration files (sorted by name)
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    logger.info(`Running migration: ${file}`);
    try {
      const mod = await import(path.join(MIGRATIONS_DIR, file));
      await mod.up(qi, SeqContext);
      await sequelize.query(
        'INSERT INTO "_migrations" (name) VALUES (?)',
        { replacements: [file] }
      );
      logger.info(`Migration applied: ${file}`);
    } catch (err) {
      logger.error(`Migration failed: ${file}`, { error: err.message });
      throw err;
    }
  }
}
