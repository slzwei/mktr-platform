import { query } from './db.js';

/**
 * Idempotent schema for the shared DNC queue. Applied at every boot — the
 * gateway owns its database outright, so `CREATE … IF NOT EXISTS` is the whole
 * migration story and a fresh database needs no separate init step.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dnc_queue_items (
     id               uuid PRIMARY KEY,
     source           text NOT NULL CHECK (source IN ('production','sandbox')),
     priority         smallint NOT NULL,
     numbers          jsonb NOT NULL,
     check_on_behalf  text NOT NULL DEFAULT 'N',
     idempotency_key  text,
     status           text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','leased','done','failed','blocked')),
     attempts         integer NOT NULL DEFAULT 0,
     lease_until      timestamptz,
     enqueued_at      timestamptz NOT NULL DEFAULT now(),
     started_at       timestamptz,
     completed_at     timestamptz,
     pdpc_timestamp   bigint,
     http_status      integer,
     result           jsonb,
     error            text
   )`,
  // The lease scan: production (priority 0) always sorts ahead of sandbox
  // (priority 1), then oldest first. Partial index keeps it to live work only.
  `CREATE INDEX IF NOT EXISTS dnc_queue_pending_idx
     ON dnc_queue_items (priority, enqueued_at)
     WHERE status IN ('queued','leased')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dnc_queue_idempotency_idx
     ON dnc_queue_items (source, idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dnc_queue_enqueued_idx ON dnc_queue_items (enqueued_at DESC)`,
  // The one globally-monotonic PDPC timestamp. Persisted so a restart can never
  // reissue or regress a timestamp (PDPC rejects both: S403 bad_timestamp).
  `CREATE TABLE IF NOT EXISTS dnc_gateway_clock (
     id             integer PRIMARY KEY,
     last_timestamp bigint NOT NULL DEFAULT 0,
     updated_at     timestamptz NOT NULL DEFAULT now()
   )`,
  `INSERT INTO dnc_gateway_clock (id, last_timestamp) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  // Durable per-source spend counters — the gateway's own second enforcement of
  // the sandbox caps, independent of whatever the sandbox API believes.
  `CREATE TABLE IF NOT EXISTS dnc_gateway_usage (
     key        text PRIMARY KEY,
     count      integer NOT NULL DEFAULT 0,
     expires_at timestamptz NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export async function ensureSchema() {
  for (const statement of STATEMENTS) {
    await query(statement);
  }
}

export default { ensureSchema };
