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
 */
export async function runMigrations() {
  const qi = sequelize.getQueryInterface();

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
      await mod.up(qi, sequelize);
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
