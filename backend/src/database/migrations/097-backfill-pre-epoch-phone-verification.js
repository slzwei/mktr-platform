/**
 * 097 — restore the OTP proof the server never wrote down.
 *
 * The public signup form has hard-gated submit on `otpState !== 'verified'`
 * since a9ea24d (2025-09-03), but the server only began PERSISTING
 * sourceMetadata.phoneVerifiedAt in 059bb1c (2026-07-09). Every browser signup
 * in between therefore reads back with no stamp — 131 rows in production — and
 * a missing stamp costs the lead reward eligibility, consumer-spine linking,
 * and (via the consent ledger's `verified`) marketing eligibility, while the
 * admin console labels them "phone unverified". They are not: they could not
 * have submitted the form otherwise.
 *
 * This is INFERENCE, not recovered proof, and it is labelled as such. No
 * server-side evidence survives — verificationService destroys the single-use
 * Verification row on a successful check — so every row written here carries
 * `phoneVerifiedSource: 'backfill_gate_inference'`. Nothing else in the
 * codebase writes that key, which makes the inferred rows greppable forever
 * and makes down() an exact reversal.
 *
 * Scope is deliberately narrow, and every predicate is load-bearing:
 *   - createdAt < the stamp epoch — later rows either have a real stamp or
 *     genuinely failed to earn one, and must not be laundered.
 *   - leadSource IN (website, referral) — the two that reach the OTP-gated
 *     form. call_bot is EXCLUDED on purpose: Retell leads never see a form,
 *     and for inbound calls prospect.phone is MKTR's own DDI, so a stamp there
 *     would assert control of our own number.
 *   - clientUserAgent AND eventSourceUrl present — browser-session evidence.
 *     A raw API POST can be captured as a lead without ever touching the form
 *     (prospectService says so explicitly), and those must not be stamped.
 *     In production all 131 in-scope rows carry both; the guard is what stops
 *     this from trusting leadSource alone.
 *   - no existing phoneVerifiedAt — a real stamp is never overwritten.
 *
 * phoneVerifiedAt is each row's OWN createdAt (the OTP passed moments before
 * that submit), not a single migration timestamp — a per-row honest value.
 * phoneVerifiedFor uses the same sha256(phone) recipe as the live writer, so a
 * later staff phone edit correctly invalidates the backfilled stamp too.
 *
 * Idempotent: the `NOT ... ? 'phoneVerifiedAt'` guard makes a re-run a no-op.
 * sourceMetadata is `json` (not jsonb), hence the ::jsonb round-trip.
 */

const STAMP_EPOCH = '2026-07-10T00:00:00Z';
const SOURCE = 'backfill_gate_inference';

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `UPDATE prospects
          SET "sourceMetadata" = (
                "sourceMetadata"::jsonb || jsonb_build_object(
                  'phoneVerifiedAt',
                    to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'phoneVerifiedFor',
                    encode(sha256(convert_to(phone, 'UTF8')), 'hex'),
                  'phoneVerifiedSource', :source
                )
              )::json,
              "updatedAt" = now()
        WHERE "createdAt" < :epoch::timestamptz
          AND "leadSource" IN ('website', 'referral')
          AND phone IS NOT NULL AND phone <> ''
          AND "sourceMetadata" IS NOT NULL
          AND NOT ("sourceMetadata"::jsonb ? 'phoneVerifiedAt')
          AND "sourceMetadata"::jsonb ? 'clientUserAgent'
          AND "sourceMetadata"::jsonb ? 'eventSourceUrl'`,
      { replacements: { epoch: STAMP_EPOCH, source: SOURCE }, transaction: t }
    );
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    // Exact reversal: only rows this migration authored carry the provenance
    // marker, so a genuinely-earned stamp can never be stripped by a rollback.
    await sequelize.query(
      `UPDATE prospects
          SET "sourceMetadata" = (
                ("sourceMetadata"::jsonb - 'phoneVerifiedAt' - 'phoneVerifiedFor' - 'phoneVerifiedSource')
              )::json,
              "updatedAt" = now()
        WHERE "sourceMetadata" IS NOT NULL
          AND "sourceMetadata"::jsonb ->> 'phoneVerifiedSource' = :source`,
      { replacements: { source: SOURCE }, transaction: t }
    );
  });
}
