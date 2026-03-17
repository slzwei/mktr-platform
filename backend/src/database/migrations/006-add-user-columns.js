/**
 * Add missing columns to the users table:
 * invitationToken, invitationExpires, dateOfBirth, companyName, lyfeId.
 */
export async function up(queryInterface, sequelize) {
  await queryInterface.addColumn('users', 'invitationToken', {
    type: 'TEXT',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('users', 'invitationExpires', {
    type: 'TIMESTAMP WITH TIME ZONE',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('users', 'dateOfBirth', {
    type: 'DATE',   // maps to DATEONLY in Postgres (just the date, no time)
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('users', 'companyName', {
    type: 'VARCHAR(255)',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('users', 'lyfeId', {
    type: 'VARCHAR(255)',
    allowNull: true,
    unique: true
  }).catch(() => {});

  // Explicit unique index on lyfeId for lookup performance
  await queryInterface.addIndex('users', ['lyfeId'], {
    name: 'idx_users_lyfe_id',
    unique: true
  }).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('users', 'idx_users_lyfe_id').catch(() => {});
  await queryInterface.removeColumn('users', 'lyfeId').catch(() => {});
  await queryInterface.removeColumn('users', 'companyName').catch(() => {});
  await queryInterface.removeColumn('users', 'dateOfBirth').catch(() => {});
  await queryInterface.removeColumn('users', 'invitationExpires').catch(() => {});
  await queryInterface.removeColumn('users', 'invitationToken').catch(() => {});
}
