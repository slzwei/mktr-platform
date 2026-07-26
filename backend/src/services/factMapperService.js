import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { sequelize, Prospect, EnrichmentJob, ConsumerObservation } from '../models/index.js';
import { withConsumerFence, bumpEnrichmentInputTx, ErasedConsumerError } from './enrichmentFence.js';
import { validateFact, birthYearToBand, clampSourceEventAt, TAXONOMY_VERSION } from '../utils/factTaxonomy.js';
import { logger } from '../utils/logger.js';

/**
 * Deterministic fact mapper v1.1 — structured capture data →
 * consumer_observations (consumer-profile-enrichment §5 +
 * studio-profile-questions §5.1–§5.2). No AI anywhere in this file.
 *
 * v1.1 (Codex PR0 rounds 1–3):
 * - Map work is ARTIFACT-SCOPED: one job per (form|quiz|profile) artifact,
 *   each with its own revision gate — a demographics edit can no longer
 *   supersede quiz/profile facts, and a pending quiz job survives a form
 *   revision bump. Revisions: form = prospects.enrichmentRevision;
 *   quiz/profile = pinned 1 (capture-immutable in this release — a future
 *   edit surface must mint per-artifact counters first).
 * - Deploy choreography: artifact-scoped WRITES sit behind
 *   ENRICHMENT_MAP_ARTIFACT_JOBS (default OFF). Until the flag flips
 *   (post-deploy restart, once old instances are gone), writers emit the
 *   LEGACY combined shape; this processor handles BOTH — a legacy job's
 *   payload is split per artifact, never single-artifact-activated.
 * - Quiz wire shape fixed: real Studio quizzes are steps[].questions[] and
 *   real submissions are [{qid, value}] — the flat shapes the v1 mapper
 *   read never occur in production data.
 * - Quiz mapping is FROZEN at enqueue: the job payload carries the resolved
 *   facts; nothing ever re-reads the live quiz definition after capture
 *   (Studio edits quizzes without minting versions — remapping old answers
 *   against today's definition could mint facts the person never stated).
 */

export const MAPPER_PIPELINE = 'mapper';
// COMPOSITE semantic version (code + taxonomy) — R3 #6 / PR0 R1 #8.
export const MAPPER_PIPELINE_VERSION = `mapper/v1.1+tax-${TAXONOMY_VERSION}`;
const MAX_SNAPSHOT_BYTES = 8 * 1024;
const INTERNAL_LEASE_MINUTES = 5;

export const ARTIFACT_KINDS = ['form', 'quiz', 'profile'];
const PINNED_REVISION_ARTIFACTS = new Set(['quiz', 'profile']);

/** Artifact-scoped writes flag — read at call time (restart-to-flip). */
export function artifactJobsEnabled() {
  return process.env.ENRICHMENT_MAP_ARTIFACT_JOBS === 'true';
}

/** Canonical JSON — stable key order at every depth (hash stability). */
export function canonicalJson(x) {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Real Studio quizzes nest questions in steps[]; accept legacy flat too. */
export function flattenQuizQuestions(quizDefinition) {
  if (!quizDefinition) return [];
  if (Array.isArray(quizDefinition.steps)) {
    return quizDefinition.steps.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []));
  }
  return Array.isArray(quizDefinition.questions) ? quizDefinition.questions : [];
}

/** Real submissions are [{qid, value}]; accept a plain object map too. */
export function indexQuizAnswers(answers) {
  const map = new Map();
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (a && a.qid !== undefined && a.value !== undefined) map.set(String(a.qid), a.value);
    }
  } else if (answers && typeof answers === 'object') {
    for (const [k, v] of Object.entries(answers)) map.set(String(k), v);
  }
  return map;
}

