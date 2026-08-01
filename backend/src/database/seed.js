/**
 * Local-development seeder — creates/updates a dev admin (and optionally a dev
 * agent) so a fresh checkout can log in.
 *
 * SAFETY (P3-3): this script UPSERTS roles and credentials on existing rows,
 * so pointing it at a live database would reset a real admin's password. It
 * therefore refuses to run when NODE_ENV=production or when DB_HOST is not a
 * local address — and passwords come from env vars with NO defaults.
 *
 * Usage:
 *   SEED_ADMIN_PASSWORD=... npm run seed            # admin only
 *   SEED_ADMIN_PASSWORD=... SEED_AGENT_PASSWORD=... npm run seed
 * Optional: SEED_ADMIN_EMAIL / SEED_AGENT_EMAIL override the addresses.
 */
import { sequelize } from './connection.js';
import { User } from '../models/index.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function assertLocalDev() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed.js refuses to run with NODE_ENV=production — it upserts admin credentials.');
  }
  const host = String(process.env.DB_HOST || '').trim();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `seed.js refuses to run against DB_HOST="${host}" — only local databases (localhost/127.0.0.1/::1) are allowed. ` +
      'This guard exists because the ops pattern of exporting the Render DATABASE_URL locally would otherwise let this script reset a live admin.'
    );
  }
}

const seedUsers = async () => {
  try {
    assertLocalDev();

    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new Error('SEED_ADMIN_PASSWORD is required (no default) — set it to seed the dev admin.');
    }

    console.log('🌱 Starting local database seeding...');
    await sequelize.sync({ force: false });

    const users = [
      {
        email: process.env.SEED_ADMIN_EMAIL || 'admin@local.test',
        firstName: 'Dev',
        lastName: 'Admin',
        fullName: 'Dev Admin',
        role: 'admin',
        password: adminPassword,
        isActive: true,
        emailVerified: true,
      },
    ];

    // The dev agent is only seeded when its password is explicitly provided.
    if (process.env.SEED_AGENT_PASSWORD) {
      users.push({
        email: process.env.SEED_AGENT_EMAIL || 'agent@local.test',
        firstName: 'Dev',
        lastName: 'Agent',
        fullName: 'Dev Agent',
        role: 'agent',
        password: process.env.SEED_AGENT_PASSWORD,
        isActive: true,
        emailVerified: true,
      });
    }

    for (const userData of users) {
      const existing = await User.findOne({ where: { email: userData.email } });
      if (existing) {
        await existing.update(userData);
        console.log(`✅ Updated ${userData.email} -> ${userData.role}`);
      } else {
        await User.create(userData);
        console.log(`✅ Created ${userData.email} -> ${userData.role}`);
      }
    }

    console.log('🎉 Local seeding complete.');
  } catch (error) {
    console.error('❌ Seeding aborted:', error.message);
    process.exit(1);
  }
};

// Run seeding if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedUsers().then(() => {
    process.exit(0);
  });
}

export { seedUsers };
