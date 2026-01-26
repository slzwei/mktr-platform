import express from 'express';
import dotenv from 'dotenv';

// Load environment variables immediately
dotenv.config();

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

// Keep process alive
process.on('unhandledRejection', (err) => {
  console.error('[Shell] Unhandled Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[Shell] Uncaught Exception:', err);
});
