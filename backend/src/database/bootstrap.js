import { sequelize } from './connection.js';
import { QrTag, QrScan, Attribution, SessionVisit, Prospect, FleetOwner, User, Campaign, Car, LeadPackage, LeadPackageAssignment, WebhookSubscriber, WebhookDelivery, AgentGroup } from '../models/index.js';
import ensureTenantPlumbing from './tenantMigration.js';
import { initSystemAgent } from '../services/systemAgent.js';
import { validateGoogleOAuthConfig } from '../controllers/authController.js';
import { validateEnv } from '../config/envValidation.js';
import { logger } from '../utils/logger.js';

/**
 * Connect to the database, sync models, run column migrations, and
 * ensure indexes / tenant plumbing.  Returns once everything is ready.
 */
export async function bootstrapDatabase() {
  validateEnv();
  validateGoogleOAuthConfig();

  await sequelize.authenticate();
  logger.info('Database connection established successfully.');

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
  logger.info('Database models synchronized.');

  await safeRun('Tenant plumbing', () => ensureTenantPlumbing(sequelize));
  await safeRun('System Agent', async () => {
    const systemId = await initSystemAgent();
    logger.info('System Agent ready', { systemId });
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
    logger.warn(`${label} failed (non-fatal)`, { error: e?.message || String(e) });
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
    logger.warn('Failed to apply SQLite PRAGMAs', { error: e?.message || String(e) });
  }
}

function logDatabaseInfo() {
  try {
    const dialect = sequelize.getDialect();
    if (dialect === 'sqlite') {
      logger.info('Database path', { path: sequelize.options.storage });
    } else if (dialect === 'postgres') {
      logger.info('Database connection', { host: process.env.DB_HOST, name: process.env.DB_NAME });
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
    logger.warn('QrScan sync failed, continuing', { error: e?.message || String(e) });
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

  // Webhook & agent group tables
  await WebhookSubscriber.sync({ alter: false });
  await WebhookDelivery.sync({ alter: false });
  await AgentGroup.sync({ alter: false });

  await FleetOwner.sync({ alter: false });
  await User.sync({ alter: false });
}

async function ensureSqliteColumns() {
  try {
    const [userColumns] = await sequelize.query('PRAGMA table_info(users)');
    const addIfMissing = async (cols, name, type) => {
      if (!Array.isArray(cols) || !cols.some(c => c.name === name)) {
        await sequelize.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
        logger.info(`Added ${name} column to users`);
      }
    };
    await addIfMissing(userColumns, 'invitationToken', 'TEXT');
    await addIfMissing(userColumns, 'invitationExpires', 'DATETIME');
    await addIfMissing(userColumns, 'dateOfBirth', 'DATE');
    await addIfMissing(userColumns, 'companyName', 'TEXT');

    const [columns] = await sequelize.query('PRAGMA table_info(campaigns)');
    const addCampaignCol = async (cols, name, type) => {
      if (!Array.isArray(cols) || !cols.some(c => c.name === name)) {
        await sequelize.query(`ALTER TABLE campaigns ADD COLUMN ${name} ${type}`);
        logger.info(`Added ${name} column to campaigns`);
      }
    };
    await addCampaignCol(columns, 'commission_amount_driver', 'REAL');
    await addCampaignCol(columns, 'commission_amount_fleet', 'REAL');
    await addCampaignCol(columns, 'ad_playlist', "JSON DEFAULT '[]'");
    await addCampaignCol(columns, 'agentAssignmentMode', "TEXT DEFAULT 'round_robin'");
    await addCampaignCol(columns, 'agentGroupId', 'TEXT');
    await addCampaignCol(columns, 'agentGroupAgentIds', "JSON DEFAULT '[]'");
    await addCampaignCol(columns, 'roundRobinIndex', 'INTEGER DEFAULT 0');
  } catch (e) {
    logger.warn('Could not ensure user/campaign columns on SQLite', { error: e.message });
  }

  // QR tags columns
  try {
    const [qrColumns] = await sequelize.query('PRAGMA table_info(qr_tags)');
    const addQrCol = async (cols, name, type) => {
      if (!Array.isArray(cols) || !cols.some(c => c.name === name)) {
        await sequelize.query(`ALTER TABLE qr_tags ADD COLUMN ${name} ${type}`);
        logger.info(`Added ${name} column to qr_tags`);
      }
    };
    await addQrCol(qrColumns, 'scanCount', 'INTEGER DEFAULT 0');
    await addQrCol(qrColumns, 'uniqueScanCount', 'INTEGER DEFAULT 0');
    await addQrCol(qrColumns, 'lastScanned', 'DATETIME');
    await addQrCol(qrColumns, 'analytics', "JSON DEFAULT '{}'");
    await addQrCol(qrColumns, 'assignedAgentPhone', 'TEXT');
    await addQrCol(qrColumns, 'assignedAgentEmail', 'TEXT');
    await addQrCol(qrColumns, 'assignedAgentName', 'TEXT');
  } catch (e) {
    logger.warn('Could not ensure qr_tags columns on SQLite', { error: e.message });
  }

  try {
    const [deviceColumns] = await sequelize.query('PRAGMA table_info(devices)');
    const hasCampaignId = Array.isArray(deviceColumns) && deviceColumns.some(c => c.name === 'campaignId');
    if (!hasCampaignId) {
      await sequelize.query('ALTER TABLE devices ADD COLUMN campaignId TEXT');
      logger.info('Added campaignId column to devices');
    }
    const hasCampaignIds = Array.isArray(deviceColumns) && deviceColumns.some(c => c.name === 'campaignIds');
    if (!hasCampaignIds) {
      await sequelize.query('ALTER TABLE devices ADD COLUMN campaignIds TEXT DEFAULT "[]"');
      logger.info('Added campaignIds column to devices');
      await sequelize.query(`
        UPDATE devices
        SET campaignIds = '[' || '"' || campaignId || '"' || ']'
        WHERE campaignId IS NOT NULL AND (campaignIds IS NULL OR campaignIds = '[]')
      `);
      logger.info('Migrated existing device assignments to multi-campaign format');
    }
  } catch (e) {
    logger.warn('Could not ensure device columns on SQLite', { error: e.message });
  }

  try {
    const [vehicleColumns] = await sequelize.query('PRAGMA table_info(vehicles)');
    const hasVolume = Array.isArray(vehicleColumns) && vehicleColumns.some(c => c.name === 'volume');
    if (!hasVolume) {
      await sequelize.query('ALTER TABLE vehicles ADD COLUMN volume INTEGER DEFAULT 0');
      logger.info('Added volume column to vehicles');
    }
  } catch (e) {
    logger.warn('Could not ensure vehicle columns on SQLite', { error: e.message });
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
      logger.info('Applying Postgres migration: Adding campaignIds...');
      await sequelize.query('ALTER TABLE devices ADD COLUMN "campaignIds" JSONB DEFAULT \'[]\'::jsonb');
      logger.info('Added campaignIds column to devices (Postgres)');

      await sequelize.query(`
        UPDATE devices
        SET "campaignIds" = jsonb_build_array("campaignId")
        WHERE "campaignId" IS NOT NULL
          AND ("campaignIds" IS NULL OR jsonb_array_length("campaignIds") = 0)
      `);
      logger.info('Migrated existing device assignments to multi-campaign format (Postgres)');
    }

    const [volResult] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vehicles' AND column_name = 'volume'
    `);
    if (volResult.length === 0) {
      logger.info('Applying Postgres migration: Adding volume to vehicles...');
      await sequelize.query('ALTER TABLE vehicles ADD COLUMN "volume" INTEGER DEFAULT 0');
      logger.info('Added volume column to vehicles (Postgres)');
    }
  } catch (e) {
    logger.warn('Postgres migration failed', { error: e.message });
  }
}

async function ensurePostgresIndexes() {
  try {
    await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS uniq_car_qr ON qr_tags(\"carId\") WHERE type = 'car'");
    logger.info('Ensured uniq_car_qr index exists');

    try {
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS prospects_campaign_id_phone
         ON prospects ("campaignId", phone)
         WHERE phone IS NOT NULL AND phone <> ''`
      );
      logger.info('Ensured unique (campaignId, phone) index on prospects');
    } catch (e) {
      logger.warn('Could not ensure prospects (campaignId, phone) unique index', { error: e.message });
    }
  } catch (e) {
    logger.warn('Could not ensure uniq_car_qr index', { error: e.message });
  }
}
