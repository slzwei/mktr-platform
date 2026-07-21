import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  EmailBroadcast, EmailBroadcastRecipient, Cohort, Campaign,
} from '../models/index.js';
import {
  startBroadcastSend, cancelBroadcast, sendTestEmail, liveBroadcastCounts, buildCtaUrl,
} from '../services/emailBroadcastService.js';
import { customerHostOrigin, normalizeCustomerHostChoice } from '../utils/customerHost.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed ids 404 up front (the AdminCampaignDesigner lesson). */
async function findBroadcastOr404(id, include = []) {
  if (!UUID_RE.test(String(id || ''))) throw new AppError('Broadcast not found', 404);
  const broadcast = await EmailBroadcast.findByPk(id, { include });
  if (!broadcast) throw new AppError('Broadcast not found', 404);
  return broadcast;
}

const cohortInclude = { model: Cohort, as: 'cohort', attributes: ['id', 'name', 'definition', 'archivedAt'] };
const campaignInclude = { model: Campaign, as: 'campaign', attributes: ['id', 'name', 'status', 'is_active', 'design_config'] };

function serializeBroadcast(b, { withDefinition = false } = {}) {
  return {
    id: b.id,
    cohortId: b.cohortId,
    campaignId: b.campaignId,
    subject: b.subject,
    bodyText: b.bodyText,
    ctaLabel: b.ctaLabel,
    ctaUrl: b.ctaUrl,
    hostChoice: b.hostChoice,
    status: b.status,
    totalRecipients: b.totalRecipients,
    sentCount: b.sentCount,
    skippedCount: b.skippedCount,
    failedCount: b.failedCount,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
    lastError: b.lastError,
    createdBy: b.createdBy,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    cohort: b.cohort
      ? {
          id: b.cohort.id,
          name: b.cohort.name,
          ...(withDefinition ? { definition: b.cohort.definition } : {}),
        }
      : null,
    campaign: b.campaign
      ? { id: b.campaign.id, name: b.campaign.name, status: b.campaign.status, is_active: b.campaign.is_active }
      : null,
  };
}

export const create = asyncHandler(async (req, res) => {
  const cohort = await Cohort.findByPk(req.body.cohortId);
  if (!cohort || cohort.archivedAt) throw new AppError('Cohort not found', 422);
  const campaign = await Campaign.findByPk(req.body.campaignId);
  if (!campaign) throw new AppError('Campaign not found', 422);

  const broadcast = await EmailBroadcast.create({
    cohortId: cohort.id,
    campaignId: campaign.id,
    subject: req.body.subject.trim(),
    bodyText: req.body.bodyText.trim(),
    ctaLabel: req.body.ctaLabel?.trim() || 'Learn more',
    createdBy: req.user?.id || null,
  });
  const full = await findBroadcastOr404(broadcast.id, [cohortInclude, campaignInclude]);
  res.status(201).json({ success: true, data: serializeBroadcast(full, { withDefinition: true }) });
});

export const list = asyncHandler(async (req, res) => {
  const broadcasts = await EmailBroadcast.findAll({
    include: [cohortInclude, campaignInclude],
    order: [['createdAt', 'DESC']],
    limit: 200,
  });
  res.json({ success: true, data: broadcasts.map((b) => serializeBroadcast(b)) });
});

export const get = asyncHandler(async (req, res) => {
  const b = await findBroadcastOr404(req.params.id, [cohortInclude, campaignInclude]);
  // Drafts show what the CTA WILL be; started broadcasts show the frozen truth.
  let ctaUrlPreview = b.ctaUrl;
  if (!ctaUrlPreview && b.campaign) {
    const hostChoice = normalizeCustomerHostChoice(b.campaign.design_config?.customerHost);
    ctaUrlPreview = buildCtaUrl({ origin: customerHostOrigin(hostChoice), campaignId: b.campaign.id, broadcastId: b.id });
  }
  const counts = await liveBroadcastCounts(b.id);
  res.json({
    success: true,
    data: { ...serializeBroadcast(b, { withDefinition: true }), ctaUrlPreview, liveCounts: counts },
  });
});

export const update = asyncHandler(async (req, res) => {
  const b = await findBroadcastOr404(req.params.id);
  const patch = {};
  if (req.body.subject !== undefined) patch.subject = req.body.subject.trim();
  if (req.body.bodyText !== undefined) patch.bodyText = req.body.bodyText.trim();
  if (req.body.ctaLabel !== undefined) patch.ctaLabel = req.body.ctaLabel?.trim() || 'Learn more';
  if (req.body.cohortId !== undefined) {
    const cohort = await Cohort.findByPk(req.body.cohortId);
    if (!cohort || cohort.archivedAt) throw new AppError('Cohort not found', 422);
    patch.cohortId = cohort.id;
  }
  if (req.body.campaignId !== undefined) {
    const campaign = await Campaign.findByPk(req.body.campaignId);
    if (!campaign) throw new AppError('Campaign not found', 422);
    patch.campaignId = campaign.id;
  }
  // Conditional on draft — an edit can never race a started send (§3.1).
  const [count] = await EmailBroadcast.update(patch, { where: { id: b.id, status: 'draft' } });
  if (count === 0) throw new AppError(`Broadcast is ${b.status} — only drafts can be edited`, 409);
  const full = await findBroadcastOr404(b.id, [cohortInclude, campaignInclude]);
  res.json({ success: true, data: serializeBroadcast(full, { withDefinition: true }) });
});

export const destroy = asyncHandler(async (req, res) => {
  const b = await findBroadcastOr404(req.params.id);
  const count = await EmailBroadcast.destroy({ where: { id: b.id, status: 'draft' } });
  if (count === 0) throw new AppError(`Broadcast is ${b.status} — only drafts can be deleted (history is audit)`, 409);
  res.json({ success: true, data: { id: b.id, deleted: true } });
});

export const send = asyncHandler(async (req, res) => {
  await findBroadcastOr404(req.params.id);
  const { broadcast } = await startBroadcastSend(req.params.id, { resume: req.body?.resume === true });
  // 202-style: the worker runs post-response; the UI polls the detail DTO.
  res.status(202).json({ success: true, data: { id: broadcast.id, status: broadcast.status, totalRecipients: broadcast.totalRecipients } });
});

export const cancel = asyncHandler(async (req, res) => {
  await findBroadcastOr404(req.params.id);
  const broadcast = await cancelBroadcast(req.params.id);
  res.json({ success: true, data: { id: broadcast.id, status: broadcast.status } });
});

export const test = asyncHandler(async (req, res) => {
  await findBroadcastOr404(req.params.id);
  const result = await sendTestEmail(req.params.id, req.user);
  res.json({ success: true, data: { sentTo: result.to } });
});

export const recipients = asyncHandler(async (req, res) => {
  const b = await findBroadcastOr404(req.params.id);
  const status = String(req.query.status || 'all');
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const where = { broadcastId: b.id, ...(status !== 'all' ? { status } : {}) };
  const { rows, count } = await EmailBroadcastRecipient.findAndCountAll({
    where,
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    limit,
    offset,
  });
  res.json({
    success: true,
    data: {
      broadcastId: b.id,
      total: count,
      limit,
      offset,
      recipients: rows.map((r) => ({
        id: r.id,
        consumerId: r.consumerId,
        email: r.email,
        status: r.status,
        reason: r.reason,
        error: r.error,
        sentAt: r.sentAt,
      })),
    },
  });
});
