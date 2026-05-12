import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

import * as Sentry from '@sentry/node';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { bootstrapDatabase } from './database/bootstrap.js';
import { requestId } from './middleware/requestId.js';

// Non-autodiscoverable middleware
import leadCaptureBind from './routes/leadCaptureBind.js';
import leadgenProxyShim from './middleware/leadgenProxyShim.js';
import { optionalAuth } from './middleware/auth.js';
import { logger } from './utils/logger.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';

// Route auto-loader
import { loadRoutes } from './routes/index.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const init = async (app) => {
  // Request tracing
  app.use(requestId);

  // Security middleware — disable global CORP so we can set it per-route
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    })
  );

  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        // Don't compress support SSE endpoints
        if (req.path.includes('/stream') || req.path.includes('/events')) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  // Trust proxy (for accurate req.ip behind reverse proxies)
  if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  // Always allow these origins + any from environment variables
  const defaultOrigins = [
    ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173']),
    'https://mktr.sg',
    'https://www.mktr.sg',
  ];
  const envOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) : [];

  const corsOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

  logger.debug('Configured CORS Origins', { origins: corsOrigins });

  // CORS handles preflight OPTIONS automatically via cors() middleware below.
  // No explicit OPTIONS handler needed — cors({ preflightContinue: false }) handles it.

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    })
  );

  // Rate limiting (relaxed for development, bypass for authenticated admins)
  const isProd = process.env.NODE_ENV === 'production';
  const limiter = rateLimit({
    windowMs: isProd ? parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000 : 60 * 1000, // 1 minute window in dev
    max: (req) => {
      if (isProd && req.user && req.user.role === 'admin') return 2000;
      return isProd
        ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200
        : parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000000;
    },
    skip: (req) => !isProd,
    message: 'Too many requests from this IP, please try again later.',
  });
  // Ensure we decode JWT (if present) before limiter so skip() can see admin
  if (isProd) {
    logger.info('Rate limiter enabled (production mode)');
    app.use('/api', optionalAuth, limiter);
  } else {
    logger.info('Rate limiter disabled (development mode)');
    app.use('/api', optionalAuth);
  }

  // Structured request logging via Pino
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  // Body parsing middleware
  // The verify callback captures the raw body for webhook signature verification.
  //   - /api/retell/         — Retell AI call webhooks (HMAC-signed)
  //   - /api/meta/           — Meta CAPI signed callbacks
  //   - /api/integrations/lyfe/ — Lyfe→MKTR push (notify_mktr_user_change trigger; HMAC since 2026-05-12)
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (
          req.originalUrl.startsWith('/api/retell/') ||
          req.originalUrl.startsWith('/api/meta/') ||
          req.originalUrl.startsWith('/api/integrations/lyfe/')
        ) {
          req.rawBody = buf;
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // CSRF protection: Not required — API uses Bearer token authentication exclusively.
  // Cookies (cookieParser) are used only for non-auth session attribution (sid, atk).
  // If cookie-based auth is ever added, CSRF middleware must be implemented.
  app.use(cookieParser());

  // Legacy LeadGen proxy shim → forwards to gateway leadgen domain
  // This preserves existing frontend calls during a one-week grace window.
  app.use(leadgenProxyShim());

  // Static file serving for uploads — allow cross-origin embedding for images
  app.use(
    '/uploads',
    (req, res, next) => {
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(path.join(__dirname, '../uploads'), {
      setHeaders: (res, filePath) => {
        res.set('X-Content-Type-Options', 'nosniff');
        // Force download for SVG files (prevents script execution)
        if (filePath.endsWith('.svg')) {
          res.set('Content-Disposition', 'attachment');
          res.set('Content-Type', 'image/svg+xml');
        }
      },
    })
  );

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
    });
  });

  // Per-adapter sync freshness — for uptime monitors / Sentry stale-sync alert
  app.get('/health/sync', async (req, res) => {
    try {
      const { getSyncHealthSnapshot } = await import('./services/syncHealth.js');
      res.status(200).json(await getSyncHealthSnapshot());
    } catch (err) {
      res.status(500).json({ status: 'error', message: err?.message || 'unknown' });
    }
  });

  // Swagger API docs (restricted to non-production)
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
  }

  // Bind attribution/session for SPA lead-capture page (path-less middleware, must precede routes)
  app.use(leadCaptureBind);

  // ── Auto-discovered API routes ──────────────────────────────────────
  await loadRoutes(app);

  // Domain-prefixed health endpoints (feature-flagged)
  if (String(process.env.ENABLE_DOMAIN_PREFIXES || 'false').toLowerCase() === 'true') {
    app.get('/api/adtech/health', (req, res) => res.json({ ok: true, service: 'adtech' }));
    app.get('/api/leadgen/health', (req, res) => res.json({ ok: true, service: 'leadgen' }));
    app.get('/api/fleet/health', (req, res) => res.json({ ok: true, service: 'fleet' }));
    app.get('/api/admin/health', (req, res) => res.json({ ok: true, service: 'admin' }));
  }

  // Fallback: /t/:slug → /api/qrcodes/track/:slug with noindex/no-store
  app.get('/t/:slug', (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, `/api/qrcodes/track/${encodeURIComponent(req.params.slug)}`);
  });

  // Error handling middleware
  app.use(notFound);
  Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  // Database connection and server startup
  logger.info('Validating environment configuration...');
  await bootstrapDatabase();
  logger.info('Application Logic Ready');
  logger.info('Environment configured', { env: process.env.NODE_ENV });
  logger.info('Monolith RPS config', {
    MANIFEST_RPS_PER_DEVICE: process.env.MANIFEST_RPS_PER_DEVICE || '2',
    BEACON_RPS_PER_DEVICE: process.env.BEACON_RPS_PER_DEVICE || '5',
    BEACON_IDEMP_WINDOW_MIN: process.env.BEACON_IDEMP_WINDOW_MIN || '10',
  });
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection', { error: err?.message || String(err) });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err?.message || String(err) });
});
