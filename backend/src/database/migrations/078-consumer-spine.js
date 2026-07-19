/**
 * 078 — Consumer spine (docs/plans/consumer-spine-and-consent-ledger.md §2.1).
 *
 * `consumers` = the durable cross-campaign person, keyed by E.164 phone (one
 * row per human; prospects stay one-row-per-campaign-signup). Additive only:
 * nullable `consumerId` FKs on prospects + reward_entitlements, no behavior
 * change on existing paths. 079 backfills/reconciles the projection.
 *
 * Guarded/idempotent like 052–077 AND sync-tolerant: in test boot,
 * sequelize.sync({force:true}) creates these tables/indexes from the models
 * FIRST (bootstrap.js) — every statement here must no-op cleanly on top of
 * that (IF NOT EXISTS by the exact names the models declare; FK adds check
 * information_schema because sync names its FKs differently).
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS consumers (
    id UUID PRIMARY KEY,
    phone VARCHAR(20),
    "phoneHash" VARCHAR(64) NOT NULL,
    "firstName" VARCHAR(255),
    "lastName" VARCHAR(255),
    email VARCHAR(255),
    "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "signupCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedSignupCount" INTEGER NOT NULL DEFAULT 0,
    "unsubTokenHash" VARCHAR(64),
    "erasedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);

  // Identity key: one live consumer per phone; null (erased) rows exempt.
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_consumers_phone
             ON consumers (phone) WHERE phone IS NOT NULL`);
  await q(`CREATE INDEX IF NOT EXISTS idx_consumers_phone_hash ON consumers ("phoneHash")`);
  await q(`CREATE INDEX IF NOT EXISTS idx_consumers_last_seen ON consumers ("lastSeenAt")`);

  // Integrity CHECKs (name-guarded — ADD CONSTRAINT has no IF NOT EXISTS).
  await q(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_consumers_phone_e164') THEN
      ALTER TABLE consumers ADD CONSTRAINT chk_consumers_phone_e164
        CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{9,14}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_consumers_phone_hash_hex') THEN
      ALTER TABLE consumers ADD CONSTRAINT chk_consumers_phone_hash_hex
        CHECK ("phoneHash" ~ '^[0-9a-f]{64}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_consumers_counts') THEN
      ALTER TABLE consumers ADD CONSTRAINT chk_consumers_counts
        CHECK ("signupCount" >= 0 AND "verifiedSignupCount" >= 0);
    END IF;
  END $$`);

  await q(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS "consumerId" UUID`);
  await q(`ALTER TABLE reward_entitlements ADD COLUMN IF NOT EXISTS "consumerId" UUID`);
  await q(`CREATE INDEX IF NOT EXISTS idx_prospects_consumer ON prospects ("consumerId")`);
  await q(`CREATE INDEX IF NOT EXISTS idx_re_consumer ON reward_entitlements ("consumerId")`);

  // FKs: SET NULL on consumer delete (history survives). Column-level existence
  // check — sync-created FKs carry Sequelize's own constraint names.
  await q(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'prospects' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'consumerId'
    ) THEN
      ALTER TABLE prospects ADD CONSTRAINT fk_prospects_consumer
        FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'reward_entitlements' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'consumerId'
    ) THEN
      ALTER TABLE reward_entitlements ADD CONSTRAINT fk_re_consumer
        FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE SET NULL;
    END IF;
  END $$`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('ALTER TABLE reward_entitlements DROP COLUMN IF EXISTS "consumerId"');
  await q('ALTER TABLE prospects DROP COLUMN IF EXISTS "consumerId"');
  await q('DROP TABLE IF EXISTS consumers');
}
