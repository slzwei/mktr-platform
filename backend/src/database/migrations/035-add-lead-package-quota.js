/**
 * Lead-package HARD QUOTA (paywall) — schema.
 *
 * Adds, all additive + nullable/defaulted (instant on any table size, safe rollback):
 *   - campaigns.enforce_lead_quota  (bool, default false) → Campaign.enforceLeadQuota.
 *       When true, leads on this campaign require a funded lead-package credit;
 *       an unfunded lead is QUARANTINED (held), not delivered free via the fallback.
 *       Default false ⇒ every existing campaign keeps today's soft behaviour.
 *   - prospects.quarantinedAt    (timestamp, null) → the ONLY quarantine signal.
 *       A null assignedAgentId alone does NOT mean quarantined (manual unassign /
 *       no-campaign Retell/Meta leads already produce that); quarantinedAt is explicit.
 *   - prospects.quarantineReason (varchar(64), null) → e.g. 'no_funded_agent'.
 *   - partial-ish index on quarantinedAt for the held-leads queue + FIFO release.
 *
 * Numbered 035 — above main's latest (034-add-campaign-tiktok-pixel-id) after merging
 * the quiz/TikTok work, so there is no filename collision.
 */
// Swallow ONLY "already exists" errors (idempotent re-run — e.g. when the columns were
// created from the models via sequelize.sync in tests); re-throw any other DDL failure so
// the runner does NOT record a half-applied migration as successfully applied.
function ignoreExists(e) {
  const msg = String(e?.message || e || '');
  if (!/already exists|duplicate/i.test(msg)) throw e;
}

export async function up(queryInterface, Sequelize) {
  await queryInterface
    .addColumn('campaigns', 'enforce_lead_quota', {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'When true, leads require a funded lead-package credit; unfunded leads are quarantined, not delivered free.',
    })
    .catch(ignoreExists);

  await queryInterface
    .addColumn('prospects', 'quarantinedAt', {
      type: Sequelize.DataTypes.DATE,
      allowNull: true,
      comment: 'Set when held under lead-quota (no funded agent). NULL = not quarantined. The ONLY quarantine signal.',
    })
    .catch(ignoreExists);

  await queryInterface
    .addColumn('prospects', 'quarantineReason', {
      type: Sequelize.DataTypes.STRING(64),
      allowNull: true,
      comment: 'Why the lead was quarantined, e.g. no_funded_agent.',
    })
    .catch(ignoreExists);

  await queryInterface
    .addIndex('prospects', ['quarantinedAt'], { name: 'idx_prospects_quarantinedat' })
    .catch(ignoreExists);
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('prospects', 'idx_prospects_quarantinedat').catch(() => {});
  await queryInterface.removeColumn('prospects', 'quarantineReason').catch(() => {});
  await queryInterface.removeColumn('prospects', 'quarantinedAt').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'enforce_lead_quota').catch(() => {});
}
