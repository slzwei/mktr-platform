/**
 * 102 — put the money/inventory invariants in the DATABASE (P1-8).
 *
 * `committedQuantity ≥ allocatedQuantity ≥ issuedQuantity ≥ redeemedQuantity`
 * is stated in RewardOffer.js and enforced only by application-level guarded
 * UPDATEs; `walletBalanceCents ≥ 0` likewise. Every one of those guards is
 * correct today, but they are the ONLY thing standing between a future code
 * path — a new admin tool, a backfill script, a psql session — and silently
 * over-issued inventory or a negative wallet. A CHECK constraint costs nothing
 * per write and cannot be forgotten by the next writer.
 *
 * The append-only ledger has the mirror problem: reward_inventory_events
 * declared activationId/entitlementId/redemptionId as bare UUIDs, no
 * references, no associations. That table is the reconciliation source of
 * truth (inventoryService.reconcile derives the counters from it), so a
 * dangling pointer there is an audit trail that cannot be re-walked. RESTRICT,
 * not CASCADE: an append-only record must never be silently erased by deleting
 * something it points at.
 *
 * Two-step, per migration 014: ADD ... NOT VALID takes only a SHARE ROW
 * EXCLUSIVE lock, then VALIDATE re-scans under SHARE UPDATE EXCLUSIVE so reads
 * and writes keep flowing. Note a NOT VALID constraint is ALREADY enforced for
 * new and updated rows — validation only concerns rows that predate it. So if
 * legacy data violates an invariant we log the offenders and leave the
 * constraint NOT VALID rather than failing the deploy: new writes are protected
 * either way, and a data-repair decision belongs to a human, not to a migration.
 */

const CHECKS = [
  {
    table: 'reward_offers',
    name: 'chk_reward_offers_quantity_ordering',
    expression: `"committedQuantity" >= "allocatedQuantity"
             AND "allocatedQuantity" >= "issuedQuantity"
             AND "issuedQuantity" >= "redeemedQuantity"
             AND "redeemedQuantity" >= 0`,
  },
  {
    table: 'activations',
    name: 'chk_activations_quantity_ordering',
    expression: `"allocatedQuantity" >= "issuedCount"
             AND "issuedCount" >= "redeemedCount"
             AND "redeemedCount" >= 0`,
  },
  {
    table: 'users',
    name: 'chk_users_wallet_balance_non_negative',
    expression: '"walletBalanceCents" >= 0',
  },
];

const LEDGER_FKS = [
  { column: 'activationId', refTable: 'activations', name: 'fk_rie_activation' },
  { column: 'entitlementId', refTable: 'reward_entitlements', name: 'fk_rie_entitlement' },
  { column: 'redemptionId', refTable: 'redemptions', name: 'fk_rie_redemption' },
];

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;
  const q = (sql) => sequelize.query(sql);
  const exists = async (name) => {
    const [rows] = await q(`SELECT 1 FROM pg_constraint WHERE conname = '${name}'`);
    return rows.length > 0;
  };

  // ── (a) Quantity ordering + non-negative wallet ────────────────────────────
  for (const { table, name, expression } of CHECKS) {
    if (!(await exists(name))) {
      await q(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression}) NOT VALID`);
    }

    const [offenders] = await q(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE NOT (${expression})`);
    const n = offenders[0]?.n ?? 0;
    if (n > 0) {
       
      console.warn(
        `[migration 102] ${table}: ${n} pre-existing row(s) violate ${name}. ` +
        'Constraint left NOT VALID — it already blocks new and updated rows; ' +
        'repair the legacy rows then run: ' +
        `ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}";`
      );
      continue;
    }
    await q(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"`);
  }

  // ── (b) Audit-ledger pointers become real references ───────────────────────
  for (const { column, refTable, name } of LEDGER_FKS) {
    if (!(await exists(name))) {
      await q(`
        ALTER TABLE reward_inventory_events ADD CONSTRAINT "${name}"
        FOREIGN KEY ("${column}") REFERENCES "${refTable}"(id) ON DELETE RESTRICT NOT VALID
      `);
    }

    const [orphans] = await q(`
      SELECT COUNT(*)::int AS n FROM reward_inventory_events e
       WHERE e."${column}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${refTable}" r WHERE r.id = e."${column}")
    `);
    const n = orphans[0]?.n ?? 0;
    if (n > 0) {
       
      console.warn(
        `[migration 102] reward_inventory_events.${column}: ${n} dangling pointer(s). ` +
        `Constraint left NOT VALID — new rows are checked. Repair, then: ` +
        `ALTER TABLE reward_inventory_events VALIDATE CONSTRAINT "${name}";`
      );
      continue;
    }
    await q(`ALTER TABLE reward_inventory_events VALIDATE CONSTRAINT "${name}"`);
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;
  const q = (sql) => sequelize.query(sql);

  for (const { name } of LEDGER_FKS) {
    await q(`ALTER TABLE reward_inventory_events DROP CONSTRAINT IF EXISTS "${name}"`);
  }
  for (const { table, name } of CHECKS) {
    await q(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
  }
}
