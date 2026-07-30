import { sequelize } from '../models/index.js';
import { withConsumerLock, ErasedConsumerError } from './enrichmentFence.js';
import { resolveCurrentFacts } from '../utils/factResolver.js';
import { canonicalJson, sha256 } from './factMapperService.js';
import {
  scoreConsumer, normalizeConfig, DEFAULT_SCORING_CONFIG, SCORING_ALGORITHM_VERSION,
} from '../utils/consumerScoring.js';
import { briefProductKey } from '../utils/campaignBrief.js';
import {
  cacheKeyFor, readScoringConfigCache, writeScoringConfigCache, _resetScoringConfigCache,
} from './scoringConfigCache.js';
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

/**
 * The consent kind that means "may we market to them".
 *
 * EXPORTED so a test can assert it against ConsentEvent's own enum. It shipped
 * as `'marketing'` — a kind that has never existed — which silently made
 * marketingConsent false for every person in production. A bare literal inside
 * a SQL string is unverifiable by any test that doesn't hit the database with
 * the right fixture; a named export is checkable for free.
 */
export const MARKETING_CONSENT_KIND = 'contact';

/**
 * The per-resolution-entry cache lives in its own leaf module
 * (services/scoringConfigCache.js) because `campaignService` has to bust it
 * too and must not import this file's model/fence/resolver chain to do so.
 * Re-exported here so the busting contract has one documented door.
 */
export { bustScoringConfigCache } from './scoringConfigCache.js';

export function _resetConfigCache() {
  _resetScoringConfigCache();
}

/**
 * Resolution, in one query (§9): campaign → product → global, taking the
 * highest APPROVED version at the FIRST tier that matches.
 *
 * `status = 'approved'` is the whole point of §8.3: before migration 100 the
 * reader took the highest version outright, so an AI proposal inserted into
 * this table would have been LIVE within one cache TTL, before anyone read it.
 *
 * The tier CASE plus `ORDER BY tier, version DESC` is the resolution order
 * itself — a campaign row always beats a product row, which always beats
 * global, regardless of which has the higher version. Each disjunct is served
 * by its own partial index from migration 100.
 */
const RESOLVE_SQL = `
  SELECT e.version, e."configJson", e."campaignId", e."productKey",
         e."activatedAt", e."actorUserId",
         CASE WHEN e."campaignId" IS NOT NULL THEN 1
              WHEN e."productKey" IS NOT NULL THEN 2
              ELSE 3 END AS tier
    FROM enrichment_scoring_configs e
   WHERE e.status = 'approved'
     AND ( e."campaignId" = :campaignId
        OR e."productKey" = :productKey
        OR (e."campaignId" IS NULL AND e."productKey" IS NULL) )
   ORDER BY tier ASC, e.version DESC
   LIMIT 1`;

/** The product this campaign's leads score under, or null. */
async function loadCampaignProductKey(campaignId, { transaction } = {}) {
  const [[row]] = await sequelize.query(
    'SELECT "targetAudience" FROM campaigns WHERE id = :cid',
    { replacements: { cid: campaignId }, transaction }
  );
  return briefProductKey(row?.targetAudience);
}

/**
 * The EDITOR's resolver (campaign-scoring-editor §4.2): the same walk as
 * getActiveScoringConfig with every kindness stripped. Direct DB — no cache
 * read, no cache write — and a read failure THROWS instead of dressing code
 * defaults up as an answer: an admin about to edit from this baseline must
 * never be seeded from defaults while a real configuration exists behind a
 * query hiccup. `version: 0` therefore means the table GENUINELY resolves to
 * nothing at this scope, which is the legitimate house-default baseline.
 *
 * Returns the winner's RAW `configJson` beside the normalized one — §4.1's
 * composition base — plus the activation metadata the panel captions.
 * `transaction` exists for §4.5: approve re-runs this under its advisory lock
 * so the expectedLiveVersion comparison reads the same snapshot it writes.
 */
