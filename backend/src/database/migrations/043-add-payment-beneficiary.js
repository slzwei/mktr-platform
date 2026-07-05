/**
 * Migration 043 — payments beneficiary (manager "buy for team", MANAGER_ROLE_PLAN §6.2).
 *
 * A mktr-leads MANAGER can buy a lead package FOR a team member: the manager pays,
 * the member's balance is credited. Three columns on the money record:
 *
 *   beneficiaryUserId  UUID FK → users, SET NULL on delete (payments outlive people,
 *                      like every other payment FK — migration 040 precedent).
 *                      NULL = self purchase, OR the beneficiary was deleted before
 *                      settlement (disambiguated by forTeam).
 *   forTeam            BOOLEAN NOT NULL DEFAULT false — the IMMUTABLE team-purchase
 *                      marker. It survives the FK SET NULL, so fulfillment can refuse
 *                      the silent payer-credit fallback: an explicit team purchase
 *                      whose beneficiary vanished lands paid_unfulfilled (manual
 *                      review), never a grant to the payer.
 *   beneficiaryName    STRING snapshot at checkout — history labels outlive deletion.
 *
 * Idempotent re-runs: describeTable guard + only "already exists" swallowed (042
 * discipline); a post-up assertion verifies all three columns landed.
 */
function ignoreExists(e) {
  const msg = String(e?.message || e || '');
  if (!/already exists|duplicate/i.test(msg)) throw e;
}

export async function up(queryInterface, Sequelize) {
  const { DataTypes } = Sequelize;
  const table = await queryInterface.describeTable('payments').catch(() => ({}));

  if (!table.beneficiaryUserId) {
    await queryInterface
      .addColumn('payments', 'beneficiaryUserId', {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        comment:
          'Grantee of a manager team purchase. NULL = self purchase OR beneficiary deleted pre-settlement (see forTeam).',
      })
      .catch(ignoreExists);
  }

  if (!table.forTeam) {
    await queryInterface
      .addColumn('payments', 'forTeam', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          'Immutable team-purchase marker; survives beneficiary FK SET NULL so fulfillment never falls back to crediting the payer.',
      })
      .catch(ignoreExists);
  }

  if (!table.beneficiaryName) {
    await queryInterface
      .addColumn('payments', 'beneficiaryName', {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Display snapshot of the beneficiary at checkout — history labels outlive deletion.',
      })
      .catch(ignoreExists);
  }

  const after = await queryInterface.describeTable('payments');
  if (!after.beneficiaryUserId || !after.forTeam || !after.beneficiaryName) {
    throw new Error('043: payments beneficiary columns did not land');
  }
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('payments', 'beneficiaryName').catch(() => {});
  await queryInterface.removeColumn('payments', 'forTeam').catch(() => {});
  await queryInterface.removeColumn('payments', 'beneficiaryUserId').catch(() => {});
}
