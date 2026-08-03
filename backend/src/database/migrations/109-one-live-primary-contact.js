/**
 * 109 — at most ONE live primary contact per partner (M7).
 *
 * addContact/updateContact demoted existing primaries and inserted the new
 * one inside a transaction, but nothing serialized two concurrent switches
 * and no index rejected the second primary — both could commit, and the
 * cadence materializer then silently picked the OLDER primary by createdAt,
 * sending automated outreach to a different person than the operator chose.
 *
 * Reconciliation: the NEWEST live primary per partner keeps the flag (it is
 * the operator's latest expressed intent — the older one is exactly the row
 * the drift was mis-selecting); the rest demote. Then the partial unique
 * index makes a second live primary unstorable. Mirrored on the model
 * (sync-before-migrations test boot).
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    await q(`
      UPDATE partner_contacts SET "isPrimary" = false
       WHERE id IN (
         SELECT id FROM (
           SELECT id, row_number() OVER (
             PARTITION BY "partnerOrganisationId"
             ORDER BY "createdAt" DESC, id DESC
           ) AS rn
             FROM partner_contacts
            WHERE "isPrimary" = true AND "archivedAt" IS NULL
         ) ranked
         WHERE rn > 1
       )
    `);

    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_one_live_primary
        ON partner_contacts ("partnerOrganisationId")
        WHERE "isPrimary" = true AND "archivedAt" IS NULL
    `);
  });
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'DROP INDEX IF EXISTS uq_pc_one_live_primary'
  );
}
