import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

import { sequelize } from './database/connection.js';
import { QrTag, QrScan, Attribution, SessionVisit, Prospect, FleetOwner, User, Campaign, Car } from './models/index.js';
import './models/CampaignPreview.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import campaignRoutes from './routes/campaigns.js';
import campaignPreviewRoutes from './routes/campaignPreviews.js';
import agentRoutes from './routes/agents.js';
import fleetRoutes from './routes/fleet.js';
import prospectRoutes from './routes/prospects.js';
import qrRoutes from './routes/qrcodes.js';
import trackerRoutes from './routes/tracker.js';
import leadCaptureBind from './routes/leadCaptureBind.js';
import commissionRoutes from './routes/commissions.js';
import uploadRoutes from './routes/uploads.js';
import dashboardRoutes from './routes/dashboard.js';
import verifyRoutes from './routes/verify.js';
import analyticsRoutes from './routes/analytics.js';
import contactRoutes from './routes/contact.js';
import { validateGoogleOAuthConfig } from './controllers/authController.js';
import { optionalAuth } from './middleware/auth.js';
import { initSystemAgent } from './services/systemAgent.js';
import ensureTenantPlumbing from './database/tenantMigration.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  // Allow images and other static assets to be embedded from another origin (frontend at 5173)
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());

// Trust proxy (for accurate req.ip behind reverse proxies)
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// CORS configuration
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting (relaxed for development, bypass for authenticated admins)
const isProd = process.env.NODE_ENV === 'production';
const limiter = rateLimit({
  windowMs: isProd
    ? (parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000)
    : 60 * 1000, // 1 minute window in dev
  max: isProd
    ? (parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200)
    : (parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000000), // very high in dev
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => (!isProd) || !!(req.user && req.user.role === 'admin'),
  message: 'Too many requests from this IP, please try again later.'
});
// Ensure we decode JWT (if present) before limiter so skip() can see admin
if (isProd) {
  console.log('🛡️ Rate limiter enabled (production mode)');
  app.use('/api', optionalAuth, limiter);
} else {
  console.log('🛠️ Rate limiter disabled (development mode)');
  app.use('/api', optionalAuth);
}

