/**
 * 070 — Append-only wallet ledger (the audit truth for agent credits).
 *
 * Every balance mutation writes exactly one row here, in the SAME transaction
 * as the users.walletBalanceCents update (071). No UPDATE/DELETE path exists
 * by design. agentId is ON DELETE RESTRICT: financial history blocks user
 * hard-deletion (userService pre-checks give the friendly 409).
 *
 * Unique partial indexes are the double-spend guards:
 *  - one 'takedown_refund' per assignment (double-archive race)
 *  - one 'topup' per payment (HitPay webhook replay)
 * camelCase DDL. Guarded/idempotent. NOTE: no updatedAt — the WalletLedger
 * model sets timestamps:false with an explicit createdAt.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agentId" UUID NOT NULL REFERENCES users("id") ON DELETE RESTRICT,
      "type" VARCHAR(24) NOT NULL,
      "amountCents" INTEGER NOT NULL,
      "balanceAfterCents" INTEGER NOT NULL,
      "paymentId" UUID REFERENCES payments("id") ON DELETE SET NULL,
      "assignmentId" UUID REFERENCES lead_package_assignments("id") ON DELETE SET NULL,
      "campaignId" UUID REFERENCES campaigns("id") ON DELETE SET NULL,
      "note" TEXT,
      "createdBy" UUID REFERENCES users("id") ON DELETE SET NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_wallet_ledger_agent_created ON wallet_ledger ("agentId", "createdAt")'
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_refund_assignment
       ON wallet_ledger ("assignmentId") WHERE "type" = 'takedown_refund'`
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_topup_payment
       ON wallet_ledger ("paymentId") WHERE "type" = 'topup'`
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS wallet_ledger');
}
