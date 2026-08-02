/**
 * 103 — commit-reveal on the draw seed (P2-8).
 *
 * `pickWinner` is a pure function of (seed, entries). The pool was already
 * committed at seal (poolHash), but the SEED was minted at draw time and used
 * immediately, with nothing committing it beforehand — so an operator could
 * re-mint and re-run the pick until it landed on a chosen entry, then persist
 * only that attempt. Nothing in the record would show the discarded rolls.
 *
 * The seed is now minted inside the one-way frozen→sealed transition and only
 * its hash is published as the commitment. Because the pool is committed by the
 * same statement, the winner is fixed at the seal instant: there is no later
 * moment to re-roll, and any substituted seed fails verifyDraw.
 *
 * Both columns are NULLABLE on purpose. Draws sealed before this existed keep
 * working — they mint at draw time as they always did, and verifyDraw reports
 * the missing commitment rather than implying a guarantee they never had.
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    await q('ALTER TABLE draws ADD COLUMN IF NOT EXISTS "seedCommitment" VARCHAR(64)');
    await q('ALTER TABLE draws ADD COLUMN IF NOT EXISTS "sealedSeed" VARCHAR(64)');

    await q(`COMMENT ON COLUMN draws."seedCommitment" IS
      'sha256(sealedSeed) — committed at seal, before any pick is computed (P2-8)'`);
    await q(`COMMENT ON COLUMN draws."sealedSeed" IS
      'The seed committed at seal and revealed at draw; every attempt must hash to seedCommitment'`);

    // NO BACKFILL, deliberately. Minting a seed now for an already-sealed draw
    // would manufacture a commitment that commits to nothing — the pick it
    // would "prove" was made under the old rules. An absent commitment is the
    // honest record, and verifyDraw says so explicitly.
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });
    await q('ALTER TABLE draws DROP COLUMN IF EXISTS "sealedSeed"');
    await q('ALTER TABLE draws DROP COLUMN IF EXISTS "seedCommitment"');
  });
}
