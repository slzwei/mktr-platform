/**
 * 096 — durable OTP-verification markers.
 *
 * `sourceMetadata.phoneVerifiedAt` is written at capture iff verifiedPhoneStore
 * holds a live marker for the number, and Redeem Ops issuance refuses to mint
 * reward value without that stamp. But the store is an in-process Map with a
 * 10-minute TTL, so a redeploy between "verified" and "submit" — or a lead who
 * spends eleven minutes on the rest of the form — silently costs a lead their
 * reward eligibility forever, with the console then reporting them as "phone
 * unverified". This table makes the proof survive both.
 *
 * Hash-keyed, never the raw number (same recipe as phoneVerifiedFor), so the
 * table stays a pure lookup and PDPA erasure has exactly one row to delete.
 * `verifiedAt` is what the read window is measured against; the marker is
 * upserted on every successful check, so re-verifying always refreshes it.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS phone_verification_markers (
    "phoneHash" VARCHAR(64) PRIMARY KEY,
    "verifiedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // Retention sweeps delete by age; the PK covers every read path.
  await q(`CREATE INDEX IF NOT EXISTS idx_pvm_verified_at
    ON phone_verification_markers ("verifiedAt")`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP TABLE IF EXISTS phone_verification_markers');
}