export async function resolveScoringConfigStrict({
  campaignId = null, productKey = null, transaction,
} = {}) {
  const product = campaignId
    ? await loadCampaignProductKey(campaignId, { transaction })
    : productKey;
  const [rows] = await sequelize.query(RESOLVE_SQL, {
    replacements: { campaignId, productKey: product },
    transaction,
  });
  const row = rows[0] || null;
  if (!row) {
    return {
      version: 0,
      scope: 'default',
      config: normalizeConfig(DEFAULT_SCORING_CONFIG),
      raw: {},
      activatedAt: null,
      actorUserId: null,
    };
  }
  return {
    version: row.version,
    scope: row.campaignId ? 'campaign' : row.productKey ? 'product' : 'global',
    config: normalizeConfig(row.configJson),
    raw: row.configJson,
    activatedAt: row.activatedAt,
    actorUserId: row.actorUserId,
  };
}

/**
 * The config that scores a given subject.
 *
 * Called with NO scope (the person grain, and the sweep's own staleness
 * bookkeeping) it resolves the GLOBAL row — today's behaviour, deliberately
 * unchanged. A consumer spans campaigns, so there is no campaign to key off;
 * picking one of their leads' campaigns would be arbitrary, and the person's
 * numbers are a projection of the winning lead anyway (§4), whose own stamp
 * records the config that actually produced them.
 *
 * Called with `{ campaignId }` (the lead grain) it walks the full chain.
 *
 * An empty table is legitimate on a fresh database that hasn't run 093 — fall
 * back to the code defaults at version 0 so scoring degrades to "works,
 * unstamped" rather than crashing the sweep.
 */
