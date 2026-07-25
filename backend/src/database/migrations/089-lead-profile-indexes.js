/**
 * 089 — Lead Profile page read-path indexes (docs/plans/admin-lead-profile-page.md §4).
 *
 * Two person-first lookups the page needs that nothing served before:
 *  - webhook_deliveries by the lead id inside the payload (Lyfe delivery
 *    status). Partial: only the two event types the page asks about — the
 *    purge path deletes failed rows only, so successful rows grow unbounded
 *    and an unindexed JSON-path scan would degrade with the table.
 *  - email_broadcast_recipients by consumer (broadcast history). Existing
 *    indexes lead on broadcastId and cannot serve a person lookup.
 * Both additive; no backfill.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE INDEX IF NOT EXISTS idx_wd_lead_external_created
    ON webhook_deliveries (((payload::jsonb #>> '{data,lead,externalId}')), "createdAt" DESC)
    WHERE "eventType" IN ('lead.created', 'lead.assigned')`);

  await q(`CREATE INDEX IF NOT EXISTS idx_ebr_consumer_created
    ON email_broadcast_recipients ("consumerId", "createdAt" DESC)`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP INDEX IF EXISTS idx_wd_lead_external_created');
  await q('DROP INDEX IF EXISTS idx_ebr_consumer_created');
}
