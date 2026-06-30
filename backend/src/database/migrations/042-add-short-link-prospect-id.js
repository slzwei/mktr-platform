/**
 * Migration 042 — short_links.prospectId (canonical per-prospect referral link).
 *
 * The lead-capture confirmation email and the in-app post-submit share dialog must
 * hand the prospect the SAME short link. We mint exactly one share link per prospect
 * (server-side, at prospect creation, on the campaign's canonical host) and key it by
 * the prospect so both surfaces resolve the same row. A UNIQUE index makes "one share
 * link per prospect" a hard guarantee that the getOrCreate path relies on for race
 * safety.
 *
 *   prospectId  UUID, nullable. NULL = non-prospect link (admin / campaign-level share /
 *               legacy rows). A PARTIAL unique index (WHERE prospectId IS NOT NULL)
 *               enforces uniqueness only for prospect links, so every existing NULL row
 *               is untouched — instant, no backfill, safe rollback.
 *
 * DDL errors are NOT blanket-swallowed (cf. 041): only "already exists" is ignored for
 * idempotent re-runs; anything else re-throws so the runner never records a half-applied
 * migration as done (a swallowed addIndex failure would fake a race guard that isn't
 * there). A post-up assertion verifies the column landed.
 */
function ignoreExists(e) {
  const msg = String(e?.message || e || '');
  if (!/already exists|duplicate/i.test(msg)) throw e;
}

const INDEX_NAME = 'short_links_prospect_id_unique';

export async function up(queryInterface, Sequelize) {
  const { DataTypes, Op } = Sequelize;
  const table = await queryInterface.describeTable('short_links').catch(() => ({}));

  if (!table.prospectId) {
    await queryInterface
      .addColumn('short_links', 'prospectId', {
        type: DataTypes.UUID,
        allowNull: true,
        comment:
          'Prospect whose canonical referral share link this is. NULL = admin/campaign/legacy link. Partial-unique per prospect.',
      })
      .catch(ignoreExists);
  }

  // Partial unique index: one share link per prospect; NULLs excluded so existing/admin
  // rows are unaffected and the index applies with no dedup of legacy data.
  await queryInterface
    .addIndex('short_links', ['prospectId'], {
      name: INDEX_NAME,
      unique: true,
      where: { prospectId: { [Op.ne]: null } },
    })
    .catch(ignoreExists);

  // Post-up assertion — fail loudly if the column didn't land (the index failure already
  // re-throws via ignoreExists above, so it is never silently skipped).
  const after = await queryInterface.describeTable('short_links');
  if (!after.prospectId) {
    throw new Error('042-add-short-link-prospect-id: prospectId column missing after up()');
  }
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('short_links', INDEX_NAME).catch(() => {});
  await queryInterface.removeColumn('short_links', 'prospectId').catch(() => {});
}
