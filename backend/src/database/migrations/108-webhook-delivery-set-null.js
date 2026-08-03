/**
 * 108 — webhook delivery history survives subscriber deletion (M5).
 *
 * Migration 014 set webhook_deliveries.subscriberId to ON DELETE SET NULL,
 * but the column itself stayed NOT NULL — a contradiction Postgres resolves
 * by REJECTING the parent delete. Deleting any subscriber that ever received
 * a delivery therefore 500ed, and a used subscriber could not be retired.
 *
 * Policy (one truth across model, column, and FK): history SURVIVES — the
 * column becomes nullable and the FK is re-asserted as SET NULL so the test
 * schema (sync-built, then migration-replayed) carries the same rule as prod.
 * Admin listings LEFT JOIN the subscriber and retryDelivery already rejects
 * a delivery whose subscriber is gone.
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.query(
    'ALTER TABLE webhook_deliveries ALTER COLUMN "subscriberId" DROP NOT NULL'
  );

  // Re-assert the SET NULL rule idempotently (014's resetFK pattern) — the
  // sync-built test schema may carry a different generated constraint.
  const name = 'webhook_deliveries_subscriberId_fkey';
  await queryInterface.removeConstraint('webhook_deliveries', name).catch(() => {});
  await queryInterface
    .removeConstraint('webhook_deliveries', 'webhook_deliveries_subscriberId_webhook_subscribers_fk')
    .catch(() => {});
  await sequelize.query(`
    ALTER TABLE webhook_deliveries ADD CONSTRAINT "${name}"
    FOREIGN KEY ("subscriberId") REFERENCES webhook_subscribers(id)
    ON DELETE SET NULL NOT VALID
  `);
  await sequelize.query(
    `ALTER TABLE webhook_deliveries VALIDATE CONSTRAINT "${name}"`
  );
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;
  // Restore NOT NULL only after clearing orphans — the rows SET NULL created.
  await sequelize.query(
    'DELETE FROM webhook_deliveries WHERE "subscriberId" IS NULL'
  );
  await sequelize.query(
    'ALTER TABLE webhook_deliveries ALTER COLUMN "subscriberId" SET NOT NULL'
  );
}
