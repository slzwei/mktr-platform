import express from 'express';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

// Load environment variables immediately
dotenv.config();

// Initialize Sentry before anything else
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

const PORT = process.env.PORT || 3001;
const app = express();

// 1. Immediate Health Check (Keep Render Happy)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    mode: 'shell',
    timestamp: new Date().toISOString()
  });
});

// 2. Start Listening IMMEDIATELY
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Shell] 🛡️ Server Shell running on port ${PORT}`);
  console.log(`[Shell] ⏳ Attempting to load application logic...`);

  try {
    // 3. Dynamic Import of the Real Application Logic
    const { init } = await import('./server_internal.js');

    console.log(`[Shell] 🔄 Application module loaded. Initializing...`);
    await init(app);
    console.log(`[Shell] ✅ Application initialized successfully.`);

  } catch (err) {
    console.error(`\n[Shell] 💥 CRITICAL FAILURE: Could not load application!`);
    console.error(`[Shell] The server is still listening on ${PORT} to allow log access.`);
    console.error(`[Shell] ERROR DETAILS:`);
    console.error(err);
    console.error(`\n`);
  }
});

// Graceful shutdown
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shell] ${signal} received — shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.close(() => {
    console.log('[Shell] HTTP server closed.');
  });

  // 2. Drain Sequelize pool
  try {
    const { sequelize } = await import('./models/index.js');
    await sequelize.close();
    console.log('[Shell] Database pool drained.');
  } catch (e) {
    console.error('[Shell] Error closing DB pool:', e.message);
  }

  // 3. Force exit after 15s if still hanging
  setTimeout(() => {
    console.error('[Shell] Forced exit after timeout.');
    process.exit(1);
  }, 15000).unref();

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Keep process alive
process.on('unhandledRejection', (err) => {
  console.error('[Shell] Unhandled Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[Shell] Uncaught Exception:', err);
});
