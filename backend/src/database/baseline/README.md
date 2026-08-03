# Frozen test-boot baseline

`schema.sql` is the FULL database schema as of 2026-08-03 — the output of the
last sync-then-migrate boot (models + migrations 002–110), dumped schema-only
and stripped of session SETs. `applied.json` lists every migration whose
effects are baked into it.

Test boot (`restoreBaseline.js`) drops the schema, restores this DDL, marks
the baked migrations applied, and lets `runMigrations()` replay only what came
AFTER. **Migrations are the sole schema source for tests** — the schema tests
run against is prod's by construction.

What this changes about writing migrations:

- A new table now needs a `createTable` migration (the old boot let the model
  sync it into existence in tests — prod never had that luxury anyway).
- Model `indexes:`/column mirrors are no longer needed for the TEST schema.
  Models describe runtime attribute access; migrations describe the database.
- Never edit `schema.sql` by hand. Re-baking (rarely needed — e.g. squashing
  history) means: boot a scratch DB, `pg_dump --schema-only --no-owner
  --no-privileges`, strip `SET`/psql-meta lines, regenerate `applied.json`
  from the migrations directory.
