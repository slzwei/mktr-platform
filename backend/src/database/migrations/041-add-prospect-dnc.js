/**
 * Migration 041 — prospects DNC (Do Not Call) scrubbing columns.
 *
 * Records the result of checking each lead's Singapore number against PDPC's DNC
 * Registry (see docs/plans/dnc-scrubbing.md). Discrete columns for the fields we
 * FILTER on (status + validity) + a JSONB evidence blob for the compliance audit.
 *
 *   dncStatus        pending | clear | registered | error | skipped   (indexed)
 *   dncNoVoiceCall   true = registered (R) on the no-voice-call register → do NOT call
 *   dncNoTextMessage true = registered on the no-text-message register
 *   dncNoFax         true = registered on the no-fax register
 *   dncCheckedAt     timestamp of the last successful check
 *   dncValidUntil    result validity end date (from the API `msg`) — cache + re-scrub trigger (indexed)
 *   dncMetadata      { transactionId, createdTime, rawMsg, statusCode, checkOnBehalf, numberChecked }
 *
 * Compliance-critical, so DDL errors are NOT blanket-swallowed (cf. migration 040):
 * only "already exists" is ignored (idempotent re-run); anything else re-throws so the
 * runner never records a half-applied migration as done. A post-`up` assertion verifies
 * every column landed. All columns are nullable with no default => no-op for existing rows.
 */
function ignoreExists(e) {
  const msg = String(e?.message || e || '');
  if (!/already exists|duplicate/i.test(msg)) throw e;
}

export async function up(queryInterface, Sequelize) {
  const { DataTypes } = Sequelize;
  const table = await queryInterface.describeTable('prospects').catch(() => ({}));

  const defs = {
    dncStatus: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'DNC check state: pending|clear|registered|error|skipped. NULL = never checked.',
    },
    dncNoVoiceCall: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'true = registered on the DNC no-voice-call register (do NOT call).',
    },
    dncNoTextMessage: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'true = registered on the DNC no-text-message register.',
    },
    dncNoFax: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'true = registered on the DNC no-fax register.',
    },
    dncCheckedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp of the last successful DNC check.',
    },
    dncValidUntil: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'DNC result validity end date (from API msg). Cache hit while now() < this; re-scrub trigger.',
    },
    dncMetadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'DNC check evidence: transactionId, createdTime, rawMsg, statusCode, checkOnBehalf, numberChecked.',
    },
  };

  for (const [name, def] of Object.entries(defs)) {
    if (!table[name]) {
      await queryInterface.addColumn('prospects', name, def).catch(ignoreExists);
    }
  }

  // Indexes live here (not in the model / not the defunct ensurePostgresIndexes):
  // dncStatus drives the admin "show DNC-held" filter; dncValidUntil drives the backfill's
  // near-expiry sweep.
  await queryInterface
    .addIndex('prospects', ['dncStatus'], { name: 'idx_prospects_dnc_status' })
    .catch(ignoreExists);
  await queryInterface
    .addIndex('prospects', ['dncValidUntil'], { name: 'idx_prospects_dnc_valid_until' })
    .catch(ignoreExists);

  // Post-up assertion — fail loudly if a compliance column didn't land.
  const after = await queryInterface.describeTable('prospects');
  const missing = Object.keys(defs).filter((c) => !after[c]);
  if (missing.length) {
    throw new Error(`041-add-prospect-dnc: columns missing after up(): ${missing.join(', ')}`);
  }
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('prospects', 'idx_prospects_dnc_status').catch(() => {});
  await queryInterface.removeIndex('prospects', 'idx_prospects_dnc_valid_until').catch(() => {});
  for (const name of [
    'dncStatus',
    'dncNoVoiceCall',
    'dncNoTextMessage',
    'dncNoFax',
    'dncCheckedAt',
    'dncValidUntil',
    'dncMetadata',
  ]) {
    await queryInterface.removeColumn('prospects', name).catch(() => {});
  }
}
