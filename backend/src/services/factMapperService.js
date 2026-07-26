import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { sequelize, Prospect, EnrichmentJob, ConsumerObservation } from '../models/index.js';
import { withConsumerFence, bumpEnrichmentInputTx, ErasedConsumerError } from './enrichmentFence.js';
import { validateFact, birthYearToBand, clampSourceEventAt, TAXONOMY_VERSION } from '../utils/factTaxonomy.js';
import { logger } from '../utils/logger.js';

/**
 * Deterministic fact mapper — structured capture data → consumer_observations
 * (docs/plans/consumer-profile-enrichment.md §5). No AI anywhere in this file.
 *
 * Durability shape (Codex R1 #5): capture writes a `map` JOB inside the
 * capture transaction (the outbox — crash between commit and drain loses
 * nothing), an opportunistic post-commit drain processes it, and the nightly
 * sweep re-drains anything missed. The Redeem Ops capture hook is untouched.
 *
 * Snapshot semantics (Codex R3-era #10): facts are normalized + validated AT
 * ENQUEUE and frozen into the job payload — the mapper never reads mutable
 * live rows, so a staff edit between enqueue and drain cannot smuggle new
 * data under an old revision. Edits mint prospects.enrichmentRevision++ and
 * a NEW job; activation supersedes the old revision's rows (§3.1). The
 * payload holds only taxonomy-relevant normalized values (never contact
 * data), capped at 8 KB serialized.
 */

export const MAPPER_PIPELINE = 'mapper';
// COMPOSITE semantic version (R3 #6): mapper code + taxonomy in one string.
export const MAPPER_PIPELINE_VERSION = `mapper/v1+tax-${TAXONOMY_VERSION}`;
const MAX_SNAPSHOT_BYTES = 8 * 1024;
const INTERNAL_LEASE_MINUTES = 5;

