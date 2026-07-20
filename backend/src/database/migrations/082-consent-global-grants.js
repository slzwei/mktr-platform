/**
 * 082 — Mint GLOBAL contact grants for brand-scope-era captures (tracker
 * "globalev").
 *
 * #213/#214 shipped the mandatory agree-all block stamping brand-scope
 * evidence, but capture wrote campaign-scoped rows only until globalev
 * landed. This mints the missing campaignId:null twins for that window (and
 * for any scoped-only healed rows) via backfillGlobalGrants() — one twin per
 * (consumer, era), evidence copied from the scoped grant, source:'backfill'.
 *
 * Idempotent: uq_ce_backfill (prospectId, kind) WHERE source='backfill' +
 * ON CONFLICT DO NOTHING — reruns no-op.
 */
export async function up() {
  const { backfillGlobalGrants } = await import('../../services/consentService.js');
  const { logger } = await import('../../utils/logger.js');
  const stats = await backfillGlobalGrants();
  logger.info('[082] global consent grants minted', stats);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    `DELETE FROM consent_events
      WHERE source = 'backfill' AND kind = 'contact' AND "campaignId" IS NULL`
  );
}
