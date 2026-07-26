/**
 * 096 — WhatsApp send-time ownership (docs/plans/per-campaign-lead-scoring.md §5).
 *
 * Phase 3 scores a `read` as a response to ONE lead's pitch, so it must know
 * which lead a message was sent for. Nothing recorded that. `deliveryReceipts`
 * joins redemption_events → wa_message_statuses on wamid and filters by
 * entitlement ids drawn from the person's whole journey
 * (leadProfileService.js:100-119) — it never touches activations or campaigns.
 * Reconstructing ownership afterwards is unsafe rather than merely missing:
 * receipts carry no immutable campaign snapshot
 * (redeemOps/entitlementService.js:211) and activations can be relinked
 * (redeemOps/activationService.js:117,153), so a historical send can be
 * attributed to the WRONG campaign. Screening-callback WhatsApps write no
 * receipt at all — their wamid lives only in
 * prospects.screeningMetadata.waCallback (retellScreeningService.js:521-529).
 *
 * So ownership is STAMPED AT SEND and never derived. The webhook keeps writing
 * wa_message_statuses keyed by wamid, untouched
 * (redeemOps/waWebhookService.js:73,154); scoping becomes a join on wamid.
 *
 * NO FOREIGN KEYS — snapshot semantics, the same reasoning §9 applies to the
 * config's campaignId. Campaigns can be permanently deleted
 * (campaignService.js:1032-1035) while their prospects survive with campaignId
 * nulled (014-add-cascade-rules.js:87). A CASCADE would destroy the ownership
 * of messages whose lead is still alive and still scoring; SET NULL would
 * silently re-home a dead campaign's sends. A bare UUID does neither.
 *
 * BACKFILL: none is possible. Ownership was never recorded, and inferring it
 * is precisely the unsafe operation this table exists to replace. Sends made
 * before this migration simply do not score. Stated, not hidden.
 *
 * campaignId is NULLABLE and this is deliberate — see the model for why.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS wa_message_sends (
    wamid VARCHAR(128) PRIMARY KEY,
    "prospectId" UUID NOT NULL,
    "campaignId" UUID,
    "consumerId" UUID,
    kind VARCHAR(24) NOT NULL,
    "sentAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // The scoring join: "every message owned by this lead".
  await q(`CREATE INDEX IF NOT EXISTS idx_wa_sends_prospect
    ON wa_message_sends ("prospectId")`);

  // Erasure deletes by consumer. Plain, not partial, so the shape the model
  // declares and the shape this migration builds are the same index — the
  // test schema comes from sync({force:true}) on the MODEL, so a divergence
  // here is a divergence nothing would catch (CLAUDE.md, "test schema ≠ prod
  // schema").
  await q(`CREATE INDEX IF NOT EXISTS idx_wa_sends_consumer
    ON wa_message_sends ("consumerId")`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP TABLE IF EXISTS wa_message_sends');
}