// Monthly SGD from the free-entry salary field → finance.income_band.
function incomeToBand(raw) {
  // Strip formatting only ($, commas, spaces) — a stray minus must stay a
  // minus, not vanish into a positive number.
  const n = Number(String(raw).replace(/[,$\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  if (n < 3000) return '<3k';
  if (n < 6000) return '3-6k';
  if (n < 10000) return '6-10k';
  if (n < 15000) return '10-15k';
  return '>15k';
}

/**
 * Build the minimized, fully-normalized, SECTION-KEYED fact snapshot.
 * A section PRESENT (even with zero facts) will activate + supersede its
 * artifact; a section ABSENT means "not re-observed — leave that artifact
 * alone". Returns { sections: { form?, quiz?, profile? } } where each
 * section is { facts: [{ key, value }] }. Every fact is already
 * taxonomy-valid; invalid candidates are skipped (never block capture).
 *
 * - form: always present when demographics were observed (capture + edits).
 * - quiz: present iff a server-scored submission existed at capture —
 *   resolution happens HERE, at enqueue, freezing the mapping.
 * - profile: present iff capture validation produced accepted facts
 *   (studio-profile-questions §5.4 — pre-resolved [{key, value}]).
 */
export function buildFactSnapshot({ demographics, sourceMetadata, quizDefinition, profileFacts } = {}) {
  const sections = {};

  // form — present whenever a demographics object was observed (an empty
  // one still re-observes the artifact: a cleared DOB must supersede).
  if (demographics && typeof demographics === 'object') {
    const facts = [];
    if (demographics.dateOfBirth) {
      const band = birthYearToBand(new Date(demographics.dateOfBirth).getFullYear());
      if (band && validateFact('identity.birth_year_band', { v: band }).ok) {
        facts.push({ key: 'identity.birth_year_band', value: { v: band } });
      }
    }
    if (demographics.income !== undefined && demographics.income !== null && demographics.income !== '') {
      const band = incomeToBand(demographics.income);
      if (band && validateFact('finance.income_band', { v: band }).ok) {
        facts.push({ key: 'finance.income_band', value: { v: band } });
      }
    }
    sections.form = { facts };
  }

  const quiz = sourceMetadata?.quiz;
  if (quiz?.scoredBy === 'server' && quizDefinition?.enabled) {
    const answerByQid = indexQuizAnswers(quiz.answers);
    const facts = [];
    for (const q of flattenQuizQuestions(quizDefinition)) {
      const qid = q?.qid ?? q?.id;
      if (!q?.factKey || qid === undefined) continue;
      const answered = answerByQid.get(String(qid));
      if (answered === undefined || answered === null) continue;
      const value = q.factValues?.[String(answered)];
      if (!value) continue;
      const check = validateFact(q.factKey, value);
      if (!check.ok) {
        logger.warn('[factMapper] invalid quiz factKey mapping skipped', { factKey: q.factKey, error: check.error });
        continue;
      }
      facts.push({ key: q.factKey, value });
    }
    sections.quiz = { facts };
  }

  if (Array.isArray(profileFacts) && profileFacts.length) {
    const facts = profileFacts.filter((f) => f?.key && validateFact(f.key, f.value).ok)
      .map((f) => ({ key: f.key, value: f.value }));
    if (facts.length) sections.profile = { facts };
  }

  return { sections };
}

function insertJobSql() {
  return `INSERT INTO enrichment_jobs
       (id, kind, "subjectProspectId", "sourceArtifactId", "sourceRevisionId", "sourceContentHash",
        payload, "taxonomyVersion", "pipelineVersion", status, attempts, "createdAt", "updatedAt")
     VALUES (:id, 'map', :pid, :artifact, :rev, :hash, :payload::jsonb, :tax, :pv, 'pending', 0, now(), now())
     ON CONFLICT DO NOTHING
     RETURNING id`;
}

/**
 * Outbox: enqueue map work INSIDE the capture/edit transaction.
 * Flag ON  → one artifact-scoped job per PRESENT section.
 * Flag OFF → one legacy combined job (deploy-window compatibility —
 *            old processors may still be running; they must never see the
 *            new shape).
 * Zero-fact sections skip at revision 1 (nothing to supersede yet);
 * at revision > 1 they enqueue — a cleared field must kill its old fact.
 */
export async function enqueueMapJobsTx(t, { prospectId, formRevision = 1, snapshot }) {
  const sections = snapshot?.sections || {};
  const inserted = [];

  if (!artifactJobsEnabled()) {
    // Deploy-window shape: OLD processors may claim this job, and they only
    // know form/quiz buckets — profile-tagged facts would be misattributed
    // to the form artifact (the exact supersession bug class v1.1 kills).
    // So legacy-shaped jobs NEVER carry profile facts; the canonical answer
    // ids are already durable in sourceMetadata.profileAnswers, and the
    // post-flip remap re-derives them safely (the profile library is
    // code-fixed — unlike Studio quizzes, re-resolution cannot drift).
    const facts = ['form', 'quiz'].flatMap((kind) =>
      (sections[kind]?.facts || []).map((f) => ({ ...f, artifact: kind })));
    if (!facts.length && formRevision <= 1) return inserted;
    const payload = { facts };
    const payloadJson = canonicalJson(payload);
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_SNAPSHOT_BYTES) {
      logger.error('[factMapper] snapshot over cap — not enqueued', { prospectId });
      return inserted;
    }
    const [rows] = await sequelize.query(insertJobSql(), {
      replacements: {
        id: randomUUID(), pid: prospectId, artifact: null, rev: formRevision,
        hash: sha256(payloadJson), payload: JSON.stringify(payload),
        tax: TAXONOMY_VERSION, pv: MAPPER_PIPELINE_VERSION,
      },
      transaction: t,
    });
    if (rows?.[0]?.id) inserted.push(rows[0].id);
    return inserted;
  }

  for (const kind of ARTIFACT_KINDS) {
    const section = sections[kind];
    if (!section) continue; // absent = not re-observed
    const revision = kind === 'form' ? formRevision : 1;
    if (!section.facts.length && revision <= 1) continue;
    const payload = { facts: section.facts };
    const payloadJson = canonicalJson(payload);
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_SNAPSHOT_BYTES) {
      logger.error('[factMapper] snapshot over cap — section skipped', { prospectId, kind });
      continue;
    }
    const [rows] = await sequelize.query(insertJobSql(), {
      replacements: {
        id: randomUUID(), pid: prospectId, artifact: `${kind}:${prospectId}`, rev: revision,
        hash: sha256(payloadJson), payload: JSON.stringify(payload),
        tax: TAXONOMY_VERSION, pv: MAPPER_PIPELINE_VERSION,
      },
      transaction: t,
    });
    if (rows?.[0]?.id) inserted.push(rows[0].id);
  }
  return inserted;
}

/** Backward-compat alias used by older call sites/tests (single legacy job). */
export async function enqueueMapJobTx(t, { prospectId, enrichmentRevision = 1, snapshot }) {
  // Legacy flat snapshot {facts:[{key,value,artifact}]} → sections.
  if (snapshot && !snapshot.sections && Array.isArray(snapshot.facts)) {
    const sections = {};
    for (const f of snapshot.facts) {
      const kind = ARTIFACT_KINDS.includes(f.artifact) ? f.artifact : 'form';
      (sections[kind] ||= { facts: [] }).facts.push({ key: f.key, value: f.value });
    }
    if (!sections.form) sections.form = { facts: [] };
    snapshot = { sections };
  }
  const ids = await enqueueMapJobsTx(t, { prospectId, formRevision: enrichmentRevision, snapshot });
  return ids[0] || null;
}

/** Expected current revision for an artifact kind (v1: quiz/profile pinned). */
function expectedRevision(kind, prospect) {
  return PINNED_REVISION_ARTIFACTS.has(kind) ? 1 : Number(prospect.enrichmentRevision || 1);
}

/**
 * Revision activation for ONE artifact under the fence (§3.1 parent plan):
 * supersede every other active mapper row for the artifact (any revision,
 * any pipelineVersion — including keys the new result omits), then insert.
 * Zero-fact results still activate.
 */
async function activateArtifactTx(t, { artifactId, revision, contentHash, prospect, facts, source }) {
  await sequelize.query(
    `UPDATE consumer_observations
        SET "supersededAt" = now(), "updatedAt" = now()
      WHERE "sourceArtifactId" = :artifact
        AND pipeline = :pipeline
        AND "supersededAt" IS NULL
        AND ("sourceRevisionId" <> :rev OR "pipelineVersion" <> :pv)`,
    { replacements: { artifact: artifactId, pipeline: MAPPER_PIPELINE, rev: revision, pv: MAPPER_PIPELINE_VERSION }, transaction: t }
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
          id: randomUUID(), pid: prospect.id, key: f.key, value: JSON.stringify(f.value),
          source, artifact: artifactId, rev: revision, hash: contentHash,
          eventAt: clampSourceEventAt(prospect.createdAt),
          pipeline: MAPPER_PIPELINE, pv: MAPPER_PIPELINE_VERSION,
        },
        transaction: t,
      }
    );
  }
}

