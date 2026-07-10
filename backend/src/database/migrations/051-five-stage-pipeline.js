/**
 * 051 — Five-stage pipeline (docs: research-backed reduction from 14 stages).
 *
 * New model: NEW → CONTACTED → MEETING → PROPOSAL → PARTNERED, plus LOST as a
 * terminal outcome with a reason, plus snooze-as-flag. Old stage names remain
 * valid history in partner_stage_events (STRING columns, never rewritten).
 *
 * Idempotent + guarded like 045-050; down() restores a best-effort mapping
 * (lossy by design — merged stages can't be split back).
 */
export async function up(queryInterface) {
  const q = async (sql) => queryInterface.sequelize.query(sql);

  await q('ALTER TABLE partner_organisations ADD COLUMN IF NOT EXISTS "lostReason" VARCHAR(32)');
  await q('ALTER TABLE partner_organisations ADD COLUMN IF NOT EXISTS "snoozedUntil" TIMESTAMPTZ');

  // Ownership decouples from stage: UNCLAIMED/CLAIMED/RESEARCHING were never
  // commitment milestones. Researching work is a task; claiming is ownerUserId.
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'NEW'
            WHERE "pipelineStage" IN ('UNCLAIMED', 'CLAIMED', 'RESEARCHING')`);

  // Replied is an activity outcome; no-response is a risk signal, not a stage.
  await q(`UPDATE partner_organisations SET "staleFlag" = TRUE
            WHERE "pipelineStage" = 'NO_RESPONSE'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'CONTACTED'
            WHERE "pipelineStage" IN ('REPLIED', 'NO_RESPONSE')`);

  await q(`UPDATE partner_organisations SET "pipelineStage" = 'MEETING'
            WHERE "pipelineStage" IN ('MEETING_BOOKED', 'MEETING_COMPLETED')`);

  await q(`UPDATE partner_organisations SET "pipelineStage" = 'PROPOSAL'
            WHERE "pipelineStage" IN ('PROPOSAL_SENT', 'NEGOTIATING')`);

  // Two dead stages become one outcome with a reason.
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'LOST', "lostReason" = 'not_interested'
            WHERE "pipelineStage" = 'NOT_INTERESTED'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'LOST', "lostReason" = 'disqualified'
            WHERE "pipelineStage" = 'DISQUALIFIED'`);

  // Snooze becomes a flag: keep availability='follow_up_later' (already set by
  // the old stage move) and give it a 30-day wake so nothing sleeps forever.
  await q(`UPDATE partner_organisations
              SET "pipelineStage" = 'CONTACTED',
                  "snoozedUntil" = NOW() + INTERVAL '30 days'
            WHERE "pipelineStage" = 'FOLLOW_UP_LATER'`);

  // New records start at NEW.
  await q(`ALTER TABLE partner_organisations ALTER COLUMN "pipelineStage" SET DEFAULT 'NEW'`);
}

export async function down(queryInterface) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  // Best-effort reversal onto representative old names (merged detail is gone).
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'CLAIMED'
            WHERE "pipelineStage" = 'NEW' AND "ownerUserId" IS NOT NULL`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'UNCLAIMED'
            WHERE "pipelineStage" = 'NEW'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'MEETING_BOOKED'
            WHERE "pipelineStage" = 'MEETING'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'PROPOSAL_SENT'
            WHERE "pipelineStage" = 'PROPOSAL'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'NOT_INTERESTED'
            WHERE "pipelineStage" = 'LOST' AND "lostReason" = 'not_interested'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'DISQUALIFIED'
            WHERE "pipelineStage" = 'LOST'`);
  await q(`UPDATE partner_organisations SET "pipelineStage" = 'FOLLOW_UP_LATER'
            WHERE availability = 'follow_up_later' AND "pipelineStage" = 'CONTACTED'`);
  await q(`ALTER TABLE partner_organisations ALTER COLUMN "pipelineStage" SET DEFAULT 'UNCLAIMED'`);
  await q('ALTER TABLE partner_organisations DROP COLUMN IF EXISTS "lostReason"');
  await q('ALTER TABLE partner_organisations DROP COLUMN IF EXISTS "snoozedUntil"');
}
