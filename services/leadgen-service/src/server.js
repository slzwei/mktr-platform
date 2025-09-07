import express from 'express';
import cors from 'cors';
import migrate from './db/migrate.js';
import { authenticate, requireTenant } from './middleware/authn.js';
import qrcodesRouter from './routes/qrcodes.js';
import prospectsRouter from './routes/prospects.js';
import commissionsRouter from './routes/commissions.js';
import agentsRouter from './routes/agents.js';
import scansRouter from './routes/scans.js';
import { requestLogger } from './middleware/observability.js';
import { getMetricsSnapshot } from './lib/metrics.js';

export const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger());

const PORT = process.env.PORT || 4002;

app.get('/health', (_req, res) => res.json({ ok: true, service: 'leadgen' }));

// AuthN and tenant scoping for API routes
app.use('/v1', authenticate, requireTenant);

// Domain routers
app.use('/v1/qrcodes', qrcodesRouter);
app.use('/v1/prospects', prospectsRouter);
app.use('/v1/commissions', commissionsRouter);
app.use('/v1/agents', agentsRouter);
app.use('/v1/scans', scansRouter);

// Lightweight metrics endpoint (JSON)
app.get('/metrics', (_req, res) => {
  res.json(getMetricsSnapshot());
});

// Run DB migrate on startup (best-effort)
try { await migrate(); } catch (e) { console.warn('[leadgen] migrate failed (non-fatal):', e?.message || String(e)); }

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`leadgen-service on ${PORT}`);
    console.log(`[leadgen] RPS env: LEADGEN_RPS_LIST=${process.env.LEADGEN_RPS_LIST || '10'} LEADGEN_RPS_CREATE=${process.env.LEADGEN_RPS_CREATE || '5'} SCANS_RPS=${process.env.SCANS_RPS || process.env.LEADGEN_SCANS_RPS || '60'}`);
  });
}

