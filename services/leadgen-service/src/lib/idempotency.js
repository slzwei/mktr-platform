import crypto from 'crypto';
import { withClient } from '../db/index.js';

const DEFAULT_WINDOW_HOURS = parseInt(process.env.LEADGEN_IDEMP_WINDOW_HOURS || '24', 10);

export async function ensureIdempotencyTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS leadgen.idempotency_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      idempotency_key text NOT NULL,
      request_hash text NOT NULL,
      response_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_idemp_tenant_created ON leadgen.idempotency_keys(tenant_id, created_at DESC);
  `);
}

export function hashPayload(payload) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(payload || {}));
  return h.digest('hex');
}

export async function checkIdempotency(tenantId, key, payload) {
  if (!key) return { action: 'proceed' };
  return await withClient(async (client) => {
    await ensureIdempotencyTable(client);
    const { rows } = await client.query(
      `SELECT * FROM leadgen.idempotency_keys WHERE tenant_id=$1 AND idempotency_key=$2 AND created_at >= NOW() - INTERVAL '${DEFAULT_WINDOW_HOURS} hours' ORDER BY created_at DESC LIMIT 1`,
      [tenantId, key]
    );
    if (!rows[0]) return { action: 'proceed' };
    const existing = rows[0];
    const incomingHash = hashPayload(payload);
    if (existing.request_hash === incomingHash) {
      return { action: 'replay', response: existing.response_json };
    }
    return { action: 'conflict' };
  });
}

export async function persistIdempotency(tenantId, key, payload, responseBody) {
  if (!key) return;
  await withClient(async (client) => {
    await ensureIdempotencyTable(client);
    const reqHash = hashPayload(payload);
    await client.query(
      `INSERT INTO leadgen.idempotency_keys (tenant_id, idempotency_key, request_hash, response_json) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      [tenantId, key, reqHash, JSON.stringify(responseBody)]
    );
  });
}


