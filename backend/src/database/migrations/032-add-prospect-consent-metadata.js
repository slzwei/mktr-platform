/**
 * Migration 032 — prospects.consentMetadata (JSONB, nullable).
 *
 * Dedicated home for THIRD-PARTY-DISCLOSURE consent evidence — materially
 * different from the marketing/CAPI consent booleans (consent_contact /
 * consent_terms) that live in sourceMetadata. Required before a lead may be
 * routed to an external MKTR Leads buyer.
 *
 * Shape (written by per-source capture, built later):
 *   consentMetadata.external = { version, consentedAt, channels[], sourceUrl? }
 * See services/externalConsent.hasValidExternalConsent(). Nullable + no default
 * => no-op for all existing rows; the external path stays inert until capture
 * populates it.
 */
export async function up(queryInterface, Sequelize) {
  const table = await queryInterface.describeTable('prospects').catch(() => ({}));
  if (!table.consentMetadata) {
    await queryInterface.addColumn('prospects', 'consentMetadata', {
      type: Sequelize.DataTypes.JSONB,
      allowNull: true,
      comment: 'Third-party-disclosure consent evidence; consentMetadata.external gates external (MKTR Leads) delivery.',
    }).catch(() => {});
  }
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('prospects', 'consentMetadata').catch(() => {});
}
