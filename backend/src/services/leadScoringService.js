import { sequelize } from '../models/index.js';
import { withConsumerFence, ErasedConsumerError } from './enrichmentFence.js';
import { resolveCurrentFacts } from '../utils/factResolver.js';
import { canonicalJson, sha256 } from './factMapperService.js';
import { getActiveScoringConfig, loadObservations } from './consumerScoringService.js';
import { scoreLead, LEAD_ALGORITHM_VERSION } from '../utils/consumerScoring.js';
import { normalizeScreeningSignal } from '../utils/screeningSignal.js';
import { canMarketTo } from './consentService.js';
import { logger } from '../utils/logger.js';

/**
 * Lead scoring — the I/O half of per-campaign-lead-scoring.md §4/§6/§10.
 *
 * THE SCORE IS A PROPERTY OF (person × campaign). A fresh grad is a great
 * recruit and a poor insurance buyer: identical facts, opposite verdict. A
 * prospect row already IS that pair, so the score lives on it.
 *
 * ONE AUTHORITY (§4). The lead score is the sole computed number. The
 * person-grain meet/buy/consumerScore become a PROJECTION of it —
 * `projectPersonScore` below — so the two grains cannot disagree: one is a
 * copy of the other with a stated rule. scoreOneConsumer no longer writes
 * them (see its own header).
 *
 * ISOLATION (§3.2), enforced by what this file reads:
 *   - person-wide CAPABILITY, shared by every lead by design: signup counts,
 *     email on file, the WhatsApp deliverability frontier.
 *   - lead-scoped RESPONSE, never crossing campaigns: reads of messages THIS
 *     lead owns (wa_message_sends, §5 — ownership stamped at send, never
 *     derived), this lead's own screening outcome, this lead's own signup
 *     recency, and consent read at (consumer, campaign) scope.
 * A `read` on campaign A's message therefore legitimately moves BOTH grains —
 * it advances the person's frontier AND is a response for lead A — but it can
 * never appear as a response on lead B.
 *
 * DECAY AT WRITE TIME (§6). One stored number; sort, display and API all read
 * it; nothing decays at read anywhere. The sacrifice, stated: pure-time
 * freshness between rescores. The write gate is therefore weaker than the
 * person-grain one by exactly one clause — skip the write iff the input hash
 * matches AND the recomputed integers equal the stored ones — so a pure-decay
 * rewrite still happens the moment it changes an integer, and not before.
 */

/** Reuses the person-grain flag: one switch for the whole scoring subsystem. */
export { scoringEnabled } from './consumerScoringService.js';

/**
 * Every message this lead owns, with whatever Meta has said about it.
 *
 * The join is on wamid — exact and immutable, because ownership was stamped
 * at SEND (§5). `occurredAt` is Meta's own timestamp and is nullable, so it
 * falls back to when we recorded the status.
 *
 * 'read' is an equality here and NOT a rank predicate, unlike the
 * deliverability check: the frontier's ranks are ordered
 * sent < delivered < read < failed (waWebhookService.js:37), so `= 'read'` is
 * exactly "reached read and has not since failed". A read-then-failed row
 * forfeits its response, the same accepted forfeit §3.3 states for
 * deliverability.
 */
export async function loadOwnedMessages(prospectId) {
  const [rows] = await sequelize.query(
    `SELECT s.wamid, s.kind, s."sentAt", st.status,
            COALESCE(st."occurredAt", st."updatedAt") AS "statusAt"
       FROM wa_message_sends s
       LEFT JOIN wa_message_statuses st ON st.wamid = s.wamid
      WHERE s."prospectId" = :pid
      ORDER BY s."sentAt"`,
    { replacements: { pid: prospectId } }
  );
  return rows;
}

/**
 * Everything the lead scorer needs, at the grain §3.4 assigns each input.
 * Returns null when the prospect is gone.
 */
