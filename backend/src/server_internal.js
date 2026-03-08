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

import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { bootstrapDatabase } from './database/bootstrap.js';
import { requestId } from './middleware/requestId.js';
import './models/CampaignPreview.js';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import campaignRoutes from './routes/campaigns.js';
import deviceEventsRouter from './routes/deviceEvents.js';
import campaignPreviewRoutes from './routes/campaignPreviews.js';
import agentRoutes from './routes/agents.js';
import fleetRoutes from './routes/fleet.js';
import prospectRoutes from './routes/prospects.js';
import qrRoutes from './routes/qrcodes.js';
import trackerRoutes from './routes/tracker.js';
import leadCaptureBind from './routes/leadCaptureBind.js';
import commissionRoutes from './routes/commissions.js';
import uploadRoutes from './routes/uploads.js';
import apkRoutes from './routes/apk.js'; // Added
import dashboardRoutes from './routes/dashboard.js';
import notificationRoutes from './routes/notifications.js';
import verifyRoutes from './routes/verify.js';
import analyticsRoutes from './routes/analytics.js';
import leadgenProxyShim from './middleware/leadgenProxyShim.js';
import adtechManifestRoutes from './routes/adtechManifest.js';
import adtechBeaconRoutes from './routes/adtechBeacons.js';
import contactRoutes from './routes/contact.js';
import shortLinkRoutes from './routes/shortlinks.js';
import leadPackageRoutes from './routes/leadPackages.js';
import deviceRoutes from './routes/devices.js';
import provisioningRoutes from './routes/provisioning.js'; // Added
import vehicleRoutes from './routes/vehicles.js'; // Added for tablet pairing
import { optionalAuth } from './middleware/auth.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const init = async (app) => {
  // Request tracing
  app.use(requestId);

  // Security middleware
  app.use(helmet({
    // Allow images and other static assets to be embedded from another origin (frontend at 5173)
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      // Don't compress support SSE endpoints
      if (req.path.includes('/stream') || req.path.includes('/events')) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  // Trust proxy (for accurate req.ip behind reverse proxies)
  if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  // Always allow these origins + any from environment variables
  const defaultOrigins = ['http://localhost:5173', 'https://mktr.sg', 'https://www.mktr.sg'];
  const envOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : [];

  const corsOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

  console.log('DEBUG: Configured CORS Origins:', corsOrigins);

  // Explicit OPTIONS handler for preflight requests - must come BEFORE cors() middleware
  app.options('*', (req, res) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.set('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    }
    res.status(204).end();
  });

  app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    preflightContinue: false,
    optionsSuccessStatus: 204
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

  // Legacy LeadGen proxy shim → forwards to gateway leadgen domain
  // This preserves existing frontend calls during a one-week grace window.
  app.use(leadgenProxyShim());

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

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/campaigns', campaignPreviewRoutes);
  app.use('/api/previews', campaignPreviewRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/fleet', fleetRoutes);
  app.use('/api/prospects', prospectRoutes);
  // Tracker routes must come BEFORE generic qrcodes routes to avoid '/session' and '/track' being captured by '/:id'
  app.use('/api/qrcodes', trackerRoutes);
  app.use('/api/qrcodes', qrRoutes);

  // Bind attribution/session for SPA lead-capture page
  app.use(leadCaptureBind);
  app.use('/api/commissions', commissionRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/apk', apkRoutes); // Added
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/contact', contactRoutes);
  // short links: admin-minted, public redirects
  app.use('/api/shortlinks', shortLinkRoutes);
  app.use('/share', shortLinkRoutes);
  app.use('/api/lead-packages', leadPackageRoutes);
  app.use('/api/devices/events', deviceEventsRouter);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/provision', provisioningRoutes); // Added
  app.use('/api/vehicles', vehicleRoutes); // Added for tablet pairing


  // Phase C: Adtech Manifest + Beacons (behind flags)
  if (String(process.env.MANIFEST_ENABLED || 'false').toLowerCase() === 'true') {
    app.use('/api/adtech', adtechManifestRoutes);
  }
  if (String(process.env.BEACONS_ENABLED || 'true').toLowerCase() === 'true') {
    app.use('/api/adtech', adtechBeaconRoutes);
  }


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
    app.use('/api/leadgen/qrcodes', trackerRoutes);
    app.use('/api/leadgen/qrcodes', qrRoutes);
    app.use('/api/leadgen/prospects', prospectRoutes);
    app.use('/api/leadgen/agents', agentRoutes);
    app.use('/api/leadgen/commissions', commissionRoutes);

    // Fleet → fleet, cars, drivers
    app.use('/api/fleet', fleetRoutes);

    // Admin → users (admin ops), contact stub
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
  console.log('🔧 Validating environment configuration...');
  await bootstrapDatabase();
  console.log(`🚀 Application Logic Ready`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`[monolith] RPS env: MANIFEST_RPS_PER_DEVICE=${process.env.MANIFEST_RPS_PER_DEVICE || '2'} BEACON_RPS_PER_DEVICE=${process.env.BEACON_RPS_PER_DEVICE || '5'} BEACON_IDEMP_WINDOW_MIN=${process.env.BEACON_IDEMP_WINDOW_MIN || '10'}`);
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
