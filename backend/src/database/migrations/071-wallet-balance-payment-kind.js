/**
 * 071 — Fast-read wallet balance + Payment kind discriminator.
 *
 * users.walletBalanceCents is the denormalized read of the wallet_ledger
 * (070) — maintained atomically in the same transaction as every ledger
 * insert, with a >= 0 guard in the UPDATE itself.
 *
 * payments.kind branches HitPay checkout/settlement between the existing
 * package purchase and the new wallet top-up (top-ups carry no package;
 * settlement credits the wallet inside the same locked transaction).
 * camelCase DDL. Guarded/idempotent.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS "walletBalanceCents" INTEGER NOT NULL DEFAULT 0'
  );
  await queryInterface.sequelize.query(
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS \"kind\" VARCHAR(24) NOT NULL DEFAULT 'package_purchase'"
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS "walletBalanceCents"');
  await queryInterface.sequelize.query('ALTER TABLE payments DROP COLUMN IF EXISTS "kind"');
}
