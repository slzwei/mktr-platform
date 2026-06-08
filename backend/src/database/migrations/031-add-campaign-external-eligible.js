/**
 * Migration 031 — campaigns.external_eligible.
 *
 * Marks a campaign as eligible to route leads to EXTERNAL buyer agents (MKTR
 * Leads). Default false: existing campaigns stay internal-only, so this is a
 * no-op for all current data. A lead is only ever considered for external
 * assignment when its campaign has this flag AND the lead carries valid
 * third-party-disclosure consent (see services/externalConsent.js). Maps to
 * model field Campaign.externalEligible.
 */
export async function up(queryInterface, Sequelize) {
  const table = await queryInterface.describeTable('campaigns').catch(() => ({}));
  if (!table.external_eligible) {
    await queryInterface.addColumn('campaigns', 'external_eligible', {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'When true, leads for this campaign may be routed to external MKTR Leads buyers (consent-gated).',
    }).catch(() => {});
  }
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('campaigns', 'external_eligible').catch(() => {});
}