/** Canonical JSON — stable key order at every depth (hash stability). */
export function canonicalJson(x) {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Build the minimized, fully-normalized fact snapshot for a prospect-shaped
 * object. Returns { facts: [{ key, value, artifact: 'form'|'quiz' }] } —
 * every entry already taxonomy-valid; invalid candidates are skipped + logged
 * (never block capture over a bad mapping).
 *
 * Sources today: demographics.dateOfBirth → identity.birth_year_band.
 * Quiz answers map ONLY when server-scored (scoredBy === 'server' — Codex
 * R1 #12) AND the campaign quiz definition carries per-question factKey +
 * factValues (answerId → taxonomy value object); that authoring surface is
 * PR 0 — the contract ships here so the mapper is ready the day a campaign
 * uses it.
 */
export function buildFactSnapshot({ demographics, sourceMetadata, quizDefinition } = {}) {
  const facts = [];

  const dob = demographics?.dateOfBirth;
  if (dob) {
    const year = new Date(dob).getFullYear();
    const band = birthYearToBand(year);
    if (band) {
      const value = { v: band };
      const check = validateFact('identity.birth_year_band', value);
      if (check.ok) facts.push({ key: 'identity.birth_year_band', value, artifact: 'form' });
    }
  }

  const quiz = sourceMetadata?.quiz;
  if (quiz?.scoredBy === 'server' && Array.isArray(quizDefinition?.questions)) {
    const answers = quiz.submission?.answers || quiz.answers || {};
    for (const q of quizDefinition.questions) {
      if (!q?.factKey || !q?.id) continue;
      const answerId = answers[q.id];
      if (answerId === undefined || answerId === null) continue;
      const value = q.factValues?.[String(answerId)];
      if (!value) continue;
      const check = validateFact(q.factKey, value);
      if (!check.ok) {
        logger.warn('[factMapper] invalid quiz factKey mapping skipped', {
          factKey: q.factKey, error: check.error,
        });
        continue;
      }
      facts.push({ key: q.factKey, value, artifact: 'quiz' });
    }
  }

  return { facts };
}

/**
 * Outbox: enqueue the map job INSIDE the capture (or edit) transaction.
 * Never throws — savepoint-isolated by the caller pattern; a lost enqueue is
 * healed by the sweep. Empty snapshots enqueue only when revision > 1 (a
 * cleared field must still supersede its old observation — zero-claim
 * activation, §3.1); at capture (revision 1) there is nothing to supersede.
 */
export async function enqueueMapJobTx(t, { prospectId, enrichmentRevision, snapshot }) {
  const payloadJson = canonicalJson(snapshot);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_SNAPSHOT_BYTES) {
    logger.error('[factMapper] snapshot over cap — not enqueued', { prospectId });
    return null;
  }
  if (!snapshot.facts.length && enrichmentRevision <= 1) return null;

  const [rows] = await sequelize.query(
    `INSERT INTO enrichment_jobs
       (id, kind, "subjectProspectId", "sourceRevisionId", "sourceContentHash",
        payload, "taxonomyVersion", "pipelineVersion", status, attempts, "createdAt", "updatedAt")
     VALUES (:id, 'map', :pid, :rev, :hash, :payload::jsonb, :tax, :pv, 'pending', 0, now(), now())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    {
      replacements: {
        id: randomUUID(),
        pid: prospectId,
        rev: enrichmentRevision,
        hash: sha256(payloadJson),
        payload: JSON.stringify(snapshot),
        tax: TAXONOMY_VERSION,
        pv: MAPPER_PIPELINE_VERSION,
      },
      transaction: t,
    }
  );
  return rows?.[0]?.id || null;
}

/**
 * Revision activation for one artifact family under the fence (§3.1, R4 #2):
 * gate on artifact-current revision + server-current pipeline, supersede ALL
 * other active rows for the artifact (any revision, any pipelineVersion —
 * including keys the new result omits), then insert. Zero-fact results still
 * supersede (a cleared DOB kills the old band).
 */
async function activateArtifactTx(t, { artifactId, revision, contentHash, prospect, facts, source }) {
  await sequelize.query(
    `UPDATE consumer_observations
        SET "supersededAt" = now(), "updatedAt" = now()
      WHERE "sourceArtifactId" = :artifact
        AND pipeline = :pipeline
        AND "supersededAt" IS NULL
        AND ("sourceRevisionId" <> :rev OR "pipelineVersion" <> :pv)`,
    {
      replacements: { artifact: artifactId, pipeline: MAPPER_PIPELINE, rev: revision, pv: MAPPER_PIPELINE_VERSION },
      transaction: t,
    }
  );

  for (const f of facts) {
    await sequelize.query(
      `INSERT INTO consumer_observations
         (id, "sourceProspectId", key, value, confidence, source,
          "sourceArtifactId", "sourceRevisionId", "sourceContentHash",
          "sourceEventAt", pipeline, "pipelineVersion", "createdAt", "updatedAt")
       VALUES (:id, :pid, :key, :value::jsonb, 1.0, :source, :artifact, :rev, :hash,
               :eventAt, :pipeline, :pv, now(), now())
       ON CONFLICT DO NOTHING`,
      {
        replacements: {
          id: randomUUID(),
          pid: prospect.id,
          key: f.key,
          value: JSON.stringify(f.value),
          source,
          artifact: artifactId,
          rev: revision,
          hash: contentHash,
          eventAt: clampSourceEventAt(prospect.createdAt),
          pipeline: MAPPER_PIPELINE,
          pv: MAPPER_PIPELINE_VERSION,
        },
        transaction: t,
      }
    );
  }
}

/** Process one leased map job to completion (done/stale/dead). */
async function processMapJob(job) {
  const finish = (status, lastError = null) =>
    EnrichmentJob.update(
      {
        status,
        lastError,
        ...(status === 'pending' ? {} : {}),
        ...(status === 'dead' || status === 'pending' ? { attempts: sequelize.literal('attempts + 1') } : {}),
      },
      { where: { id: job.id, leaseToken: job.leaseToken } }
    );

  try {
    const result = await withConsumerFence(job.subjectProspectId, async (t, { prospect, consumer }) => {
      // Gate (R4 #2): only the artifact-CURRENT revision at the CURRENT
      // pipeline activates. A late old-revision job can never insert.
      if (Number(job.sourceRevisionId) !== Number(prospect.enrichmentRevision)
        || job.pipelineVersion !== MAPPER_PIPELINE_VERSION) {
        return { outcome: 'stale' };
      }

      const snapshot = job.payload || { facts: [] };
      const byArtifact = new Map([
        [`form:${prospect.id}`, []],
        [`quiz:${prospect.id}`, []],
      ]);
      for (const f of snapshot.facts || []) {
        const check = validateFact(f.key, f.value);
        if (!check.ok) throw Object.assign(new Error(`invalid fact ${f.key}: ${check.error}`), { code: 'INVALID_FACT' });
        const artifactId = f.artifact === 'quiz' ? `quiz:${prospect.id}` : `form:${prospect.id}`;
        byArtifact.get(artifactId).push(f);
      }

      const source = { form: 'form', quiz: 'quiz' };
      for (const [artifactId, facts] of byArtifact) {
        const kind = artifactId.startsWith('quiz:') ? 'quiz' : 'form';
        await activateArtifactTx(t, {
          artifactId,
          revision: Number(job.sourceRevisionId),
          contentHash: job.sourceContentHash,
          prospect,
          facts,
          source: source[kind],
        });
      }

      await bumpEnrichmentInputTx(t, consumer?.id || null);
      return { outcome: 'done' };
    });

    if (result?.skipped) {
      await finish('cancelled', `skipped: ${result.skipped}`);
      return result.skipped;
    }
    await finish(result.outcome === 'stale' ? 'stale' : 'done');
    return result.outcome;
  } catch (err) {
    if (err instanceof ErasedConsumerError) {
      await finish('cancelled', 'consumer erased');
      return 'cancelled';
    }
    const attempts = (job.attempts || 0) + 1;
    await finish(attempts >= 3 ? 'dead' : 'pending', String(err?.message || err).slice(0, 500));
    logger.error('[factMapper] map job failed', { jobId: job.id, error: err?.message });
    return attempts >= 3 ? 'dead' : 'retry';
  }
}

/**
 * Claim + process pending map jobs (post-commit drain and sweep re-drain).
 * Multi-instance safe: SKIP LOCKED claim to `leased` with a short internal
 * lease; expired internal leases are reclaimed by the sweep like any other.
 */
export async function drainMapJobs({ limit = 20 } = {}) {
  const leaseToken = randomUUID();
  const [claimed] = await sequelize.query(
    `WITH picked AS (
       SELECT id FROM enrichment_jobs
        WHERE status = 'pending' AND kind = 'map'
        ORDER BY "createdAt"
        LIMIT :limit
        FOR UPDATE SKIP LOCKED)
     UPDATE enrichment_jobs j
        SET status = 'leased', "leaseToken" = :token,
            "leaseExpiresAt" = now() + interval '${INTERNAL_LEASE_MINUTES} minutes',
            "workerId" = 'in-process', "updatedAt" = now()
       FROM picked WHERE j.id = picked.id
     RETURNING j.*`,
    { replacements: { limit, token: leaseToken } }
  );

  const outcomes = { done: 0, stale: 0, retry: 0, dead: 0, cancelled: 0 };
  for (const row of claimed) {
    const outcome = await processMapJob({ ...row, leaseToken });
    if (outcomes[outcome] !== undefined) outcomes[outcome] += 1;
  }
  return { claimed: claimed.length, ...outcomes };
}

export { ConsumerObservation, Prospect };
