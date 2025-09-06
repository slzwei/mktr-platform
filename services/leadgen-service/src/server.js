import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4002;

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'leadgen-service' });
app.use(pinoHttp({ logger }));

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'leadgen' });
});

app.use((req, res) => {
  req.log.warn({ route: req.path, method: req.method }, 'Not Found');
  res.status(404).json({ success: false, message: 'Not Found' });
});

app.listen(PORT, () => {
  logger.info({ event: 'server_listen', port: PORT }, 'leadgen-service listening');
});