export async function loadLeadTelemetry(prospectId) {
  const [[row]] = await sequelize.query(
    `SELECT p.id, p."consumerId", p."campaignId", p."createdAt" AS "ownSignupAt",
            p."screeningVerdict", p."screeningMetadata",
            c."signupCount", c."verifiedSignupCount",
            (c.email IS NOT NULL AND c.email <> '') AS "hasEmail",
            -- Person-wide CAPABILITY (§3.3): a rank predicate, never an
            -- equality. wa_message_statuses keeps one row per wamid holding
            -- the FURTHEST status, so a read message IS a delivered message
            -- whose frontier moved on — dropping 'read' would un-reach
            -- exactly the people with the strongest proof.
            EXISTS (
              SELECT 1 FROM wa_message_statuses w
               WHERE w."recipientHash" = c."phoneHash"
                 AND w.status IN ('delivered', 'read')
            ) AS "whatsappReachable"
       FROM prospects p
       LEFT JOIN consumers c ON c.id = p."consumerId"
      WHERE p.id = :pid`,
    { replacements: { pid: prospectId } }
  );
  if (!row) return null;

  const owned = await loadOwnedMessages(prospectId);

  // Consent is read through the ledger's OWN derivation — never re-scoped
  // here (§3.3). canMarketTo is the same gate every marketing send calls
  // (consentService.js:434-441), so the score can never advertise a
  // reachability the gate would refuse. Unlinked leads have no consumer to
  // resolve, and it fails closed.
  const marketingConsent = row.consumerId
    ? await canMarketTo({ consumerId: row.consumerId, campaignId: row.campaignId || null })
    : false;

  return {
    consumerId: row.consumerId || null,
    campaignId: row.campaignId || null,

    // Person-wide capability — shared by every one of this person's leads.
    signupCount: Number(row.signupCount) || 0,
    verifiedSignupCount: Number(row.verifiedSignupCount) || 0,
    hasEmail: Boolean(row.hasEmail),
    whatsappReachable: Boolean(row.whatsappReachable),

    // Lead-scoped. Recency anchors to THIS lead's signup, not the person's
    // newest: a second signup on another campaign must not refresh this
    // lead's standing (§3.4).
    newestSignupAt: row.ownSignupAt,
    marketingConsent,
    ownedMessageCount: owned.length,
    readAt: owned.filter((m) => m.status === 'read' && m.statusAt).map((m) => m.statusAt),
    screening: normalizeScreeningSignal({
      screeningVerdict: row.screeningVerdict,
      screeningMetadata: row.screeningMetadata,
    }),
  };
}

/**
 * Facts for a lead. The spine exists so every lead reads the PERSON's facts
 * (§3.4); an unlinked lead falls back to its own prospect-anchored rows,
 * which is what the mapper wrote before the spine linked it.
 */
export async function loadLeadObservations({ prospectId, consumerId }) {
  if (consumerId) return loadObservations(consumerId);
  const [rows] = await sequelize.query(
    `SELECT o.id, o.key, o.value, o.confidence, o.source, o."sourceEventAt",
            o."supersededAt", o."retractedAt"
       FROM consumer_observations o
      WHERE o."sourceProspectId" = :pid`,
    { replacements: { pid: prospectId } }
  );
  return rows;
}

/**
 * The hash half of the write gate. Built from the RESOLVED facts and the
 * telemetry, so a superseded duplicate or a re-ordered query result — neither
 * of which can change the output — does not force a rewrite.
 *
 * `now` is deliberately NOT in it. Time is what the integer comparison in
 * scoreOneLead covers: including a clock here would make every lead stale
 * every instant, and omitting the integer check would make a decayed score
 * never rewrite at all — the person-grain gate's unbounded drift
 * (consumerScoringService.js:185-198 vs :229-234).
 */
export function computeLeadInputHash({ facts, telemetry, configVersion, algorithmVersion }) {
  const factDigest = Object.keys(facts).sort().map((k) => ({
    k, v: facts[k].value, c: facts[k].confidence, s: facts[k].source,
  }));
  // consumerId/campaignId are identity, not inputs — they are already implied
  // by the row this hash is stored on, and including them would churn the
  // hash on a relink that changed no scoreable value.
  const { consumerId, campaignId, ...scoreable } = telemetry;
  return sha256(canonicalJson({
    f: factDigest, t: scoreable, cv: configVersion, av: algorithmVersion,
  }));
}

/**
 * §4's projection, computed under the caller's consumer lock.
 *
 * The person's numbers are the winning lead's numbers: highest `score`, ties
 * broken by most recent createdAt then id — the house tiebreak
 * (factResolver.js, consumerScoringService.js:119-130). NULL when the person
 * has no scoreable lead.
 *
 * The BREAKDOWN travels with the numbers, extending §4's three columns by
 * one. It has to: the profile card renders `groups.meet`/`groups.buy`
 * component rows straight out of scoreBreakdown
 * (AdminV2LeadProfile.jsx:589-624), so numbers from the winning lead beside a
 * breakdown from the retired person-grain pass would render components that
 * visibly do not sum to the score shown above them.
 *
 * SERIALISATION: every caller holds the Consumer row FOR UPDATE (the fence,
 * enrichmentFence.js:87-93), so two of this person's leads can never project
 * concurrently — the second waits, then reads the first's committed score and
 * picks the true winner. Erased people are excluded by the guard on the
 * INSERT…SELECT, which is what stops a projection resurrecting a deleted
 * profile row.
 */
