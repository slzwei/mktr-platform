/**
 * Replaces the runtime ensureTenantPlumbing() from tenantMigration.js.
 * Creates auth schema, tenants table, default tenant, and adds tenant_id
 * columns to all relevant tables.
 * All operations are idempotent — safe to re-run.
 */
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

const TENANT_TABLES = [
  'campaigns',
  'qr_tags',
  'prospects',
  'commissions',
  'cars',
  'drivers',
  'fleet_owners',
];

export async function up(queryInterface, sequelize) {
  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') return; // tenant plumbing is Postgres-only

  // 1. Create auth schema
  await queryInterface.sequelize.query(`
    CREATE SCHEMA IF NOT EXISTS auth
  `).catch(() => {});

  // 2. Create tenants table in auth schema
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS auth.tenants (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Default Tenant',
      slug TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  // 3. Insert default tenant
  await queryInterface.sequelize.query(`
    INSERT INTO auth.tenants (id, name, slug, status)
    VALUES ('${DEFAULT_TENANT_ID}', 'Default Tenant', 'default', 'active')
    ON CONFLICT (id) DO NOTHING
  `).catch(() => {});

  // 4. Add tenant_id column to each table, backfill, set default + NOT NULL, add index
  for (const table of TENANT_TABLES) {
    // Add column (nullable first so we can backfill)
    await queryInterface.sequelize.query(`
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id UUID
    `).catch(() => {});

    // Backfill existing rows with the default tenant
    await queryInterface.sequelize.query(`
      UPDATE ${table} SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL
    `).catch(() => {});

    // Set column default
    await queryInterface.sequelize.query(`
      ALTER TABLE ${table} ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'
    `).catch(() => {});

    // Set NOT NULL constraint
    await queryInterface.sequelize.query(`
      ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL
    `).catch(() => {});

    // Add index for tenant filtering
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_${table.replace('.', '_')}_tenant ON ${table}(tenant_id)
    `).catch(() => {});
  }
}

export async function down(queryInterface) {
  // Drop tenant_id columns and indexes (reverse order)
  for (const table of TENANT_TABLES.slice().reverse()) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_${table.replace('.', '_')}_tenant
    `).catch(() => {});

    await queryInterface.removeColumn(table, 'tenant_id').catch(() => {});
  }

  // Drop tenants table and auth schema
  await queryInterface.sequelize.query(`
    DROP TABLE IF EXISTS auth.tenants
  `).catch(() => {});

  await queryInterface.sequelize.query(`
    DROP SCHEMA IF EXISTS auth
  `).catch(() => {});
}
