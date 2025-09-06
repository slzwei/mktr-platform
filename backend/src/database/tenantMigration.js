const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export async function ensureTenantPlumbing(sequelize) {
  if (sequelize.getDialect() !== 'postgres') return;
  const q = async (sql) => sequelize.query(sql);

  await q(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await q(`
    CREATE TABLE IF NOT EXISTS auth.tenants (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Default Tenant',
      slug TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await q(`INSERT INTO auth.tenants (id, name, slug, status)
           VALUES ('${DEFAULT_TENANT_ID}', 'Default Tenant', 'default', 'active')
           ON CONFLICT (id) DO NOTHING;`);

  async function addTenantTo(table) {
    await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await q(`UPDATE ${table} SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL`);
    await q(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'`);
    await q(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_${table.replace('.', '_')}_tenant ON ${table}(tenant_id)`);
  }

  await addTenantTo('campaigns');
  await addTenantTo('qr_tags');
  await addTenantTo('prospects');
  await addTenantTo('commissions');
  await addTenantTo('cars');
  await addTenantTo('drivers');
  await addTenantTo('fleet_owners');
}

export default ensureTenantPlumbing;


