import { sequelize } from './connection.js';
import { QrTag, QrScan, Attribution, SessionVisit, Prospect, FleetOwner, User, Campaign, Car, LeadPackage, LeadPackageAssignment, WebhookSubscriber, WebhookDelivery, AgentGroup } from '../models/index.js';
import ensureTenantPlumbing from './tenantMigration.js';
import { initSystemAgent } from '../services/systemAgent.js';
import { validateGoogleOAuthConfig } from '../controllers/authController.js';
import { validateEnv } from '../config/envValidation.js';
import { runMigrations } from './runMigrations.js';
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
  await safeRun('Lyfe webhook subscriber', ensureLyfeWebhookSubscriber);
  await safeRun('Retell campaigns', ensureRetellCampaigns);

  await safeRun('Migrations', runMigrations);

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
  } catch (_) { /* non-critical logging */ }
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
    await addIfMissing(userColumns, 'lyfeId', 'TEXT');

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
    await addQrCol(qrColumns, 'agentAssignmentMode', "TEXT DEFAULT 'direct'");
    await addQrCol(qrColumns, 'agentGroupId', 'TEXT');
    await addQrCol(qrColumns, 'agentGroupAgentIds', "JSON DEFAULT '[]'");
    await addQrCol(qrColumns, 'roundRobinIndex', 'INTEGER DEFAULT 0');
  } catch (e) {
    logger.warn('Could not ensure qr_tags columns on SQLite', { error: e.message });
  }

  // Campaign: defaultAssignmentMode
  try {
    const [campCols] = await sequelize.query('PRAGMA table_info(campaigns)');
    const addCampCol2 = async (cols, name, type) => {
      if (!Array.isArray(cols) || !cols.some(c => c.name === name)) {
        await sequelize.query(`ALTER TABLE campaigns ADD COLUMN ${name} ${type}`);
        logger.info(`Added ${name} column to campaigns`);
      }
    };
    await addCampCol2(campCols, 'defaultAssignmentMode', "TEXT DEFAULT 'direct'");
  } catch (e) {
    logger.warn('Could not ensure campaign defaultAssignmentMode on SQLite', { error: e.message });
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

  // Prospects: retellCallId column
  try {
    const [prospectCols] = await sequelize.query('PRAGMA table_info(prospects)');
    const hasRetellCallId = Array.isArray(prospectCols) && prospectCols.some(c => c.name === 'retellCallId');
    if (!hasRetellCallId) {
      await sequelize.query('ALTER TABLE prospects ADD COLUMN retellCallId TEXT');
      logger.info('Added retellCallId column to prospects');
    }
  } catch (e) {
    logger.warn('Could not ensure prospect retellCallId on SQLite', { error: e.message });
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
    const [lyfeIdResult] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'lyfeId'
    `);
    if (lyfeIdResult.length === 0) {
      await sequelize.query('ALTER TABLE users ADD COLUMN "lyfeId" VARCHAR(255) UNIQUE');
      logger.info('Added lyfeId column to users (Postgres)');
    }

    if (volResult.length === 0) {
      logger.info('Applying Postgres migration: Adding volume to vehicles...');
      await sequelize.query('ALTER TABLE vehicles ADD COLUMN "volume" INTEGER DEFAULT 0');
      logger.info('Added volume column to vehicles (Postgres)');
    }

    // Prospects: retellCallId column
    const [retellColResult] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'prospects' AND column_name = 'retellCallId'
    `);
    if (retellColResult.length === 0) {
      await sequelize.query('ALTER TABLE prospects ADD COLUMN "retellCallId" VARCHAR(255)');
      logger.info('Added retellCallId column to prospects (Postgres)');
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

    try {
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS prospects_retell_call_id
         ON prospects ("retellCallId")
         WHERE "retellCallId" IS NOT NULL`
      );
      logger.info('Ensured unique retellCallId index on prospects');
    } catch (e) {
      logger.warn('Could not ensure prospects retellCallId unique index', { error: e.message });
    }
  } catch (e) {
    logger.warn('Could not ensure uniq_car_qr index', { error: e.message });
  }
}

/**
 * Ensure the Lyfe webhook subscriber exists so lead.created events
 * are forwarded to the Lyfe Edge Function automatically.
 * Reads URL and secret from env vars; skips silently if not configured.
 */
async function ensureLyfeWebhookSubscriber() {
  const url = process.env.LYFE_WEBHOOK_URL;
  const secret = process.env.LYFE_WEBHOOK_SECRET;

  if (!url || !secret) {
    logger.debug('Lyfe webhook not configured (LYFE_WEBHOOK_URL / LYFE_WEBHOOK_SECRET missing), skipping.');
    return;
  }

  const SUBSCRIBER_NAME = 'Lyfe App';

  const existing = await WebhookSubscriber.findOne({ where: { name: SUBSCRIBER_NAME } });

  if (existing) {
    // Update URL/secret in case they changed
    if (existing.url !== url || existing.secret !== secret || !existing.enabled) {
      await existing.update({ url, secret, enabled: true });
      logger.info('Lyfe webhook subscriber updated', { url });
    } else {
      logger.debug('Lyfe webhook subscriber already registered', { url });
    }
    return;
  }

  await WebhookSubscriber.create({
    name: SUBSCRIBER_NAME,
    url,
    secret,
    events: ['lead.created'],
    enabled: true,
    description: 'Forward leads to Lyfe mobile app via Supabase Edge Function'
  });

  logger.info('Lyfe webhook subscriber registered', { url });
}

/**
 * Auto-create campaigns for Retell AI agents.
 * Reads RETELL_AGENTS env var (JSON array) to know which agents to create campaigns for.
 * Format: RETELL_AGENTS=[{"agentId":"agent_xxx","name":"Luggage - CPF CareShield Life"}]
 * Falls back to a default if not set.
 */
async function ensureRetellCampaigns() {
  let retellAgents;
  try {
    retellAgents = JSON.parse(process.env.RETELL_AGENTS || '[]');
  } catch {
    retellAgents = [];
  }

  // Default: Luggage Redemption agent (always ensure this exists)
  if (retellAgents.length === 0) {
    retellAgents = [{
      agentId: 'agent_58b8bbdfb8920ce49bb2750b86',
      name: 'Luggage - CPF CareShield Life'
    }];
  }

  const { initSystemAgent } = await import('../services/systemAgent.js');
  const systemAgentId = await initSystemAgent();

  for (const agent of retellAgents) {
    const campaignName = `[Retell] ${agent.name}`;

    const existing = await Campaign.findOne({ where: { name: campaignName } });

    if (existing) {
      // Ensure it stays active
      if (!existing.is_active) {
        await existing.update({ is_active: true });
        logger.info('Retell campaign reactivated', { name: campaignName });
      } else {
        logger.debug('Retell campaign already exists', { name: campaignName });
      }
      continue;
    }

    await Campaign.create({
      name: campaignName,
      type: 'lead_generation',
      status: 'active',
      is_active: true,
      description: `Auto-created campaign for Retell AI agent: ${agent.name}. Leads from successful phone calls are captured here automatically.`,
      createdBy: systemAgentId,
      min_age: 30,
      max_age: 65
    });

    logger.info('Retell campaign created', { name: campaignName, retellAgentId: agent.agentId });
  }
}
