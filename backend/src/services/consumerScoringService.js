import { sequelize, EnrichmentScoringConfig } from '../models/index.js';
import { withConsumerLock, ErasedConsumerError } from './enrichmentFence.js';
import { resolveCurrentFacts } from '../utils/factResolver.js';
import { canonicalJson, sha256 } from './factMapperService.js';
import {
  scoreConsumer, normalizeConfig, DEFAULT_SCORING_CONFIG, SCORING_ALGORITHM_VERSION,
} from '../utils/consumerScoring.js';
import { logger } from '../utils/logger.js';

/**
 * Consumer scoring service — the I/O half of Phase C
 * (docs/plans/consumer-profile-enrichment.md §7).
 *
 * The math lives in utils/consumerScoring.js (pure, no I/O). This file does
 * exactly three things: gather the inputs, decide whether a re-score is
 * warranted, and write the result behind the erasure fence.
 *
 * OBSERVATIONS ARE PROSPECT-ANCHORED (§2). The mapper writes
 * `sourceProspectId` and never `consumerId`, because the spine reconciler
 * relinks prospects between consumers without locking either one — anchoring
 * to the prospect and joining through `prospects.consumerId` means a relink
 * moves the facts with the person automatically. Manual facts (PR 3) are
 * consumer-anchored instead, so the load is the union of both legs.
 *
 * WHY A HASH AND NOT A DIRTY BIT. `inputVersion`/`syncedInputVersion` is the
 * SYNTHESIS dirtiness protocol (§6.3) — it drives the expensive AI call.
 * Scoring is cheap and deterministic, so it uses a content hash instead: if
 * the resolved facts, the telemetry, the config version and the algorithm
 * version are all unchanged, the output provably cannot differ and we skip
 * the write. That also gives §7.1's "config change ⇒ full recompute" for
 * free — bumping the config version changes the hash for everyone at once.
 *
 * NULL IS A RESULT, NOT A FAILURE. An unscoreable consumer still gets
 * `scoredConfigVersion`/`scoringAlgorithmVersion`/`scoreInputHash` stamped
 * (§7.1, R3 #11). Without the stamp the sweep would re-examine the same
 * unscoreable people every night forever.
 */

/** Scoring writes flag — read at call time (restart-to-flip), default OFF. */
export function scoringEnabled() {
  return process.env.ENRICHMENT_SCORING_ENABLED === 'true';
}

// Config is append-only and changes at most a few times a year; a short TTL
// keeps a sweep of thousands of consumers from re-reading it per row while
// still picking up a new calibration within the same night.
const CONFIG_TTL_MS = 60_000;
let configCache = null;

export function _resetConfigCache() {
  configCache = null;
}

/**
 * Highest-versioned config row wins (§7.2). An empty table is legitimate on
 * a fresh database that hasn't run 093 yet — fall back to the code defaults
 * at version 0 so scoring degrades to "works, unstamped" rather than
 * crashing the sweep.
 */
export async function getActiveScoringConfig({ now = Date.now() } = {}) {
  if (configCache && now - configCache.loadedAt < CONFIG_TTL_MS) return configCache.value;

  let row = null;
  try {
    row = await EnrichmentScoringConfig.findOne({ order: [['version', 'DESC']] });
  } catch (err) {
    logger.warn('[consumerScoring] config read failed — using defaults', { error: err.message });
  }

  const value = row
    ? { version: row.version, config: normalizeConfig(row.configJson) }
    : { version: 0, config: normalizeConfig(DEFAULT_SCORING_CONFIG) };

  configCache = { value, loadedAt: now };
  return value;
}

/**
 * Every observation that speaks for this consumer: prospect-joined ∪
 * consumer-anchored, superseded/retracted rows included so the resolver can
 * apply its own precedence (it filters them itself — §3.4).
 */
