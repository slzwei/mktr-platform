/**
 * 106 — one QR lifecycle truth: status and active can no longer disagree (M1).
 *
 * qr_tags carried TWO independent lifecycle fields: the status enum
 * ('active'|'inactive'|'archived', written by bulk activate/deactivate/
 * archive) and the active boolean (written by PUT and read by the PUBLIC slug
 * resolver + attribution). Bulk-deactivating a printed QR flipped status only
 * — the tag stayed publicly resolvable and kept recording scans after the
 * admin saw a successful deactivation. PUT {active:false} flipped the boolean
 * only — the authenticated /:id/scan path (status-gated) still accepted it.
 *
 * status is the canonical column (it alone can say 'archived'); active stays
 * as its dual-written mirror for API/frontend compatibility. This migration
 * reconciles the drifted rows and adds the CHECK that makes a future
 * contradiction unstorable.
 *
 * Reconciliation rule: a DEACTIVATION intent always wins. A row that either
 * side ever marked not-live goes (or stays) not-live — reactivating a QR the
 * admin believed dead is the one wrong answer.
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    // 1. PUT-deactivated rows: boolean said dead while status still said
    //    active — status follows the deactivation (NULL active counts as
    //    not-true: fail safe, never fail live).
    await q(`
      UPDATE qr_tags SET status = 'inactive'
       WHERE status = 'active' AND active IS NOT TRUE
    `);

    // 2. Everything else mirrors the canonical status (covers bulk-deactivated
    //    /archived rows whose boolean still said true, and legacy NULLs).
    await q(`
      UPDATE qr_tags SET active = (status = 'active')
       WHERE active IS DISTINCT FROM (status = 'active')
    `);

    // 3. The mirror is now total — no NULL third state.
    await q(`ALTER TABLE qr_tags ALTER COLUMN active SET NOT NULL`);
    await q(`ALTER TABLE qr_tags ALTER COLUMN active SET DEFAULT true`);

    // 4. Contradictions become unstorable. NOT VALID → VALIDATE (migration 014
    //    pattern) — the backfill above guarantees validation passes.
    await q(`
      ALTER TABLE qr_tags ADD CONSTRAINT ck_qr_tags_lifecycle_coherent
      CHECK ((status = 'active') = active) NOT VALID
    `);
    await q(`ALTER TABLE qr_tags VALIDATE CONSTRAINT ck_qr_tags_lifecycle_coherent`);
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });
    await q(`ALTER TABLE qr_tags DROP CONSTRAINT IF EXISTS ck_qr_tags_lifecycle_coherent`);
    await q(`ALTER TABLE qr_tags ALTER COLUMN active DROP NOT NULL`);
  });
}
