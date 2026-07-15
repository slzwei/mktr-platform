/**
 * 073 — Backfill discovery_runs.rawPayload.searchTerms for pre-existing Maps runs.
 *
 * The fired search terms were previously only written to the `discovery.run_started`
 * audit event. The Recent Searches list and the results query bar now read them from
 * rawPayload, so copy them across for historical Maps runs (IG runs already snapshot
 * their hashtags). The `||` merge preserves any existing keys (e.g. a result-quota
 * dailyUsageReservation). UPDATE-only and idempotent — the guard skips runs that
 * already carry searchTerms, so re-running is a no-op.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    UPDATE discovery_runs r
    SET "rawPayload" = COALESCE(r."rawPayload", '{}'::jsonb)
      || jsonb_build_object('searchTerms', a."after"->'searchTerms')
    FROM redeem_ops_audit_events a
    WHERE a."entityId" = r.id
      AND a.action = 'discovery.run_started'
      AND jsonb_typeof(a."after"->'searchTerms') = 'array'
      AND r.provider = 'apify_google_maps'
      AND NOT (COALESCE(r."rawPayload", '{}'::jsonb) ? 'searchTerms');
  `);
}

export async function down() {
  // No-op: the backfilled key is indistinguishable from a natively-captured one,
  // so a down-migration can't safely tell which searchTerms to drop.
}
