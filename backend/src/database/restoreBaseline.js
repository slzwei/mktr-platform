import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sequelize } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Test-boot schema source (see baseline/README.md): drop everything, restore
 * the frozen baseline DDL, and mark every baked-in migration as applied so
 * runMigrations() replays ONLY migrations written after the baseline.
 *
 * This is what makes migrations the SOLE schema source for tests. The old
 * boot ran sequelize.sync({force:true}) from the MODELS and then replayed
 * migrations on top — two schema sources, so every migration had to be
 * hand-mirrored onto a model or the test schema silently diverged from prod
 * (the "test schema != prod schema" gotcha class: CREATE TABLE IF NOT EXISTS
 * no-ops, missing CHECKs, model-only columns that never reached prod).
 */
export async function restoreBaselineSchema() {
  const ddl = await readFile(path.join(__dirname, 'baseline', 'schema.sql'), 'utf8');
  const applied = JSON.parse(
    await readFile(path.join(__dirname, 'baseline', 'applied.json'), 'utf8')
  );

  // Drop every schema the baseline recreates (public, plus any auxiliary
  // schema a migration introduced — e.g. the Supabase-compat `auth` shim),
  // derived from the DDL itself so a future re-bake can't drift from this list.
  const extraSchemas = [...ddl.matchAll(/^CREATE SCHEMA (\w+);/gm)].map((m) => m[1]);
  for (const schema of extraSchemas) {
    await sequelize.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await sequelize.query('DROP SCHEMA public CASCADE');
  await sequelize.query('CREATE SCHEMA public');
  await sequelize.query(ddl);

  // The baseline BAKES IN these migrations' effects — recording them keeps
  // runMigrations() to the post-baseline tail. New migrations apply normally.
  for (const name of applied) {
    await sequelize.query('INSERT INTO "_migrations" (name) VALUES (?) ON CONFLICT DO NOTHING', {
      replacements: [name],
    });
  }
}
