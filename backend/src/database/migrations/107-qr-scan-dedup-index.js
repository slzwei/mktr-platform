/**
 * 107 — supporting index for the per-scanner QR scan dedup window (M2).
 *
 * trackerService.recordScan now decides "duplicate?" with a windowed query on
 * (qrTagId, ipHash, ts) under a per-(tag, scanner) advisory lock — pre-fix it
 * compared only the tag's single most recent scan, so interleaved scanners
 * inflated uniqueScanCount and concurrent same-client scans raced past the
 * check. This index keeps that windowed lookup from scanning a hot tag's
 * whole history. Mirrored on the QrScan model (sync-before-migrations test
 * boot).
 */

export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_qr_scans_dedup_window
      ON qr_scans ("qrTagId", "ipHash", "ts")
  `);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'DROP INDEX IF EXISTS idx_qr_scans_dedup_window'
  );
}