export async function getActiveScoringConfig({
  now = Date.now(), campaignId = null, productKey = null,
} = {}) {
  const cacheKey = cacheKeyFor({ campaignId, productKey });
  const hit = readScoringConfigCache(cacheKey, now);
  if (hit) return hit;

  let row = null;
  try {
    // A campaign entry point resolves its own product; a caller that already
    // knows the product (the simulator) passes it directly.
    const product = campaignId ? await loadCampaignProductKey(campaignId) : productKey;
    const [rows] = await sequelize.query(RESOLVE_SQL, {
      replacements: { campaignId, productKey: product },
    });
    row = rows[0] || null;
  } catch (err) {
    logger.warn('[consumerScoring] config read failed — using defaults', { error: err.message });
  }

  const value = row
    ? {
      version: row.version,
      config: normalizeConfig(row.configJson),
      // Which tier won. Callers do not branch on it; it is what makes a
      // support question ("why did this lead score like that?") answerable
      // without re-deriving the resolution by hand.
      scope: row.campaignId ? 'campaign' : row.productKey ? 'product' : 'global',
    }
    : { version: 0, config: normalizeConfig(DEFAULT_SCORING_CONFIG), scope: 'default' };

  writeScoringConfigCache(cacheKey, value, now);
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
    `SELECT c."signupCount", c."verifiedSignupCount",
            -- Engagement recency anchors to the NEWEST signup, not lastSeenAt.
            -- lastSeenAt refreshes on spine touches that are per-campaign
            -- RESPONSES, and the capability-vs-response contract (§16 B1 of
            -- per-campaign-lead-scoring.md) forbids a response on one campaign
            -- from moving the person's standing everywhere. "Newest" is
            -- (createdAt DESC, id DESC) — the house tiebreak (factResolver.js,
            -- cohortService.js) — over ALL the person's prospects; erased
            -- people never reach this query (the fence skips them).
            (SELECT p."createdAt" FROM prospects p
              WHERE p."consumerId" = c.id
              ORDER BY p."createdAt" DESC, p.id DESC
              LIMIT 1) AS "newestSignupAt",
            (c.email IS NOT NULL AND c.email <> '') AS "hasEmail",
            -- 'contact' IS the marketing-consent kind. The ledger's enum is
            -- contact | campaign_terms | third_party | dnc_override |
            -- draw_terms (ConsentEvent.js:29); there is no 'marketing' row and
            -- never has been. This filtered on a value that cannot exist, so
            -- marketingConsent was FALSE for every person in production —
            -- silently docking 0.45 of contactability from the 128 of 130
            -- consumers who HAVE granted contact consent. The UI has always
            -- labelled this kind "marketing" (AdminV2LeadProfile.jsx:1042),
            -- which is exactly how the wrong literal got written.
            EXISTS (
              SELECT 1 FROM consent_events ce
               WHERE ce."consumerId" = c.id AND ce.kind = :consentKind
                 AND ce.granted = true
                 AND ce."occurredAt" = (
                   SELECT MAX(ce2."occurredAt") FROM consent_events ce2
                    WHERE ce2."consumerId" = c.id AND ce2.kind = :consentKind
                 )
            ) AS "marketingConsent",
            -- DELIBERATELY IN ('delivered','read') — do not "fix" to
            -- delivered-only: wa_message_statuses keeps one row per wamid
            -- holding the FURTHEST status (STATUS_RANK upsert,
            -- redeemOps/waWebhookService.js), so a READ message no longer
            -- reads as 'delivered' and dropping 'read' would un-reach exactly
            -- the people with the strongest deliverability proof. A read
            -- counts here ONLY as deliverability (a person-scoped CAPABILITY);
            -- read-as-RESPONSE is lead-scoped and belongs to Phase 3
            -- (per-campaign-lead-scoring.md §16 B1).
            EXISTS (
              SELECT 1 FROM wa_message_statuses w
               WHERE w."recipientHash" = c."phoneHash"
                 AND w.status IN ('delivered', 'read')
            ) AS "whatsappReachable"
       FROM consumers c
      WHERE c.id = :cid`,
    { replacements: { cid: consumerId, consentKind: MARKETING_CONSENT_KIND } }
  );
  if (!row) return null;
  return {
    signupCount: Number(row.signupCount) || 0,
    verifiedSignupCount: Number(row.verifiedSignupCount) || 0,
    newestSignupAt: row.newestSignupAt,
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
      //
      // THE NUMBERS ARE NOT WRITTEN HERE ANY MORE (per-campaign-lead-scoring.md
      // §4). consumerScore/meetScore/buyScore — and the breakdown they have to
      // agree with — are a PROJECTION of the person's highest-scoring lead,
      // written by leadScoringService.projectPersonScore. Two writers for one
      // number is two authorities that are guaranteed to disagree, which is
      // exactly what this pass used to do: overwrite every night from the
      // global model while the lead grain said something else.
      //
      // What remains is this pass's real job: resolve the facts, keep the
      // profile row alive, and stamp what scored it — the stamps are what stop
      // findStaleConsumerIds re-examining the same unscoreable people forever.
      await sequelize.query(
        `INSERT INTO consumer_profiles
           ("consumerId", "scoredConfigVersion", "scoringAlgorithmVersion", "scoreInputHash",
            "scoreComputedAt", "inputVersion", "syncedInputVersion", "createdAt", "updatedAt")
         SELECT c.id, :configVersion, :algorithmVersion, :inputHash, now(), 0, 0, now(), now()
           FROM consumers c
          WHERE c.id = :cid AND c."erasedAt" IS NULL
         ON CONFLICT ("consumerId") DO UPDATE SET
           "scoredConfigVersion" = EXCLUDED."scoredConfigVersion",
           "scoringAlgorithmVersion" = EXCLUDED."scoringAlgorithmVersion",
           "scoreInputHash" = EXCLUDED."scoreInputHash",
           "scoreComputedAt" = EXCLUDED."scoreComputedAt",
           "updatedAt" = now()`,
        {
          replacements: {
            cid: consumerId,
            configVersion,
            algorithmVersion,
            inputHash,
          },
          transaction: t,
        }
      );

      // Returned, not stored: callers and tests still want to see what the
      // person-grain model computed, and the projection is what lands.
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