export async function loadObservations(consumerId) {
  const [rows] = await sequelize.query(
    `SELECT o.id, o.key, o.value, o.confidence, o.source, o."sourceEventAt",
            o."supersededAt", o."retractedAt"
       FROM consumer_observations o
       JOIN prospects p ON p.id = o."sourceProspectId"
      WHERE p."consumerId" = :cid
      UNION
     SELECT o.id, o.key, o.value, o.confidence, o.source, o."sourceEventAt",
            o."supersededAt", o."retractedAt"
       FROM consumer_observations o
      WHERE o."consumerId" = :cid`,
    { replacements: { cid: consumerId } }
  );
  return rows;
}

/**
 * Behavioral inputs for the Meet half. All of it is derived from tables the
 * spine already maintains — none of it needs the person to answer anything,
 * which is why Meet stays scoreable when the fact ledger is empty.
 */
export async function loadTelemetry(consumerId) {
  const [[row]] = await sequelize.query(
    `SELECT c."signupCount", c."verifiedSignupCount", c."lastSeenAt",
            (c.email IS NOT NULL AND c.email <> '') AS "hasEmail",
            EXISTS (
              SELECT 1 FROM consent_events ce
               WHERE ce."consumerId" = c.id AND ce.kind = 'marketing'
                 AND ce.granted = true
                 AND ce."occurredAt" = (
                   SELECT MAX(ce2."occurredAt") FROM consent_events ce2
                    WHERE ce2."consumerId" = c.id AND ce2.kind = 'marketing'
                 )
            ) AS "marketingConsent",
            EXISTS (
              SELECT 1 FROM wa_message_statuses w
               WHERE w."recipientHash" = c."phoneHash"
                 AND w.status IN ('delivered', 'read')
            ) AS "whatsappReachable"
       FROM consumers c
      WHERE c.id = :cid`,
    { replacements: { cid: consumerId } }
  );
  if (!row) return null;
  return {
    signupCount: Number(row.signupCount) || 0,
    verifiedSignupCount: Number(row.verifiedSignupCount) || 0,
    lastSeenAt: row.lastSeenAt,
    hasEmail: Boolean(row.hasEmail),
    marketingConsent: Boolean(row.marketingConsent),
    whatsappReachable: Boolean(row.whatsappReachable),
  };
}

/**
 * The hash that decides whether a re-score is needed. Built from the
 * RESOLVED facts (not the raw rows) so that a superseded duplicate or a
 * re-ordered query result — neither of which can change the output — does
 * not force a pointless rewrite.
 */
export function computeScoreInputHash({ facts, telemetry, configVersion, algorithmVersion }) {
  const factDigest = Object.keys(facts).sort().map((k) => ({
    k,
    v: facts[k].value,
    c: facts[k].confidence,
    s: facts[k].source,
  }));
  return sha256(canonicalJson({
    f: factDigest,
    t: telemetry,
    cv: configVersion,
    av: algorithmVersion,
  }));
}

/**
 * Score one consumer and persist the result.
 *
 * @returns {{status:'scored'|'unchanged'|'skipped', reason?:string,
 *            meetScore?:number|null, buyScore?:number|null, consumerScore?:number|null}}
 */