const SOURCE_BY_KIND = { form: 'form', quiz: 'quiz', profile: 'form' };

/** Process one leased map job (dual-shape) to done/stale/dead/cancelled. */
async function processMapJob(job) {
  const finish = (status, lastError = null) =>
    EnrichmentJob.update(
      {
        status,
        lastError,
        ...(status === 'dead' || status === 'pending' ? { attempts: sequelize.literal('attempts + 1') } : {}),
      },
      { where: { id: job.id, leaseToken: job.leaseToken } }
    );

  try {
    const result = await withConsumerFence(job.subjectProspectId, async (t, { prospect, consumer }) => {
      if (job.pipelineVersion !== MAPPER_PIPELINE_VERSION) return { outcome: 'stale' };

      if (job.sourceArtifactId) {
        // Artifact-scoped job.
        const kind = String(job.sourceArtifactId).split(':')[0];
        if (!ARTIFACT_KINDS.includes(kind)) {
          throw Object.assign(new Error(`unknown artifact kind ${kind}`), { code: 'INVALID_FACT' });
        }
        if (Number(job.sourceRevisionId) !== expectedRevision(kind, prospect)) return { outcome: 'stale' };
        const facts = (job.payload?.facts || []);
        for (const f of facts) {
          const check = validateFact(f.key, f.value);
          if (!check.ok) throw Object.assign(new Error(`invalid fact ${f.key}: ${check.error}`), { code: 'INVALID_FACT' });
        }
        await activateArtifactTx(t, {
          artifactId: job.sourceArtifactId,
          revision: Number(job.sourceRevisionId),
          contentHash: job.sourceContentHash,
          prospect,
          facts,
          source: SOURCE_BY_KIND[kind],
        });
      } else {
        // LEGACY combined job (deploy-window / pre-v1.1 rows): split the
        // payload per artifact and activate form+quiz families — the legacy
        // writer always observed both at capture. Never single-artifact.
        if (Number(job.sourceRevisionId) !== Number(prospect.enrichmentRevision || 1)) return { outcome: 'stale' };
        const buckets = { form: [], quiz: [] };
        for (const f of job.payload?.facts || []) {
          const check = validateFact(f.key, f.value);
          if (!check.ok) throw Object.assign(new Error(`invalid fact ${f.key}: ${check.error}`), { code: 'INVALID_FACT' });
          (buckets[f.artifact === 'quiz' ? 'quiz' : 'form']).push({ key: f.key, value: f.value });
        }
        for (const kind of ['form', 'quiz']) {
          await activateArtifactTx(t, {
            artifactId: `${kind}:${prospect.id}`,
            revision: Number(job.sourceRevisionId),
            contentHash: job.sourceContentHash,
            prospect,
            facts: buckets[kind],
            source: SOURCE_BY_KIND[kind],
          });
        }
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
 * Claim + process pending map jobs (post-commit drain, remap script, and
 * the PR 2 sweep). Multi-instance safe (SKIP LOCKED + short internal
 * lease). Returns per-outcome counts plus the claimed job ids so callers
 * (the remap script) can do cohort-scoped accounting.
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
  const jobIds = [];
  for (const row of claimed) {
    jobIds.push(row.id);
    const outcome = await processMapJob({ ...row, leaseToken });
    if (outcomes[outcome] !== undefined) outcomes[outcome] += 1;
  }
  return { claimed: claimed.length, jobIds, ...outcomes };
}

export { ConsumerObservation, Prospect };
