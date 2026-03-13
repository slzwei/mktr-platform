#!/usr/bin/env node
/**
 * CLI entrypoint: node src/database/migrate.js
 * Runs all pending migrations and exits.
 */
import { sequelize } from './connection.js';
import { runMigrations } from './runMigrations.js';

try {
  await sequelize.authenticate();
  await runMigrations();
  console.log('All migrations applied.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
