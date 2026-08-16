/**
 * Multi-winner draw engine (Phase 3) — prize units.
 *
 * A draw awards N prize UNITS instead of exactly one winner. The engine needs
 * three things this migration adds:
 *
 *  - `draws.prizes` / `draws.winnersCount` — a SNAPSHOT of what the campaign
 *    promised at createDraw, mirroring how closesAt/multiplier are already
 *    frozen. The engine must never re-read campaign JSON mid-flight: editing a
 *    campaign cannot be allowed to change what an in-flight draw is awarding.
 *  - `draws.algorithmVersion` — which selection algorithm ran, so historical
 *    draws replay under v1 (`sha256 mod`) forever while new draws use v2
 *    (domain-separated HMAC + rejection sampling). See utils/drawSelection.js.
 *  - `draw_attempts.prizeUnitIndex` — which unit an attempt is awarding.
 *
 * The DEFAULT 0 / DEFAULT 1 backfill is exactly right for every historical row:
 * a legacy draw has one unit and all of its attempts belong to that unit, and
 * every legacy draw ran the v1 algorithm. No data migration is required.
 *
 * The two partial unique indexes make the per-unit invariants UNSTORABLE rather
 * than merely checked — one pending and one claimed attempt per unit — which is
 * what stops two operators concurrently redrawing the same unit.
 */

export async function up(queryInterface, Sequelize) {
  const { sequelize } = queryInterface;

  await queryInterface.addColumn('draws', 'prizes', {
    type: Sequelize.JSONB,
    allowNull: true,
    comment: 'Snapshot of luckyDraw.prizes at createDraw; NULL = legacy single-prize draw',
  });

  await queryInterface.addColumn('draws', 'winnersCount', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: 'Number of prize units this draw awards (Σqty at createDraw)',
  });

  await queryInterface.addColumn('draws', 'algorithmVersion', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '1 = legacy sha256-mod single winner, 2 = domain-separated derivation',
  });

  await queryInterface.addColumn('draw_attempts', 'prizeUnitIndex', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Which prize unit this attempt is awarding (0-based)',
  });

  // Bounds — a unit index outside the draw's promised range is meaningless and
  // would break the verifier's structural replay.
  await sequelize.query(`
    ALTER TABLE draws
      ADD CONSTRAINT chk_draws_winners_count
      CHECK ("winnersCount" >= 1 AND "winnersCount" <= 1000)
  `);
  await sequelize.query(`
    ALTER TABLE draw_attempts
      ADD CONSTRAINT chk_da_prize_unit_index
      CHECK ("prizeUnitIndex" >= 0 AND "prizeUnitIndex" < 1000)
  `);

  // At most ONE pending and ONE claimed attempt per unit. Concurrent redraws of
  // the same unit lose here rather than double-awarding a prize.
  await sequelize.query(`
    CREATE UNIQUE INDEX uq_da_one_pending_per_unit
      ON draw_attempts ("drawId", "prizeUnitIndex")
      WHERE outcome = 'pending'
  `);
  await sequelize.query(`
    CREATE UNIQUE INDEX uq_da_one_claimed_per_unit
      ON draw_attempts ("drawId", "prizeUnitIndex")
      WHERE outcome = 'claimed'
  `);

  // One entry can hold at most one LIVE award across the whole draw — the
  // storage-level backstop for "each verified mobile number can win at most one
  // prize". The engine also enforces this via a global exclusion set; this
  // index is what makes it unstorable under a concurrent redraw.
  await sequelize.query(`
    CREATE UNIQUE INDEX uq_da_one_live_award_per_entry
      ON draw_attempts ("drawId", "pickedEntryId")
      WHERE outcome IN ('pending', 'claimed')
  `);
}

export async function down(queryInterface) {
  const { sequelize } = queryInterface;
  await sequelize.query('DROP INDEX IF EXISTS uq_da_one_live_award_per_entry');
  await sequelize.query('DROP INDEX IF EXISTS uq_da_one_claimed_per_unit');
  await sequelize.query('DROP INDEX IF EXISTS uq_da_one_pending_per_unit');
  await sequelize.query('ALTER TABLE draw_attempts DROP CONSTRAINT IF EXISTS chk_da_prize_unit_index');
  await sequelize.query('ALTER TABLE draws DROP CONSTRAINT IF EXISTS chk_draws_winners_count');
  await queryInterface.removeColumn('draw_attempts', 'prizeUnitIndex');
  await queryInterface.removeColumn('draws', 'algorithmVersion');
  await queryInterface.removeColumn('draws', 'winnersCount');
  await queryInterface.removeColumn('draws', 'prizes');
}
