/**
 * 063 — Admin-curated Singapore territories for Discover search filters.
 *
 * Territory names remain soft controls: DiscoveryRun.area is still a plain
 * string and no partner/pool ownership or assignment is introduced. Guarded
 * and idempotent like 052–062; safe when NODE_ENV=test sync() created the table
 * before migrations run.
 */
export async function up(queryInterface, Sequelize) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('discovery_territories')) {
    await queryInterface.createTable('discovery_territories', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
      name: { type: Sequelize.STRING(64), allowNull: false },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_territories_name_ci
             ON discovery_territories (LOWER(name))`);

  // Supply UUID/timestamps explicitly: sync()-created test tables enforce the
  // same NOT NULL columns but do not carry migration-side DB defaults.
  await q(`INSERT INTO discovery_territories (id, name, "isActive", "createdAt", "updatedAt")
           SELECT gen_random_uuid(), seed.name, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             FROM (VALUES
                    ('Ang Mo Kio'),
                    ('Bedok'),
                    ('Bishan'),
                    ('Bukit Batok'),
                    ('Bukit Merah'),
                    ('Bukit Panjang'),
                    ('Bukit Timah'),
                    ('Chinatown'),
                    ('Choa Chu Kang'),
                    ('Clementi'),
                    ('Geylang'),
                    ('Hougang'),
                    ('Jurong East'),
                    ('Jurong West'),
                    ('Kallang'),
                    ('Katong'),
                    ('Marine Parade'),
                    ('Novena'),
                    ('Orchard'),
                    ('Pasir Ris'),
                    ('Punggol'),
                    ('Queenstown'),
                    ('Raffles Place'),
                    ('Sembawang'),
                    ('Sengkang'),
                    ('Serangoon'),
                    ('Tampines'),
                    ('Tiong Bahru'),
                    ('Toa Payoh'),
                    ('Woodlands'),
                    ('Yishun')
                  ) AS seed(name)
           ON CONFLICT DO NOTHING`);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS discovery_territories');
}
