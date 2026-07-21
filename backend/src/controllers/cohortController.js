import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { Cohort } from '../models/index.js';
import {
  previewCohort as previewCohortSvc,
  listCohortMembers,
  getCohortFacets,
  snapshotCohort,
  snapshotFields,
  normalizeDefinition,
} from '../services/cohortService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed ids 404 up front (raw uuid-cast errors surface as 500s — the
 * AdminCampaignDesigner lesson, same as consumerController). */
async function findCohortOr404(id) {
  if (!UUID_RE.test(String(id || ''))) throw new AppError('Cohort not found', 404);
  const cohort = await Cohort.findByPk(id);
  if (!cohort || cohort.archivedAt) throw new AppError('Cohort not found', 404);
  return cohort;
}

function serializeCohort(cohort) {
  return {
    id: cohort.id,
    name: cohort.name,
    description: cohort.description,
    definition: cohort.definition,
    createdBy: cohort.createdBy,
    lastTotalCount: cohort.lastTotalCount,
    lastReachableCount: cohort.lastReachableCount,
    lastPreviewBreakdown: cohort.lastPreviewBreakdown,
    lastPreviewAt: cohort.lastPreviewAt,
    createdAt: cohort.createdAt,
    updatedAt: cohort.updatedAt,
  };
}

/** Stateless definition → counts (drives the UI live preview). */
export const preview = asyncHandler(async (req, res) => {
  const result = await previewCohortSvc(req.body.definition, { channel: req.body.channel });
  res.json({ success: true, data: result });
});

/** Live filter vocabulary (attribute values, tags, campaigns, draws). */
export const facets = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getCohortFacets() });
});

export const create = asyncHandler(async (req, res) => {
  // Normalize + preview BEFORE persisting, then write definition and
  // snapshot in ONE create — a failing resolution leaves no half-created
  // row, and the stored definition is the canonical shape (deduped lists,
  // defaulted 18+ gate), not whatever the client typed.
  const definition = normalizeDefinition(req.body.definition);
  const previewResult = await previewCohortSvc(definition);
  const cohort = await Cohort.create({
    name: req.body.name.trim(),
    description: req.body.description?.trim() || null,
    definition,
    createdBy: req.user?.id || null,
    ...snapshotFields(previewResult),
  });
  res.status(201).json({ success: true, data: { ...serializeCohort(cohort), preview: previewResult } });
});

export const list = asyncHandler(async (req, res) => {
  const cohorts = await Cohort.findAll({
    where: { archivedAt: null },
    order: [['createdAt', 'DESC']],
    limit: 200,
  });
  res.json({ success: true, data: cohorts.map(serializeCohort) });
});

export const get = asyncHandler(async (req, res) => {
  const cohort = await findCohortOr404(req.params.id);
  let previewResult = null;
  if (String(req.query.refresh || '') === '1') {
    previewResult = await snapshotCohort(cohort);
  }
  res.json({ success: true, data: { ...serializeCohort(cohort), ...(previewResult ? { preview: previewResult } : {}) } });
});

export const update = asyncHandler(async (req, res) => {
  const cohort = await findCohortOr404(req.params.id);
  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name.trim();
  if (req.body.description !== undefined) patch.description = req.body.description?.trim() || null;
  let previewResult = null;
  if (req.body.definition !== undefined) {
    // Same order as create: resolve first, persist definition + fresh
    // snapshot together.
    patch.definition = normalizeDefinition(req.body.definition);
    previewResult = await previewCohortSvc(patch.definition);
    Object.assign(patch, snapshotFields(previewResult));
  }
  await cohort.update(patch);
  res.json({ success: true, data: { ...serializeCohort(cohort), ...(previewResult ? { preview: previewResult } : {}) } });
});

/** Soft-archive; idempotent (archiving an archived/unknown id 404s like GET). */
export const archive = asyncHandler(async (req, res) => {
  const cohort = await findCohortOr404(req.params.id);
  await cohort.update({ archivedAt: new Date() });
  res.json({ success: true, data: { id: cohort.id, archivedAt: cohort.archivedAt } });
});

export const members = asyncHandler(async (req, res) => {
  const cohort = await findCohortOr404(req.params.id);
  const result = await listCohortMembers(cohort.definition, {
    channel: req.query.channel,
    status: req.query.status || 'all',
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json({ success: true, data: { cohortId: cohort.id, name: cohort.name, ...result } });
});
