#!/usr/bin/env node
/**
 * Enrichment remap — re-derive mapper observations for the EXISTING
 * population at the CURRENT pipeline version
 * (docs/plans/studio-profile-questions.md §5.3).
 *
 * Bumping MAPPER_PIPELINE_VERSION creates no work by itself (the nightly
 * sweep is PR 2); this script is the explicit, observable backfill:
 *
 *   node scripts/remap-observations.mjs [--dry-run] [--batch=200]
 *
 * Design (Codex PR0 R2 #5):
 * - FROZEN COHORT: a (createdAt, id) watermark is fixed up front; only
 *   prospects at-or-before it are enumerated. Post-watermark captures
 *   self-enqueue at the new version anyway.
 * - COHORT-SCOPED ACCOUNTING: only jobs THIS RUN inserted are counted —
 *   drainMapJobs claims any pending map job, so raw drain counts would
 *   swallow live capture traffic.
 * - Quiz artifacts: NEVER remapped from live definitions (Studio edits
 *   quizzes without minting versions — that could mint facts the person
 *   never stated). Form/profile sections re-derive from the prospect row;
 *   quiz stays whatever its frozen capture-time job produced. Prospects
 *   whose quiz facts cannot be re-proven are reported as skipped.
 * - Idempotent for live-unique statuses (pending/leased/done); previously
 *   stale/dead/cancelled jobs re-enqueue by design (they left the unique).
 * - PRECONDITION: every serving instance runs artifact-aware code (the 092
 *   expand step is deployed) before this starts.
 *
 * Requires ENRICHMENT_MAP_ARTIFACT_JOBS=true (the artifact-scoped writes
 * flag) — refuses to run otherwise.
 */
import { sequelize } from '../src/database/connection.js';
import '../src/models/index.js';
import {
  buildFactSnapshot, enqueueMapJobsTx, drainMapJobs, artifactJobsEnabled,
  MAPPER_PIPELINE_VERSION,
} from '../src/services/factMapperService.js';
import { getProfileQuestion, resolveAnswer } from '../src/utils/profileQuestionLibrary.js';
import { logger } from '../src/utils/logger.js';

/**
 * Re-derive profile facts from the durable canonical answer ids
 * (sourceMetadata.profileAnswers). SAFE to re-resolve — the profile library
 * is code-fixed, unlike Studio quiz definitions (§5.2): flag-off captures
 * during the deploy window stored answers without minting facts, and this
 * is where those catch up.
 */
function profileFactsFrom(sourceMetadata) {
  const answers = sourceMetadata?.profileAnswers;
  if (!answers || typeof answers !== 'object') return undefined;
  const facts = [];
  for (const [qid, provided] of Object.entries(answers)) {
    const q = getProfileQuestion(qid);
    if (!q) continue;
    const value = resolveAnswer(qid, provided);
    if (value) facts.push({ key: q.factKey, value });
  }
  return facts.length ? facts : undefined;
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const BATCH = Number((args.find((a) => a.startsWith('--batch=')) || '').split('=')[1]) || 200;

async function main() {
  if (!artifactJobsEnabled()) {
    console.error('ENRICHMENT_MAP_ARTIFACT_JOBS is not true — flip the flag (post-deploy) first.');
    process.exit(1);
  }

  // Watermark: freeze the cohort before any work.
  const [[wm]] = await sequelize.query(
    'SELECT max("createdAt") AS ts FROM prospects'
  );
  const watermark = wm?.ts;
  if (!watermark) {
    console.log('No prospects — nothing to remap.');
    process.exit(0);
  }
  console.log(`[remap] pipeline=${MAPPER_PIPELINE_VERSION} watermark=${new Date(watermark).toISOString()} dryRun=${DRY}`);

  const insertedJobIds = new Set();
  let cursor = { createdAt: new Date(0).toISOString(), id: '00000000-0000-0000-0000-000000000000' };
  let scanned = 0;
  let enqueued = 0;
  let quizSkipped = 0;

  for (;;) {
    const [rows] = await sequelize.query(
      `SELECT id, "createdAt", demographics, "sourceMetadata", "enrichmentRevision"
         FROM prospects
        WHERE ("createdAt", id) > (:ts, :id) AND "createdAt" <= :wm
        ORDER BY "createdAt", id
        LIMIT :batch`,
      { replacements: { ts: cursor.createdAt, id: cursor.id, wm: watermark, batch: BATCH } }
    );
    if (!rows.length) break;

    for (const p of rows) {
      scanned += 1;
      // Quiz: frozen-payload-only (§5.2). If the prospect has server-scored
      // quiz answers, its capture-time job already carries the resolved
      // facts; we do NOT rebuild them here — and report that we didn't.
      if (p.sourceMetadata?.quiz?.scoredBy === 'server') quizSkipped += 1;

      const snapshot = buildFactSnapshot({
        demographics: p.demographics || {},
        profileFacts: profileFactsFrom(p.sourceMetadata),
      });
      if (DRY) continue;
      await sequelize.transaction(async (t) => {
        const ids = await enqueueMapJobsTx(t, {
          prospectId: p.id,
          formRevision: Number(p.enrichmentRevision || 1),
          snapshot,
        });
        for (const id of ids) insertedJobIds.add(id);
        enqueued += ids.length;
      });
    }

    const last = rows[rows.length - 1];
    cursor = { createdAt: new Date(last.createdAt).toISOString(), id: last.id };
    console.log(`[remap] scanned=${scanned} enqueued=${enqueued}`);

    if (!DRY) await drainMapJobs({ limit: BATCH });
  }

  // Drain to quiet, then account for OUR jobs only.
  if (!DRY) {
    for (let i = 0; i < 50; i += 1) {
      const res = await drainMapJobs({ limit: 50 });
      if (res.claimed === 0) break;
    }
  }

  let outcome = {};
  if (insertedJobIds.size) {
    const [counts] = await sequelize.query(
      'SELECT status, count(*)::int AS n FROM enrichment_jobs WHERE id IN (:ids) GROUP BY status',
      { replacements: { ids: [...insertedJobIds] } }
    );
    outcome = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  }

  console.log('[remap] COMPLETE', JSON.stringify({
    scanned,
    enqueuedByThisRun: insertedJobIds.size,
    outcomesForThisRun: outcome,
    quizArtifactsLeftFrozen: quizSkipped,
    dryRun: DRY,
  }, null, 2));
  await sequelize.close();
}

main().catch((err) => {
  logger.error('[remap] failed', { error: err?.message || String(err) });
  console.error(err);
  process.exit(1);
});