export async function projectPersonScore(t, consumerId) {
  if (!consumerId) return null;
  await sequelize.query(
    `INSERT INTO consumer_profiles
       ("consumerId", "consumerScore", "meetScore", "buyScore", "scoreBreakdown",
        "inputVersion", "syncedInputVersion", "createdAt", "updatedAt")
     SELECT c.id, best.score, best."meetScore", best."buyScore", best."scoreBreakdown",
            0, 0, now(), now()
       FROM consumers c
       LEFT JOIN LATERAL (
         SELECT p.score, p."meetScore", p."buyScore", p."scoreBreakdown"
           FROM prospects p
          WHERE p."consumerId" = c.id AND p.score IS NOT NULL
          ORDER BY p.score DESC, p."createdAt" DESC, p.id DESC
          LIMIT 1
       ) best ON true
      WHERE c.id = :cid AND c."erasedAt" IS NULL
     ON CONFLICT ("consumerId") DO UPDATE SET
       "consumerScore" = EXCLUDED."consumerScore",
       "meetScore" = EXCLUDED."meetScore",
       "buyScore" = EXCLUDED."buyScore",
       "scoreBreakdown" = EXCLUDED."scoreBreakdown",
       "updatedAt" = now()`,
    { replacements: { cid: consumerId }, transaction: t }
  );
  return true;
}

/**
 * Score one lead and persist the result.
 *
 * @returns {{status:'scored'|'unchanged'|'skipped', reason?:string,
 *            score?:number|null, meetScore?:number|null, buyScore?:number|null}}
 */
export async function scoreOneLead(prospectId, { force = false, now = Date.now() } = {}) {
  // Telemetry FIRST: it carries the campaignId that selects the config
  // (§9's campaign → product → global chain). The resolved row's `version` is
  // what gets stamped, so "which config scored this lead" has exactly one
  // answer even when the campaign inherited from product or global.
  const telemetry = await loadLeadTelemetry(prospectId);
  if (!telemetry) return { status: 'skipped', reason: 'prospect_gone' };

  const { version: configVersion, config } = await getActiveScoringConfig({
    now, campaignId: telemetry.campaignId,
  });

  const observations = await loadLeadObservations({
    prospectId, consumerId: telemetry.consumerId,
  });
  const facts = resolveCurrentFacts(observations);
  const inputHash = computeLeadInputHash({
    facts, telemetry, configVersion, algorithmVersion: LEAD_ALGORITHM_VERSION,
  });

  const result = scoreLead({ facts, telemetry, config, now });

  try {
    return await withConsumerFence(prospectId, async (t, { prospect, consumer }) => {
      // The gate. Both clauses, because either alone is wrong: the hash has no
      // clock in it, so decay would never rewrite; the integers alone would
      // rewrite on every no-op fact churn.
      const unchanged = !force
        && prospect.scoreInputHash === inputHash
        && prospect.scoredConfigVersion === configVersion
        && prospect.scoringAlgorithmVersion === LEAD_ALGORITHM_VERSION
        && prospect.score === result.score
        && prospect.meetScore === result.meetScore
        && prospect.buyScore === result.buyScore
        && prospect.scoreDirtyAt === null;

      if (unchanged) return { status: 'unchanged', reason: 'input_hash_and_integers_match' };

      await sequelize.query(
        `UPDATE prospects SET
            score = :score,
            "meetScore" = :meetScore,
            "buyScore" = :buyScore,
            "scoreBreakdown" = :breakdown::jsonb,
            "scoredConfigVersion" = :configVersion,
            "scoringAlgorithmVersion" = :algorithmVersion,
            "scoreInputHash" = :inputHash,
            "scoreComputedAt" = now(),
            -- Cleared unconditionally: this rescore has just consumed whatever
            -- dirtied it. A marker set DURING this transaction cannot be lost,
            -- because every dirtier takes the same consumer lock.
            "scoreDirtyAt" = NULL,
            "updatedAt" = now()
          WHERE id = :pid`,
        {
          replacements: {
            pid: prospectId,
            score: result.score,
            meetScore: result.meetScore,
            buyScore: result.buyScore,
            breakdown: JSON.stringify(result.breakdown),
            configVersion,
            algorithmVersion: LEAD_ALGORITHM_VERSION,
            inputHash,
          },
          transaction: t,
        }
      );

      // The person's numbers follow, in the same transaction and under the
      // same lock — so a reader can never see a lead score without the
      // projection that is defined to equal it.
      await projectPersonScore(t, consumer?.id || null);

      return {
        status: 'scored',
        score: result.score,
        meetScore: result.meetScore,
        buyScore: result.buyScore,
      };
    });
  } catch (err) {
    if (err instanceof ErasedConsumerError) return { status: 'skipped', reason: 'erased' };
    throw err;
  }
}