export async function scoreOneConsumer(consumerId, { force = false, now = Date.now() } = {}) {
  const { version: configVersion, config } = await getActiveScoringConfig({ now });
  const algorithmVersion = config.algorithmVersion || SCORING_ALGORITHM_VERSION;

  const telemetry = await loadTelemetry(consumerId);
  if (!telemetry) return { status: 'skipped', reason: 'consumer_gone' };

  const observations = await loadObservations(consumerId);
  const facts = resolveCurrentFacts(observations);
  const inputHash = computeScoreInputHash({ facts, telemetry, configVersion, algorithmVersion });

  const result = scoreConsumer({ facts, telemetry, config, now });

  try {
    return await withConsumerLock(consumerId, async (t) => {
      // Re-read under the lock: another sweep worker may have scored this
      // consumer between our read and our write.
      const [[current]] = await sequelize.query(
        `SELECT "scoreInputHash", "scoredConfigVersion", "scoringAlgorithmVersion"
           FROM consumer_profiles WHERE "consumerId" = :cid FOR UPDATE`,
        { replacements: { cid: consumerId }, transaction: t }
      );

      const alreadyCurrent = current
        && current.scoreInputHash === inputHash
        && current.scoredConfigVersion === configVersion
        && current.scoringAlgorithmVersion === algorithmVersion;

      if (alreadyCurrent && !force) {
        return { status: 'unchanged', reason: 'input_hash_match' };
      }

      // UPSERT guarded on a live consumer — scoring must never resurrect a
      // profile row for someone erased between the fence and this write.
      await sequelize.query(
        `INSERT INTO consumer_profiles
           ("consumerId", "consumerScore", "meetScore", "buyScore", "scoreBreakdown",
            "scoredConfigVersion", "scoringAlgorithmVersion", "scoreInputHash",
            "scoreComputedAt", "inputVersion", "syncedInputVersion", "createdAt", "updatedAt")
         SELECT c.id, :consumerScore, :meetScore, :buyScore, :breakdown::jsonb,
                :configVersion, :algorithmVersion, :inputHash, now(), 0, 0, now(), now()
           FROM consumers c
          WHERE c.id = :cid AND c."erasedAt" IS NULL
         ON CONFLICT ("consumerId") DO UPDATE SET
           "consumerScore" = EXCLUDED."consumerScore",
           "meetScore" = EXCLUDED."meetScore",
           "buyScore" = EXCLUDED."buyScore",
           "scoreBreakdown" = EXCLUDED."scoreBreakdown",
           "scoredConfigVersion" = EXCLUDED."scoredConfigVersion",
           "scoringAlgorithmVersion" = EXCLUDED."scoringAlgorithmVersion",
           "scoreInputHash" = EXCLUDED."scoreInputHash",
           "scoreComputedAt" = EXCLUDED."scoreComputedAt",
           "updatedAt" = now()`,
        {
          replacements: {
            cid: consumerId,
            consumerScore: result.consumerScore,
            meetScore: result.meetScore,
            buyScore: result.buyScore,
            breakdown: JSON.stringify(result.breakdown),
            configVersion,
            algorithmVersion,
            inputHash,
          },
          transaction: t,
        }
      );

      return {
        status: 'scored',
        meetScore: result.meetScore,
        buyScore: result.buyScore,
        consumerScore: result.consumerScore,
      };
    });
  } catch (err) {
    if (err instanceof ErasedConsumerError) return { status: 'skipped', reason: 'erased' };
    throw err;
  }
}

/**
 * Consumers whose score is stale: never scored, scored by a superseded
 * config, or scored by an older algorithm build. Ordered oldest-first so a
 * budgeted sweep makes uniform progress instead of re-treading the same head
 * of the table every night.
 *
 * Hash-level staleness (facts changed, config didn't) is NOT detectable in
 * SQL — that is what the budgeted repair rotation in the sweep is for: it
 * re-examines everyone on a cycle and the hash check makes the no-op cheap.
 */
export async function findStaleConsumerIds({ configVersion, algorithmVersion, limit = 200, afterId = null }) {
  const [rows] = await sequelize.query(
    `SELECT c.id
       FROM consumers c
       LEFT JOIN consumer_profiles cp ON cp."consumerId" = c.id
      WHERE c."erasedAt" IS NULL
        AND (:afterId::uuid IS NULL OR c.id > :afterId::uuid)
        AND (
          cp."consumerId" IS NULL
          OR cp."scoredConfigVersion" IS DISTINCT FROM :configVersion
          OR cp."scoringAlgorithmVersion" IS DISTINCT FROM :algorithmVersion
        )
      ORDER BY c.id
      LIMIT :limit`,
    { replacements: { configVersion, algorithmVersion, limit, afterId } }
  );
  return rows.map((r) => r.id);
}

/**
 * Consumers to re-examine on the repair rotation, walking the id space from
 * a durable cursor. Used when nothing is config-stale but facts may have
 * moved under a still-current config.
 */
export async function findConsumerIdsAfter({ afterId = null, limit = 200 }) {
  const [rows] = await sequelize.query(
    `SELECT id FROM consumers
      WHERE "erasedAt" IS NULL
        AND (:afterId::uuid IS NULL OR id > :afterId::uuid)
      ORDER BY id
      LIMIT :limit`,
    { replacements: { afterId, limit } }
  );
  return rows.map((r) => r.id);
}
