import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4002;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/postgres';
const SCHEMA = process.env.PG_SCHEMA || 'leadgen';

const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureSchema() {
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.qrcodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      code text NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  } finally { c.release(); }
}
await ensureSchema();

function requireAuth(req, res, next) {
  const tid = req.headers['x-tenant-id'];
  if (!tid) return res.status(401).json({ error: 'missing tenant' });
  req.tid = tid;
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'leadgen' }));

app.post('/v1/qrcodes', requireAuth, async (req, res) => {
  const { code, status } = req.body || {};
  if (!code || !status) return res.status(400).json({ success: false, message: 'code/status required' });
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.qrcodes (tenant_id, code, status) VALUES ($1,$2,$3) RETURNING *`,
    [req.tid, code, status]
  );
  res.json({ success: true, data: rows[0] });
});

app.get('/v1/qrcodes', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${SCHEMA}.qrcodes WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.tid]);
  res.json({ success: true, data: rows });
});

app.listen(PORT, '0.0.0.0', () => console.log(`leadgen-service on ${PORT}`));

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


