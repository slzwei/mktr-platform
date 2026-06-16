/**
 * Add `targetHost` to `qr_tags` — records which customer host was baked into the
 * QR image at generation time ('redeem' | 'mktr'). Lets the admin display the
 * correct tracker URL and detect drift when a campaign's customerHost later
 * changes (the PNG/SVG freeze the host at generation time).
 *
 *   - Nullable. NULL = legacy/unspecified, treated as 'redeem' (the pre-feature
 *     default — every existing QR was generated against PUBLIC_BASE_URL=redeem.sg).
 *   - Backfilled to 'redeem' for existing rows so display is truthful immediately.
 *     We deliberately do NOT infer the baked host from current campaign state.
 *   - camelCase column to match the qr_tags convention (campaignId, qrImageUrl…);
 *     maps directly to model field `QrTag.targetHost`.
 *
 * Additive nullable column — instant on any table size, safe rollback.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface
    .addColumn('qr_tags', 'targetHost', {
      type: Sequelize.DataTypes.STRING(16),
      allowNull: true,
      comment: "Customer host baked into the QR image: 'redeem' | 'mktr'. NULL = legacy (treated as redeem).",
    })
    .catch(() => {});

  // Backfill existing rows to redeem (all current QRs were baked against
  // PUBLIC_BASE_URL=redeem.sg). Idempotent — only touches NULL rows.
  await queryInterface.sequelize
    .query(`UPDATE "qr_tags" SET "targetHost" = 'redeem' WHERE "targetHost" IS NULL`)
    .catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('qr_tags', 'targetHost').catch(() => {});
}
