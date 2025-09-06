import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import dotenv from 'dotenv';
import { authenticate, requireTenant } from './middleware/authn.js';
import qrcodes from './routes/qrcodes.js';
import prospects from './routes/prospects.js';
import commissions from './routes/commissions.js';
import agents from './routes/agents.js';
import scans from './routes/scans.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4002;

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'leadgen-service' });
app.use(pinoHttp({ logger }));

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'leadgen' });
});

// Authenticated API
app.use('/v1', authenticate, requireTenant);
app.use('/v1/qrcodes', qrcodes);
app.use('/v1/prospects', prospects);
app.use('/v1/commissions', commissions);
app.use('/v1/agents', agents);
app.use('/v1/scans', scans);

app.use((req, res) => {
  req.log.warn({ route: req.path, method: req.method }, 'Not Found');
  res.status(404).json({ success: false, message: 'Not Found' });
});

export { app };

if (process.env.JEST_WORKER_ID === undefined) {
  app.listen(PORT, () => {
    logger.info({ event: 'server_listen', port: PORT }, 'leadgen-service listening');
  });
}


