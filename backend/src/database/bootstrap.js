import { sequelize } from './connection.js';
import { QrTag, QrScan, Attribution, SessionVisit, Prospect, FleetOwner, User, Campaign, Car, LeadPackage, LeadPackageAssignment } from '../models/index.js';
import ensureTenantPlumbing from './tenantMigration.js';
import { initSystemAgent } from '../services/systemAgent.js';
import { validateGoogleOAuthConfig } from '../controllers/authController.js';
import { validateEnv } from '../config/envValidation.js';

/**
 * Connect to the database, sync models, run column migrations, and
 * ensure indexes / tenant plumbing.  Returns once everything is ready.
 */
export async function bootstrapDatabase() {
  validateEnv();
  validateGoogleOAuthConfig();

  await sequelize.authenticate();
  console.log('✅ Database connection established successfully.');

  await applySqlitePragmas();
  logDatabaseInfo();

  await syncModels();

  const isSqlite = sequelize.getDialect() === 'sqlite';
  if (isSqlite) {
    await ensureSqliteColumns();
  } else {
    await ensurePostgresColumns();
  }

  await sequelize.sync({ alter: false });
  console.log('✅ Database models synchronized.');

  await safeRun('Tenant plumbing', () => ensureTenantPlumbing(sequelize));
  await safeRun('System Agent', async () => {
    const systemId = await initSystemAgent();
    console.log(`✅ System Agent ready: ${systemId}`);
  });

  if (!isSqlite) {
    await ensurePostgresIndexes();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeRun(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(`⚠️ ${label} failed (non-fatal):`, e?.message || e);
  }
}

async function applySqlitePragmas() {
  try {
    if (sequelize.getDialect() === 'sqlite') {
      await sequelize.query('PRAGMA journal_mode=WAL');
      await sequelize.query('PRAGMA busy_timeout=5000');
      await sequelize.query('PRAGMA synchronous=NORMAL');
    }
  } catch (e) {
    console.warn('⚠️ Failed to apply SQLite PRAGMAs:', e?.message || e);
  }
}

function logDatabaseInfo() {
  try {
    const dialect = sequelize.getDialect();
    if (dialect === 'sqlite') {
      console.log(`🗄️ DB Path: ${sequelize.options.storage}`);
    } else if (dialect === 'postgres') {
      console.log(`🗄️ DB Host: ${process.env.DB_HOST} / DB Name: ${process.env.DB_NAME}`);
    }
  } catch (_) { }
}

async function syncModels() {
  // Base tables first (others depend on them)
  await User.sync({ alter: false });
  await FleetOwner.sync({ alter: false });
  await Campaign.sync({ alter: false });
  await Car.sync({ alter: false });

  // Dependent tables
  await QrTag.sync({ alter: false });
  try {
    await QrScan.sync({ alter: false });
  } catch (e) {
    console.warn('⚠️ QrScan sync failed, continuing:', e?.message || e);
  }
  await Attribution.sync({ alter: false });
  await SessionVisit.sync({ alter: false });
  await Prospect.sync({ alter: false });
  await (await import('../models/ProspectActivity.js')).default.sync({ alter: false });
  await (await import('../models/ShortLink.js')).default.sync({ alter: false });
  await (await import('../models/ShortLinkClick.js')).default.sync({ alter: false });
  await LeadPackage.sync({ alter: false });
  await LeadPackageAssignment.sync({ alter: false });
  await (await import('../models/BeaconEvent.js')).default.sync({ alter: false });
  await (await import('../models/Impression.js')).default.sync({ alter: false });
  await (await import('../models/ProvisioningSession.js')).default.sync({ alter: false });

  await FleetOwner.sync({ alter: false });
  await User.sync({ alter: false });
}

async function ensureSqliteColumns() {
  try {
    const [userColumns] = await sequelize.query('PRAGMA table_info(users)');
    const addIfMissing = async (cols, name, type) => {
      if (!Array.isArray(cols) || !cols.some(c => c.name === name)) {
        await sequelize.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
        console.log(`✅ Added ${name} column to users`);
      }
    };
    await addIfMissing(userColumns, 'invitationToken', 'TEXT');
    await addIfMissing(userColumns, 'invitationExpires', 'DATETIME');
    await addIfMissing(userColumns, 'dateOfBirth', 'DATE');
    await addIfMissing(userColumns, 'companyName', 'TEXT');

    const [columns] = await sequelize.query('PRAGMA table_info(campaigns)');
    const hasDriver = Array.isArray(columns) && columns.some(c => c.name === 'commission_amount_driver');
    const hasFleet = Array.isArray(columns) && columns.some(c => c.name === 'commission_amount_fleet');
    if (!hasDriver) {
      await sequelize.query('ALTER TABLE campaigns ADD COLUMN commission_amount_driver REAL');
      console.log('✅ Added commission_amount_driver column to campaigns');
    }
    if (!hasFleet) {
      await sequelize.query('ALTER TABLE campaigns ADD COLUMN commission_amount_fleet REAL');
      console.log('✅ Added commission_amount_fleet column to campaigns');
    }
  } catch (e) {
    console.warn('⚠️ Could not ensure user/campaign columns on SQLite:', e.message);
  }

  try {
    const [deviceColumns] = await sequelize.query('PRAGMA table_info(devices)');
    const hasCampaignId = Array.isArray(deviceColumns) && deviceColumns.some(c => c.name === 'campaignId');
    if (!hasCampaignId) {
      await sequelize.query('ALTER TABLE devices ADD COLUMN campaignId TEXT');
      console.log('✅ Added campaignId column to devices');
    }
    const hasCampaignIds = Array.isArray(deviceColumns) && deviceColumns.some(c => c.name === 'campaignIds');
    if (!hasCampaignIds) {
      await sequelize.query('ALTER TABLE devices ADD COLUMN campaignIds TEXT DEFAULT "[]"');
      console.log('✅ Added campaignIds column to devices');
      await sequelize.query(`
        UPDATE devices
        SET campaignIds = '[' || '"' || campaignId || '"' || ']'
        WHERE campaignId IS NOT NULL AND (campaignIds IS NULL OR campaignIds = '[]')
      `);
      console.log('✅ Migrated existing device assignments to multi-campaign format');
    }
  } catch (e) {
    console.warn('⚠️ Could not ensure device columns on SQLite:', e.message);
  }

  try {
    const [vehicleColumns] = await sequelize.query('PRAGMA table_info(vehicles)');
    const hasVolume = Array.isArray(vehicleColumns) && vehicleColumns.some(c => c.name === 'volume');
    if (!hasVolume) {
      await sequelize.query('ALTER TABLE vehicles ADD COLUMN volume INTEGER DEFAULT 0');
      console.log('✅ Added volume column to vehicles');
    }
  } catch (e) {
    console.warn('⚠️ Could not ensure vehicle columns on SQLite:', e.message);
  }
}

async function ensurePostgresColumns() {
  try {
    const [results] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'devices' AND column_name = 'campaignIds'
    `);

    if (results.length === 0) {
      console.log('🔄 Applying Postgres migration: Adding campaignIds...');
      await sequelize.query('ALTER TABLE devices ADD COLUMN "campaignIds" JSONB DEFAULT \'[]\'::jsonb');
      console.log('✅ Added campaignIds column to devices (Postgres)');

      await sequelize.query(`
        UPDATE devices
        SET "campaignIds" = jsonb_build_array("campaignId")
        WHERE "campaignId" IS NOT NULL
          AND ("campaignIds" IS NULL OR jsonb_array_length("campaignIds") = 0)
      `);
      console.log('✅ Migrated existing device assignments to multi-campaign format (Postgres)');
    }

    const [volResult] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vehicles' AND column_name = 'volume'
    `);
    if (volResult.length === 0) {
      console.log('🔄 Applying Postgres migration: Adding volume to vehicles...');
      await sequelize.query('ALTER TABLE vehicles ADD COLUMN "volume" INTEGER DEFAULT 0');
      console.log('✅ Added volume column to vehicles (Postgres)');
    }
  } catch (e) {
    console.warn('⚠️ Postgres migration failed:', e.message);
  }
}

async function ensurePostgresIndexes() {
  try {
    await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS uniq_car_qr ON qr_tags(\"carId\") WHERE type = 'car'");
    console.log('✅ Ensured uniq_car_qr index exists');

    try {
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS prospects_campaign_id_phone
         ON prospects ("campaignId", phone)
         WHERE phone IS NOT NULL AND phone <> ''`
      );
      console.log('✅ Ensured unique (campaignId, phone) index on prospects');
    } catch (e) {
      console.warn('⚠️ Could not ensure prospects (campaignId, phone) unique index:', e.message);
    }
  } catch (e) {
    console.warn('⚠️ Could not ensure uniq_car_qr index:', e.message);
  }
}
