/**
 * 105 — the redemption audit trail stops CASCADE-deleting (P2-17).
 *
 * RedemptionEvent's own header calls it "Append-only fulfilment history", but
 * both its foreign keys were ON DELETE CASCADE. Deleting an entitlement — or a
 * redemption — silently took its audit trail with it. An append-only record
 * that disappears when its subject does is not a record; it is a cache.
 *
 * RESTRICT matches what migration 102 did for reward_inventory_events, and for
 * the same reason: the history has to outlive the thing it describes, or it
 * cannot answer the one question it exists for — what happened to this
 * voucher, and who did it.
 *
 * The one path that legitimately purges (partnerService's admin-gated
 * force-delete) now clears these rows explicitly first, exactly as it already
 * did for reward_inventory_events. RESTRICT is here to stop the INCIDENTAL
 * delete, not the deliberate one.
 *
 * SET NULL was the alternative and is not available: redemption_events
 * .entitlementId is NOT NULL, and widening it would make "which voucher?"
 * unanswerable for the very rows this is meant to protect.
 */

const FKS = [
  { column: 'entitlementId', refTable: 'reward_entitlements', name: 'fk_rde_entitlement' },
  { column: 'redemptionId', refTable: 'redemptions', name: 'fk_rde_redemption' },
];

/** Drop whatever FK currently guards `column`, whatever Sequelize named it. */
async function dropExistingFk(q, column) {
  const [rows] = await q(`
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'redemption_events'::regclass
       AND contype = 'f'
       AND conkey = ARRAY[(
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'redemption_events'::regclass AND attname = '${column}'
       )]::smallint[]
  `);
  for (const row of rows) {
    await q(`ALTER TABLE redemption_events DROP CONSTRAINT "${row.conname}"`);
  }
}

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    for (const { column, refTable, name } of FKS) {
      await dropExistingFk(q, column);
      // NOT VALID → VALIDATE (migration 014): the rewrite of an existing FK
      // must not hold ACCESS EXCLUSIVE while it re-scans the table.
      await q(`
        ALTER TABLE redemption_events ADD CONSTRAINT "${name}"
        FOREIGN KEY ("${column}") REFERENCES "${refTable}"(id) ON DELETE RESTRICT NOT VALID
      `);
      await q(`ALTER TABLE redemption_events VALIDATE CONSTRAINT "${name}"`);
    }
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    for (const { column, refTable, name } of FKS) {
      await q(`ALTER TABLE redemption_events DROP CONSTRAINT IF EXISTS "${name}"`);
      await q(`
        ALTER TABLE redemption_events
        ADD CONSTRAINT "redemption_events_${column}_fkey"
        FOREIGN KEY ("${column}") REFERENCES "${refTable}"(id) ON DELETE CASCADE
      `);
    }
  });
}
