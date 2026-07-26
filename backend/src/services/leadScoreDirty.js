import { sequelize } from '../database/connection.js';

/**
 * The lead-grain dirty marker (per-campaign-lead-scoring.md §10).
 *
 * Its OWN module, not part of leadScoringService, purely to keep the import
 * graph acyclic: enrichmentFence must be able to dirty leads, and
 * leadScoringService already imports the fence.
 *
 * Nothing existing covered lead-grain invalidation. The spine relinker bumps
 * only consumer_profiles.inputVersion (consumerService.js:326-338),
 * bumpEnrichmentInputTx upserts only consumer_profiles
 * (enrichmentFence.js:38-52), and the sweep enumerated consumers.
 * Prospect.enrichmentRevision exists but feeds map jobs — it is not a scanned
 * dirty flag.
 *
 * ALWAYS CALLED IN THE MUTATION'S OWN TRANSACTION. The marker is the durable
 * half of the contract: the post-commit rescore is an optimisation, and if it
 * dies with the process the marker still makes the lead provably stale, so it
 * rides the sweep's stale-FIRST phase with first claim on the next run's
 * budget.
 *
 * COALESCE keeps the OLDEST pending instant. The marker answers "how long has
 * this been waiting"; refreshing it on every touch would let a repeatedly
 * touched lead look permanently fresh and hide a starving rotation.
 */

/** Dirty specific leads. */
export async function markLeadsDirtyTx(t, prospectIds) {
  const ids = [...new Set((prospectIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const [, meta] = await sequelize.query(
    `UPDATE prospects
        SET "scoreDirtyAt" = COALESCE("scoreDirtyAt", now()), "updatedAt" = now()
      WHERE id IN (:ids)`,
    { replacements: { ids }, transaction: t }
  );
  return meta?.rowCount ?? 0;
}

/**
 * Dirty every lead of these people — the shape a fact write or a relink has.
 * A fact is person-wide, so it moves every one of that person's leads; which
 * of them it moves BY HOW MUCH is the scorer's business, not this marker's.
 */
export async function markConsumerLeadsDirtyTx(t, consumerIds) {
  const ids = [...new Set((consumerIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const [, meta] = await sequelize.query(
    `UPDATE prospects
        SET "scoreDirtyAt" = COALESCE("scoreDirtyAt", now()), "updatedAt" = now()
      WHERE "consumerId" IN (:ids)`,
    { replacements: { ids }, transaction: t }
  );
  return meta?.rowCount ?? 0;
}

/**
 * Dirty the lead that owns a WhatsApp message (§5's join), by wamid.
 * Returns the prospect ids touched, so the caller can fire post-commit
 * rescores for exactly those leads.
 */
export async function markLeadDirtyByWamidTx(t, wamid) {
  if (!wamid) return [];
  const [rows] = await sequelize.query(
    `UPDATE prospects p
        SET "scoreDirtyAt" = COALESCE(p."scoreDirtyAt", now()), "updatedAt" = now()
       FROM wa_message_sends s
      WHERE s.wamid = :wamid AND p.id = s."prospectId"
      RETURNING p.id`,
    { replacements: { wamid: String(wamid).slice(0, 128) }, transaction: t }
  );
  return (rows || []).map((r) => r.id);
}