// Logging
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Feature flag for legacy leadgen
const ENABLE_LEGACY_LEADGEN = String(process.env.ENABLE_LEGACY_LEADGEN ?? 'true').toLowerCase() !== 'false';

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/campaigns', campaignPreviewRoutes);
app.use('/api/previews', campaignPreviewRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/fleet', fleetRoutes);
if (ENABLE_LEGACY_LEADGEN) {
  app.use('/api/prospects', prospectRoutes);
  // Tracker routes must come BEFORE generic qrcodes routes to avoid '/session' and '/track' being captured by '/:id'
  app.use('/api/qrcodes', trackerRoutes);
  app.use('/api/qrcodes', qrRoutes);
} else {
  app.use(['/api/prospects', '/api/qrcodes', '/api/commissions'], (req, res) => {
    console.warn('LEGACY LEADGEN PATH HIT');
    res.status(410).json({ success: false, message: 'Use /api/leadgen/*' });
  });
}

// Bind attribution/session for SPA lead-capture page
app.use(leadCaptureBind);
app.use('/api/commissions', commissionRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/contact', contactRoutes);

// Domain-prefixed routes (feature-flagged)
if (String(process.env.ENABLE_DOMAIN_PREFIXES).toLowerCase() === 'true') {
  // Health endpoints per domain
  app.get('/api/adtech/health', (req, res) => res.json({ ok: true, service: 'adtech' }));
  app.get('/api/leadgen/health', (req, res) => res.json({ ok: true, service: 'leadgen' }));
  app.get('/api/fleet/health', (req, res) => res.json({ ok: true, service: 'fleet' }));
  app.get('/api/admin/health', (req, res) => res.json({ ok: true, service: 'admin' }));

  // AdTech → campaigns, analytics, previews
  app.use('/api/adtech/campaigns', campaignRoutes);
  app.use('/api/adtech/previews', campaignPreviewRoutes);
  app.use('/api/adtech/analytics', analyticsRoutes);

  // LeadGen → qrcodes, tracker, prospects, agents, commissions
  if (ENABLE_LEGACY_LEADGEN) {
    // During transition, still serve via monolith for prefixed paths
    app.use('/api/leadgen/qrcodes', trackerRoutes);
    app.use('/api/leadgen/qrcodes', qrRoutes);
    app.use('/api/leadgen/prospects', prospectRoutes);
    app.use('/api/leadgen/agents', agentRoutes);
    app.use('/api/leadgen/commissions', commissionRoutes);
  } else {
    app.use('/api/leadgen', (req, res) => {
      console.warn('LEGACY LEADGEN PATH HIT');
      res.status(410).json({ success: false, message: 'Use /api/leadgen/* (new service via gateway)' });
    });
  }

  // Fleet → fleet, cars, drivers
  app.use('/api/fleet', fleetRoutes);

  // Admin → users (admin ops), contact as a stub
  app.use('/api/admin/users', userRoutes);
  app.use('/api/admin/contact', contactRoutes);
}

// Fallback: /t/:slug → /api/qrcodes/track/:slug with noindex/no-store
app.get('/t/:slug', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, `/api/qrcodes/track/${encodeURIComponent(req.params.slug)}`);
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Database connection and server startup
async function startServer() {
  try {
    // Validate environment configuration
    console.log('🔧 Validating environment configuration...');
    validateGoogleOAuthConfig();
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    try {
      const dialect = sequelize.getDialect();
      if (dialect === 'sqlite') {
        console.log(`🗄️ DB Path: ${sequelize.options.storage}`);
      } else if (dialect === 'postgres') {
        console.log(`🗄️ DB Host: ${process.env.DB_HOST} / DB Name: ${process.env.DB_NAME}`);
      }
    } catch (_) {}

    // Targeted sync for new/changed models; avoid accidental destructive alters on sqlite
    const isSqlite = sequelize.getDialect() === 'sqlite';
    // Ensure base tables that QrTag depends on exist first
    await User.sync({ alter: !isSqlite });
    await FleetOwner.sync({ alter: !isSqlite });
    await Campaign.sync({ alter: !isSqlite });
    await Car.sync({ alter: !isSqlite });
    // Now dependent tables
    await QrTag.sync({ alter: !isSqlite });
    await QrScan.sync({ alter: !isSqlite });
    await Attribution.sync({ alter: !isSqlite });
    await SessionVisit.sync({ alter: !isSqlite });
    await Prospect.sync({ alter: !isSqlite });
    await (await import('./models/ProspectActivity.js')).default.sync({ alter: !isSqlite });

    // Ensure name fields exist and constraints are updated
    await FleetOwner.sync({ alter: !isSqlite });
    await User.sync({ alter: !isSqlite });

    // SQLite fallback: ensure new columns exist (users, campaigns)
    if (isSqlite) {
      try {
        // Ensure invitation columns on users
        const [userColumns] = await sequelize.query('PRAGMA table_info(users)');
        const hasInvitationToken = Array.isArray(userColumns) && userColumns.some(c => c.name === 'invitationToken');
        const hasInvitationExpires = Array.isArray(userColumns) && userColumns.some(c => c.name === 'invitationExpires');
        const hasDateOfBirth = Array.isArray(userColumns) && userColumns.some(c => c.name === 'dateOfBirth');
        const hasCompanyName = Array.isArray(userColumns) && userColumns.some(c => c.name === 'companyName');
        if (!hasInvitationToken) {
          await sequelize.query('ALTER TABLE users ADD COLUMN invitationToken TEXT');
          console.log('✅ Added invitationToken column to users');
        }
        if (!hasInvitationExpires) {
          await sequelize.query('ALTER TABLE users ADD COLUMN invitationExpires DATETIME');
          console.log('✅ Added invitationExpires column to users');
        }
        if (!hasDateOfBirth) {
          await sequelize.query('ALTER TABLE users ADD COLUMN dateOfBirth DATE');
          console.log('✅ Added dateOfBirth column to users');
        }
        if (!hasCompanyName) {
          await sequelize.query('ALTER TABLE users ADD COLUMN companyName TEXT');
          console.log('✅ Added companyName column to users');
        }

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
        console.warn('⚠️ Could not ensure commission columns on SQLite:', e.message);
      }
    }

    // Sync remaining models
    await sequelize.sync({ alter: false });
    console.log('✅ Database models synchronized.');

    // Ensure tenant plumbing on Postgres
    try {
      await ensureTenantPlumbing(sequelize);
      console.log('✅ Tenant plumbing ensured.');
    } catch (e) {
      console.warn('⚠️ Tenant plumbing failed (non-fatal):', e.message);
    }

    // Ensure System Agent exists and cache its ID
    try {
      const systemId = await initSystemAgent();
      console.log(`✅ System Agent ready: ${systemId}`);
    } catch (e) {
      console.error('❌ Failed to initialize System Agent:', e);
      // Do not block startup; assignments will retry on demand
    }

    // Create Postgres unique index for car QR invariant if on Postgres
    try {
      if (sequelize.getDialect() === 'postgres') {
        await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS uniq_car_qr ON qr_tags(\"carId\") WHERE type = 'car'");
        console.log('✅ Ensured uniq_car_qr index exists');
      }
    } catch (e) {
      console.warn('⚠️ Could not ensure uniq_car_qr index:', e.message);
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 API URL: http://localhost:${PORT}/api`);
      console.log(`💚 Health Check: http://localhost:${PORT}/health`);
    });

  } catch (error) {
    console.error('❌ Unable to start server:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await sequelize.close();
  process.exit(0);
});

if (process.env.JEST_WORKER_ID === undefined) {
  startServer();
}

export default app;
