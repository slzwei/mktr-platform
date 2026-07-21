/**
 * 085 — Email broadcast push (tracker "emailpush",
 * docs/plans/email-broadcast-push.md).
 *
 * `email_broadcasts` is a composed push (subject/body/CTA about ONE campaign,
 * aimed at ONE cohort) plus its send-context snapshot, frozen at `preparing`
 * so a resume can never send under drifted config. `email_broadcast_recipients`
 * is the send log AND the per-recipient at-most-once claim: the unique
 * (broadcastId, consumerId) pair plus the pending→attempting CAS is what makes
 * a crash-resume unable to double-send.
 *
 * Erasure contract: recipients rows are consumerId-linked and join the
 * erasureService matrix (email + error nulled, delivery facts kept on the
 * retained skeleton).
 *
 * Guarded/idempotent + sync-tolerant like 080/084 (test boot syncs models
 * first; CHECKs and indexes are name-guarded, FKs column-checked).
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS email_broadcasts (
    id UUID PRIMARY KEY,
    "cohortId" UUID NOT NULL,
    "campaignId" UUID,
    subject VARCHAR(200) NOT NULL,
    "bodyText" TEXT NOT NULL,
    "ctaLabel" VARCHAR(80) NOT NULL DEFAULT 'Learn more',
    "definitionSnapshot" JSONB,
    "hostChoice" VARCHAR(8),
    "emailContext" VARCHAR(8),
    "ctaUrl" TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "workerHeartbeatAt" TIMESTAMP WITH TIME ZONE,
    "startedAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "lastError" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS email_broadcast_recipients (
    id UUID PRIMARY KEY,
    "broadcastId" UUID NOT NULL,
    "consumerId" UUID NOT NULL,
    email VARCHAR(320),
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    reason VARCHAR(64),
    error TEXT,
    "sentAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);

  // FKs — column-level existence checks (sync names its own constraints).
  await q(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'email_broadcasts' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'cohortId'
    ) THEN
      ALTER TABLE email_broadcasts ADD CONSTRAINT fk_eb_cohort
        FOREIGN KEY ("cohortId") REFERENCES cohorts(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'email_broadcasts' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'campaignId'
    ) THEN
      ALTER TABLE email_broadcasts ADD CONSTRAINT fk_eb_campaign
        FOREIGN KEY ("campaignId") REFERENCES campaigns(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'email_broadcasts' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'createdBy'
    ) THEN
      ALTER TABLE email_broadcasts ADD CONSTRAINT fk_eb_created_by
        FOREIGN KEY ("createdBy") REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'email_broadcast_recipients' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'broadcastId'
    ) THEN
      ALTER TABLE email_broadcast_recipients ADD CONSTRAINT fk_ebr_broadcast
        FOREIGN KEY ("broadcastId") REFERENCES email_broadcasts(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'email_broadcast_recipients' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'consumerId'
    ) THEN
      ALTER TABLE email_broadcast_recipients ADD CONSTRAINT fk_ebr_consumer
        FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE RESTRICT;
    END IF;
  END $$`);

  // Enum + integrity CHECKs (name-guarded, 080 pattern).
  await q(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eb_status') THEN
      ALTER TABLE email_broadcasts ADD CONSTRAINT chk_eb_status
        CHECK (status IN ('draft','preparing','sending','cancelling','completed','interrupted','failed','cancelled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_eb_counts') THEN
      ALTER TABLE email_broadcasts ADD CONSTRAINT chk_eb_counts
        CHECK ("totalRecipients" >= 0 AND "sentCount" >= 0 AND "skippedCount" >= 0 AND "failedCount" >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ebr_status') THEN
      ALTER TABLE email_broadcast_recipients ADD CONSTRAINT chk_ebr_status
        CHECK (status IN ('pending','attempting','sent','skipped','failed'));
    END IF;
  END $$`);

  await q(`CREATE INDEX IF NOT EXISTS idx_eb_status_created
             ON email_broadcasts (status, "createdAt" DESC)`);
  // The at-most-once fence: one row per (broadcast, consumer), ever.
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ebr_broadcast_consumer
             ON email_broadcast_recipients ("broadcastId", "consumerId")`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ebr_broadcast_status
             ON email_broadcast_recipients ("broadcastId", status)`);
}
