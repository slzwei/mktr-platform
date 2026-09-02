import express from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { ensureSchema } from './schema.js';
import * as queue from './queue.js';
import { startWorker, credentialed, gatewayConfig } from './worker.js';
import { sandboxCaps, sandboxAllowlist } from './policy.js';
import { formatDncNumber } from '../services/dncProtocol.js';
import { closePool } from './db.js';

dotenv.config();

/**
 * mktr-dnc-gateway — the ONE shared DNC queue.
 *
 * Both the production MKTR backend and the sandbox submit here; neither holds
 * the PDPC credential once this is live. See docs/plans/mktr-production-sandbox.md
 * §6.6 and docs/runbooks/dnc-gateway.md.
 *
 * Auth: `Authorization: Bearer <token>`. The SOURCE is derived from which token
 * matched — never from the request body, so a caller cannot claim to be
 * production and jump the queue.
 */

const PORT = process.env.PORT || 3002;
const MAX_NUMBERS = 100;
const DEFAULT_WAIT_MS = 12_000;
const POLL_MS = 100;

function tokenSources() {
  return [
    ['production', process.env.DNC_GATEWAY_TOKEN_PRODUCTION],
    ['sandbox', process.env.DNC_GATEWAY_TOKEN_SANDBOX],
  ].filter(([, token]) => Boolean(token));
}

/** Constant-time match of the presented bearer token against each configured source. */
export function resolveSource(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  const presented = Buffer.from(header.slice(7));
  for (const [source, token] of tokenSources()) {
    const expected = Buffer.from(token);
    if (expected.length === presented.length && crypto.timingSafeEqual(expected, presented)) {
      return source;
    }
  }
  return null;
}

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (req, res) => {
    let db = 'unknown';
    try {
      await queue.stats();
      db = 'ok';
    } catch {
      db = 'error';
    }
    res.status(db === 'ok' ? 200 : 503).json({
      status: db === 'ok' ? 'OK' : 'DEGRADED',
      service: 'mktr-dnc-gateway',
      database: db,
      credentialed: credentialed(),
      sourcesConfigured: tokenSources().map(([source]) => source),
      timestamp: new Date().toISOString(),
    });
  });

  // Operational visibility. Authenticated like a submit, so queue depth and
  // spend are not public.
  app.get('/v1/stats', async (req, res) => {
    const source = resolveSource(req.get('authorization'));
    if (!source) return res.status(401).json({ error: 'unauthorized' });
    const stats = await queue.stats();
    res.json({
      ...stats,
      credentialed: credentialed(),
      endpoint: gatewayConfig().baseUrl || null,
      sandbox: { caps: sandboxCaps(), allowlistedNumbers: sandboxAllowlist().length },
    });
  });

  app.post('/v1/check', async (req, res) => {
    const source = resolveSource(req.get('authorization'));
    if (!source) return res.status(401).json({ error: 'unauthorized' });

    const raw = Array.isArray(req.body?.numbers) ? req.body.numbers : null;
    if (!raw || raw.length === 0) return res.status(400).json({ error: 'numbers[] required' });
    if (raw.length > MAX_NUMBERS) return res.status(400).json({ error: `at most ${MAX_NUMBERS} numbers` });

    const numbers = raw.map((n) => formatDncNumber(n));
    if (numbers.some((n) => !n)) return res.status(400).json({ error: 'every number must be a Singapore 3/6/8/9 number' });

    const checkOnBehalf = String(req.body?.checkOnBehalf || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';
    const idempotencyKey = req.get('x-idempotency-key') || null;
    const waitMs = Math.min(Number(req.body?.waitMs) || DEFAULT_WAIT_MS, 25_000);

    // Idempotent replay: an already-answered batch is returned without spending
    // a second prepaid credit.
    const existing = await queue.findByIdempotency(source, idempotencyKey);
    if (existing && existing.status === 'done') {
      return res.json({ id: existing.id, source, replayed: true, result: existing.result });
    }
    if (existing && existing.status === 'blocked') {
      return res.json({ id: existing.id, source, replayed: true, result: existing.result });
    }

    const item = existing || (await queue.enqueue({ source, numbers, checkOnBehalf, idempotencyKey }));

    // Synchronous from the caller's point of view: hold the request open while
    // the worker drains, then answer. A caller that times out gets a held lead —
    // fail closed — and the durable row is still answered for the next retry.
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const current = await queue.getItem(item.id);
      if (current?.status === 'done') {
        return res.json({ id: item.id, source, result: current.result });
      }
      if (current?.status === 'blocked') {
        return res.json({ id: item.id, source, result: current.result });
      }
      if (current?.status === 'failed') {
        return res.status(502).json({ id: item.id, source, error: current.error || 'send_failed' });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    return res.status(202).json({ id: item.id, source, queued: true });
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}

export async function start() {
  if (tokenSources().length === 0) {
    throw new Error('FATAL: no source tokens configured — set DNC_GATEWAY_TOKEN_PRODUCTION and/or DNC_GATEWAY_TOKEN_SANDBOX');
  }
  await ensureSchema();
  const app = buildApp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[dnc-gateway] listening on ${PORT}`);
    console.log(`[dnc-gateway] sources: ${tokenSources().map(([s]) => s).join(', ')}`);
    console.log(`[dnc-gateway] credentialed: ${credentialed()}`);
  });
  const stopWorker = startWorker({ logger: console });

  const shutdown = async () => {
    stopWorker();
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error('[dnc-gateway] failed to start:', err.message);
    process.exit(1);
  });
}

export default { buildApp, start, resolveSource };
