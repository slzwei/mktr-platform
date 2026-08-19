import { sequelize, Campaign } from '../models/index.js';
import { advisoryXactLock, withAdvisoryLock } from '../utils/advisoryLock.js';
import { logger } from '../utils/logger.js';

/**
 * touchpointService — cross-channel touchpoint history (ads-centralisation
 * §4). Append-only, session-keyed EVIDENCE rows for the allow-listed customer
 * surfaces; the joins against prospects."sessionId" are per-brand, same-
 * browser attribution hints, never identity truth.
 *
 * Concurrency contract (§4.3/§4.6): every beacon insert runs in ONE
 * transaction holding pg_advisory_xact_lock(hashtext('tp:' || sid)) — the
 * per-day cap count, the occurredAt stamp (clock_timestamp(), taken AFTER the
 * lock is granted), and the insert are atomic under it. The erased-session
 * sweep takes the SAME lock before re-deleting, so stamp-vs-delete is fully
 * serialized: any row stamped ≤ sweepUntil is caught by a later sweep pass;
 * rows stamped after the window are genuinely post-erasure anonymous data.
 */

function numEnv(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function touchpointsEnabled() {
  return process.env.TOUCHPOINTS_ENABLED === 'true';
}

const maxPerSessionDay = () => numEnv('TOUCHPOINTS_MAX_PER_SESSION_DAY', 50, 5, 500);
const retentionDays = () => numEnv('TOUCHPOINT_RETENTION_DAYS', 180, 7, 730);

/** Full referrer URL in, ORIGIN only out — the path/query never persist. */
export function referrerOriginOf(referrer) {
  if (!referrer || typeof referrer !== 'string') return null;
  try {
    return new URL(referrer).origin.slice(0, 255);
  } catch {
    return null;
  }
}

/**
 * Record ONE touchpoint under the per-sid lock: atomic 24h cap → campaign
 * existence check (a bogus uuid must not abort on the FK) → insert with the
 * server clock stamped inside the locked txn. Client timestamps are ignored
 * by construction — there is no timestamp parameter.
 */
export async function recordTouch({ sid, surface, landingPath, referrer, campaignId, utm = {}, clickIds = {} }) {
  return sequelize.transaction(async (t) => {
    await advisoryXactLock(t, `tp:${sid}`);
    const [cnt] = await sequelize.query(
      `SELECT count(*)::int AS n FROM touchpoints
        WHERE "sessionId" = :sid AND "createdAt" > now() - interval '24 hours'`,
      { replacements: { sid }, transaction: t }
    );
    if ((cnt?.[0]?.n ?? 0) >= maxPerSessionDay()) {
      return { recorded: false, skipped: 'capped' };
    }
    let campaignRow = null;
    if (campaignId) {
      campaignRow = await Campaign.findByPk(campaignId, { attributes: ['id'], transaction: t, raw: true });
    }
    // clock_timestamp(), NOT now(): now() is transaction-start time, which
    // predates the advisory-lock grant when the lock had to wait — the stamp
    // must postdate the lock for the sweep serialization argument to hold.
    const [rows] = await sequelize.query(
      `INSERT INTO touchpoints
         (id, "sessionId", "occurredAt", surface, "landingPath", "referrerOrigin", "campaignId",
          "utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent",
          fbclid, ttclid, gclid, gbraid, wbraid, "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid(), :sid, clock_timestamp(), :surface, :landingPath, :referrerOrigin, :campaignId,
          :utmSource, :utmMedium, :utmCampaign, :utmTerm, :utmContent,
          :fbclid, :ttclid, :gclid, :gbraid, :wbraid, clock_timestamp(), clock_timestamp())
       RETURNING id`,
      {
        replacements: {
          sid,
          surface,
          landingPath: landingPath || null,
          referrerOrigin: referrerOriginOf(referrer),
          campaignId: campaignRow?.id || null,
          utmSource: utm.utmSource || null,
          utmMedium: utm.utmMedium || null,
          utmCampaign: utm.utmCampaign || null,
          utmTerm: utm.utmTerm || null,
          utmContent: utm.utmContent || null,
          fbclid: clickIds.fbclid || null,
          ttclid: clickIds.ttclid || null,
          gclid: clickIds.gclid || null,
          gbraid: clickIds.gbraid || null,
          wbraid: clickIds.wbraid || null,
        },
        transaction: t,
      }
    );
    return { recorded: true, id: rows?.[0]?.id || null };
  });
}

/**
 * Consume the durable erased-session sweeps (§4.6): per sid, one transaction
 * taking the SAME per-sid lock the beacon insert holds, re-applying the
 * shared-session guard (a session shared with a SURVIVING prospect is never
 * swept), deleting rows stamped inside the window, and dropping the sweep row
 * in the same transaction once the window has passed.
 */
export async function consumeErasedSessionSweeps() {
  const [sweeps] = await sequelize.query(
    `SELECT "sessionId", "sweepUntil" FROM erased_session_sweeps LIMIT 500`
  );
  let deleted = 0;
  let dropped = 0;
  for (const s of sweeps || []) {
    try {
      await sequelize.transaction(async (t) => {
        await advisoryXactLock(t, `tp:${s.sessionId}`);
        const [, delMeta] = await sequelize.query(
          `DELETE FROM touchpoints tp
            WHERE tp."sessionId" = :sid
              AND tp."occurredAt" <= :sweepUntil
              AND NOT EXISTS (SELECT 1 FROM prospects p2 WHERE p2."sessionId" = :sid)`,
          { replacements: { sid: s.sessionId, sweepUntil: s.sweepUntil }, transaction: t }
        );
        deleted += delMeta?.rowCount ?? 0;
        const [, dropMeta] = await sequelize.query(
          `DELETE FROM erased_session_sweeps WHERE "sessionId" = :sid AND "sweepUntil" < now()`,
          { replacements: { sid: s.sessionId }, transaction: t }
        );
        dropped += dropMeta?.rowCount ?? 0;
      });
    } catch (err) {
      logger.warn({ sessionId: s.sessionId, error: err?.message || String(err) }, 'touchpoints.sweep_failed');
    }
  }
  return { sweeps: sweeps?.length ?? 0, deleted, dropped };
}

/** Retention purge (§4.6): rows older than TOUCHPOINT_RETENTION_DAYS, bounded batches. */
export async function purgeOldTouchpoints() {
  const days = retentionDays();
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const [, meta] = await sequelize.query(
      `DELETE FROM touchpoints WHERE id IN (
         SELECT id FROM touchpoints
          WHERE "occurredAt" < now() - make_interval(days => :days)
          LIMIT 1000)`,
      { replacements: { days } }
    );
    const n = meta?.rowCount ?? 0;
    total += n;
    if (n < 1000) break;
  }
  return total;
}

/**
 * The daily maintenance tick (offset 330s — §0 house cadences), advisory-
 * locked. Runs regardless of TOUCHPOINTS_ENABLED: erasure sweeps must drain
 * and retention must purge even after a rollback flip (§4.8 — rows inert +
 * purged).
 */
export async function runTouchpointMaintenance() {
  return withAdvisoryLock('tp:maintenance', async () => {
    const sweeps = await consumeErasedSessionSweeps();
    const purged = await purgeOldTouchpoints();
    if (sweeps.deleted || sweeps.dropped || purged) {
      logger.info({ ...sweeps, purged }, 'touchpoints.maintenance_tick');
    }
    return { ...sweeps, purged };
  });
}
