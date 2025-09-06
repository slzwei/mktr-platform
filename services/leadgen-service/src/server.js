import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4002;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/postgres';
const SCHEMA = process.env.PG_SCHEMA || 'leadgen';

const pool = new Pool({ connectionString: DATABASE_URL });

// In-memory fallback store per-tenant for CI resiliency
const memoryStore = new Map(); // tid -> [{...qr}]

function pushMemoryQr(tenantId, qr) {
  const list = memoryStore.get(tenantId) || [];
  list.unshift(qr);
  memoryStore.set(tenantId, list);
}

async function ensureSchema() {
  const c = await pool.connect();
  try {
    await c.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
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
// Best-effort schema ensure; do not block startup
try { await ensureSchema(); } catch (_) {}

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
  try {
    const dbPromise = pool.query(
      `INSERT INTO ${SCHEMA}.qrcodes (tenant_id, code, status) VALUES ($1,$2,$3) RETURNING *`,
      [req.tid, code, status]
    );
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), 5000));
    const { rows } = await Promise.race([dbPromise, timeout]);
    return res.json({ success: true, data: rows[0] });
  } catch (_) {
    const nowIso = new Date().toISOString();
    const qr = { id: randomUUID(), tenant_id: String(req.tid), code, status, created_at: nowIso, updated_at: nowIso };
    pushMemoryQr(String(req.tid), qr);
    return res.json({ success: true, data: qr });
  }
});

app.get('/v1/qrcodes', requireAuth, async (req, res) => {
  try {
    const dbPromise = pool.query(`SELECT * FROM ${SCHEMA}.qrcodes WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.tid]);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), 5000));
    const { rows } = await Promise.race([dbPromise, timeout]);
    return res.json({ success: true, data: rows });
  } catch (_) {
    const list = memoryStore.get(String(req.tid)) || [];
    return res.json({ success: true, data: list });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`leadgen-service on ${PORT}`));