/**
 * The SQL twin of getActiveScoringConfig's resolution (§9), as a scalar
 * subquery over one prospect row.
 *
 * WHY IT HAS TO BE SQL. Under per-campaign configs the "expected version"
 * differs per campaign, so a single `:configVersion` bind can no longer say
 * what stale means. Resolving in JS would mean fetching a batch and filtering
 * it afterwards, which breaks LIMIT: the sweep asks for 200 stale leads and
 * would get "however many of an arbitrary 200 happened to be stale".
 *
 * COALESCE is the tier order — campaign, then product, then global, then 0
 * for the empty-table case that getActiveScoringConfig reports as version 0.
 * Each subquery hits one of migration 100's partial indexes.
 *
 * The product comes from `targetAudience->>'product'` with no validity check,
 * exactly matching `briefProductKey`: a value outside the vocabulary cannot
 * match a `productKey` row, because those are validated on the way in. The
 * parity test pins the two resolvers against the same fixtures.
 */
const RESOLVED_VERSION_SQL = `COALESCE(
  (SELECT max(e.version) FROM enrichment_scoring_configs e
    WHERE e.status = 'approved' AND e."campaignId" = p."campaignId"),
  (SELECT max(e.version) FROM enrichment_scoring_configs e
    WHERE e.status = 'approved' AND e."productKey" = cam."targetAudience"->>'product'),
  (SELECT max(e.version) FROM enrichment_scoring_configs e
    WHERE e.status = 'approved' AND e."campaignId" IS NULL AND e."productKey" IS NULL),
  0)`;

/**
 * Leads whose score is provably stale: never scored, scored by a superseded
 * config or algorithm, or explicitly dirtied by a choke-point writer (§10).
 *
 * "Superseded config" is now per-campaign (§9): each lead's stamped version is
 * compared against the version its OWN campaign currently resolves to. An
 * approval at any scope therefore makes exactly the inheriting leads stale —
 * a campaign-scoped row dirties that campaign's leads, a product row dirties
 * every campaign of that product that has no row of its own, and a global row
 * dirties everything still inheriting from global.
 *
 * Erased people are excluded — their leads keep a nulled score by design
 * (§11), and re-scoring one would write the number straight back.
 *
 * Hash-level staleness (facts moved, config didn't) is NOT expressible in
 * SQL; that is what the sweep's rotation is for.
 */
export async function findStaleLeadIds({ limit = 200, afterId = null } = {}) {
  const [rows] = await sequelize.query(
    `SELECT p.id
       FROM prospects p
       LEFT JOIN consumers c ON c.id = p."consumerId"
       LEFT JOIN campaigns cam ON cam.id = p."campaignId"
      WHERE (p."consumerId" IS NULL OR c."erasedAt" IS NULL)
        AND (:afterId::uuid IS NULL OR p.id > :afterId::uuid)
        AND (
          p."scoreComputedAt" IS NULL
          OR p."scoreDirtyAt" IS NOT NULL
          OR p."scoringAlgorithmVersion" IS DISTINCT FROM :algorithmVersion
          OR p."scoredConfigVersion" IS DISTINCT FROM ${RESOLVED_VERSION_SQL}
        )
      ORDER BY p.id
      LIMIT :limit`,
    {
      replacements: { algorithmVersion: LEAD_ALGORITHM_VERSION, limit, afterId },
    }
  );
  return rows.map((r) => r.id);
}

/** Leads to re-examine on the rotation, walking the id space from a cursor. */
export async function findLeadIdsAfter({ afterId = null, limit = 200 }) {
  const [rows] = await sequelize.query(
    `SELECT p.id
       FROM prospects p
       LEFT JOIN consumers c ON c.id = p."consumerId"
      WHERE (p."consumerId" IS NULL OR c."erasedAt" IS NULL)
        AND (:afterId::uuid IS NULL OR p.id > :afterId::uuid)
      ORDER BY p.id
      LIMIT :limit`,
    { replacements: { afterId, limit } }
  );
  return rows.map((r) => r.id);
}

// The dirty markers live in leadScoreDirty.js (import-cycle reasons — the
// fence needs them too). Re-exported here so the choke points have one door.
export {
  markLeadsDirtyTx, markConsumerLeadsDirtyTx, markLeadDirtyByWamidTx,
} from './leadScoreDirty.js';

/**
 * Post-commit rescore attempt (§6, "event-driven moves don't wait for the
 * rotation"). Fire-and-forget by contract: the dirty marker is the durable
 * half, so a failure here costs latency, never correctness.
 */
export function rescoreLeadSoon(prospectId) {
  if (!prospectId) return;
  Promise.resolve()
    .then(() => scoreOneLead(prospectId))
    .catch((err) => logger.warn('[leadScoring] post-commit rescore failed', {
      prospectId, error: err?.message,
    }));
}
