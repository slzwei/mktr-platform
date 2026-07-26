/**
 * 098 — the consent ledger's `verified` annotation, corrected by APPEND.
 *
 * Migration 081 derived ledger rows from prospects with
 * `verified = phoneVerificationIsCurrent(p)`. For every pre-2026-07-09 signup
 * that was false — not because the lead skipped OTP, but because the server
 * did not yet persist the stamp (see 097). `verified` is what mints marketing
 * authority: canMarketTo requires `granted === true && verified === true`, and
 * its docstring is unambiguous that every marketing send and audience upload
 * goes through it. So 129 people who ticked the box and passed OTP are
 * currently unmarketable on a technicality of our own record-keeping.
 *
 * 097 fixed the prospects, but it cannot fix these rows: backfillConsentEvents
 * skips nothing and re-derives correctly, yet `uq_ce_backfill` (prospectId,
 * kind) + ignoreDuplicates makes a healing rerun a DB no-op. The stale
 * annotation would sit there forever.
 *
 * WHY APPEND AND NOT UPDATE. consent_events is append-only — the model says
 * "Never UPDATE or DELETE rows" — because it is the evidentiary record of what
 * a person agreed to and when. That invariant holds even when the row is ours
 * to correct, so this writes a NEW event per affected row and leaves the
 * original intact and auditable.
 *
 * The correction carries the ORIGINAL `occurredAt`. That is the load-bearing
 * detail. Both readers (getConsentState and getMarketableGrantMap) order by
 * `occurredAt DESC, createdAt DESC, id DESC`, so preserving occurredAt means
 * the correction beats exactly one row — its own twin, on the later createdAt
 * — and can never leapfrog a genuinely later act. An unsubscribe recorded
 * after the original grant still wins, which is the whole reason not to date
 * these `now()`. It also keeps the ledger honest about WHEN consent was given:
 * this is a correction to evidence about a past act, not a new act.
 *
 * `granted` is COPIED, never set. The two `granted = false` contact rows in
 * production are deliberately untouched: a denial is a denial whether or not
 * the phone was verified, the flag is inert there, and appending anything to
 * an opted-out person's ledger is precisely what one does not do.
 *
 * source = 'admin' because chk_ce_source admits no 'correction' value and
 * widening a compliance constraint to label one backfill is a bad trade;
 * metadata carries the real provenance (`correctionOf` + reason + migration),
 * which is also the idempotency key and what down() matches on.
 *
 * Scope is keyed to `phoneVerifiedSource = 'backfill_gate_inference'` — the
 * marker 097 writes — so this can only ever touch rows whose prospect that
 * migration stamped. Prod dry run: 319 corrections (131 campaign_terms + 129
 * contact + 59 third_party), 2 denials skipped.
 */

const CORRECTION_REASON = 'phone_verification_backfill';
const MIGRATION_TAG = '098';

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `INSERT INTO consent_events (
         id, "consumerId", "prospectId", "campaignId", kind, granted, channels,
         version, source, "sourceUrl", verified, "actorUserId", metadata,
         "occurredAt", "createdAt", "updatedAt"
       )
       SELECT gen_random_uuid(), ce."consumerId", ce."prospectId", ce."campaignId",
              ce.kind, ce.granted, ce.channels, ce.version, 'admin', ce."sourceUrl",
              TRUE, NULL,
              COALESCE(ce.metadata, '{}'::jsonb) || jsonb_build_object(
                'correctionOf', ce.id::text,
                'reason', :reason,
                'migration', :tag
              ),
              ce."occurredAt", now(), now()
         FROM consent_events ce
         JOIN prospects p ON p.id = ce."prospectId"
        WHERE ce.source = 'backfill'
          AND ce.verified = FALSE
          AND ce.granted = TRUE
          AND p."sourceMetadata" IS NOT NULL
          AND p."sourceMetadata"::jsonb ->> 'phoneVerifiedSource' = 'backfill_gate_inference'
          AND NOT EXISTS (
            SELECT 1 FROM consent_events x
             WHERE x.metadata ->> 'correctionOf' = ce.id::text
          )`,
      { replacements: { reason: CORRECTION_REASON, tag: MIGRATION_TAG }, transaction: t }
    );
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    // Removes only the events this migration authored — they are the only rows
    // carrying the tag. The originals were never modified, so the ledger
    // returns exactly to its prior state.
    await sequelize.query(
      `DELETE FROM consent_events
        WHERE source = 'admin'
          AND metadata ->> 'migration' = :tag
          AND metadata ->> 'reason' = :reason`,
      { replacements: { reason: CORRECTION_REASON, tag: MIGRATION_TAG }, transaction: t }
    );
  });
}
