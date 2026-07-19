/**
 * 080 — Person-level consent ledger + consumer suppressions (PR B,
 * docs/plans/consumer-spine-and-consent-ledger.md §3).
 *
 * consent_events: APPEND-ONLY evidence of consent acts, person-scoped
 * (consumerId RESTRICT — history must survive everything; erasure never
 * deletes consumers) and PURPOSE-scoped (campaignId — the live consent copy
 * is campaign-scoped on both surfaces; a campaign-null row = an explicit
 * GLOBAL act, e.g. unsubscribe). Reads resolve latest-wins within
 * (kind, campaignId-or-global).
 *
 * consumer_suppressions: the exit door. channel 'all' + reason 'unsubscribe'
 * blocks marketing everywhere; reason 'erasure' (PR C) blocks even
 * transactional sends.
 *
 * Guarded/idempotent + sync-tolerant like 078 (test boot syncs models first).
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS consent_events (
    id UUID PRIMARY KEY,
    "consumerId" UUID NOT NULL,
    "prospectId" UUID,
    "campaignId" UUID,
    kind VARCHAR(32) NOT NULL,
    granted BOOLEAN NOT NULL,
    channels JSONB,
    version VARCHAR(64) NOT NULL,
    source VARCHAR(32) NOT NULL,
    "sourceUrl" TEXT,
    verified BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" UUID,
    metadata JSONB,
    "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);

  await q(`CREATE INDEX IF NOT EXISTS idx_ce_consumer_kind_time
             ON consent_events ("consumerId", kind, "occurredAt" DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ce_prospect ON consent_events ("prospectId")`);
  // Backfill idempotency anchor (Codex R1 R2 lineage: no DB uniqueness = rerun dupes).
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ce_backfill
             ON consent_events ("prospectId", kind) WHERE source = 'backfill'`);

  await q(`CREATE TABLE IF NOT EXISTS consumer_suppressions (
    id UUID PRIMARY KEY,
    "consumerId" UUID NOT NULL,
    channel VARCHAR(16) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    source VARCHAR(255),
    "actorUserId" UUID,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_consumer_channel
             ON consumer_suppressions ("consumerId", channel)`);

  // Unsubscribe-token lookup (mailer mints lazily; the public endpoint finds
  // the consumer by hash so the URL never carries the cross-campaign UUID).
  await q(`CREATE INDEX IF NOT EXISTS idx_consumers_unsub_token
             ON consumers ("unsubTokenHash") WHERE "unsubTokenHash" IS NOT NULL`);

  // Enum + integrity CHECKs (name-guarded).
  await q(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ce_kind') THEN
      ALTER TABLE consent_events ADD CONSTRAINT chk_ce_kind
        CHECK (kind IN ('contact','campaign_terms','third_party','dnc_override','draw_terms'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ce_source') THEN
      ALTER TABLE consent_events ADD CONSTRAINT chk_ce_source
        CHECK (source IN ('signup','backfill','unsubscribe','admin','erasure'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cs_channel') THEN
      ALTER TABLE consumer_suppressions ADD CONSTRAINT chk_cs_channel
        CHECK (channel IN ('all','email','whatsapp','sms','voice'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cs_reason') THEN
      ALTER TABLE consumer_suppressions ADD CONSTRAINT chk_cs_reason
        CHECK (reason IN ('unsubscribe','complaint','admin','erasure'));
    END IF;
  END $$`);

  // FKs — column-level existence checks (sync names its own constraints).
  await q(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'consent_events' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'consumerId'
    ) THEN
      ALTER TABLE consent_events ADD CONSTRAINT fk_ce_consumer
        FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'consent_events' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'prospectId'
    ) THEN
      ALTER TABLE consent_events ADD CONSTRAINT fk_ce_prospect
        FOREIGN KEY ("prospectId") REFERENCES prospects(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'consumer_suppressions' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'consumerId'
    ) THEN
      ALTER TABLE consumer_suppressions ADD CONSTRAINT fk_cs_consumer
        FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE RESTRICT;
    END IF;
  END $$`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP INDEX IF EXISTS idx_consumers_unsub_token');
  await q('DROP TABLE IF EXISTS consumer_suppressions');
  await q('DROP TABLE IF EXISTS consent_events');
}
