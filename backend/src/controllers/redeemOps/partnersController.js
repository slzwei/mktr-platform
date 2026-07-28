import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import partnerService from '../../services/redeemOps/partnerService.js';
import { makeClaimService } from '../../services/redeemOps/claimService.js';
import { makeDedupeService } from '../../services/redeemOps/dedupeService.js';
import { BULK_MAX } from '../../services/redeemOps/bulkIds.js';
import { LOST_REASONS, PIPELINE_STAGES } from '../../services/redeemOps/constants.js';

const claimService = makeClaimService();
const dedupeService = makeDedupeService();

const partnerBodySchema = Joi.object({
  legalName: Joi.string().max(160).allow('', null),
  tradingName: Joi.string().max(160).allow('', null),
  brandName: Joi.string().max(120).allow('', null),
  uen: Joi.string().max(16).allow('', null),
  website: Joi.string().max(255).allow('', null),
  primaryPhone: Joi.string().pattern(/^\+[1-9]\d{9,14}$/).allow('', null)
    .messages({ 'string.pattern.base': 'primaryPhone must be E.164, e.g. +6591234567' }),
  primaryEmail: Joi.string().email().max(160).allow('', null),
  instagramHandle: Joi.string().max(120).allow('', null),
  tiktokHandle: Joi.string().max(120).allow('', null),
  facebookUrl: Joi.string().max(255).allow('', null),
  linkedinUrl: Joi.string().max(255).allow('', null),
  category: Joi.string().max(64).allow('', null),
  subcategory: Joi.string().max(64).allow('', null),
  source: Joi.string().max(64).allow('', null),
  tags: Joi.array().items(Joi.string().max(48)).max(20),
  notes: Joi.string().max(5000).allow('', null),
  overrideReason: Joi.string().max(255).allow('', null),
  // Marketplace public profile (migration 067). `verified` is a request
  // intent — admin-only, mapped to verifiedAt by the service.
  publicBlurb: Joi.string().max(600).allow('', null),
  partnerSince: Joi.number().integer().min(2000).max(2100).allow(null),
  verified: Joi.boolean(),
});

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

/** Coerce '' → null so blanks never collide on partial unique indexes. */
function blanksToNull(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === '' ? null : v;
  return out;
}

export const listPartners = asyncHandler(async (req, res) => {
  const data = await partnerService.listPartners(req.query, req.user);
  res.json({ success: true, data });
});

export const checkDuplicates = asyncHandler(async (req, res) => {
  const duplicates = await dedupeService.findDuplicates(req.query, req.query.excludeId || null);
  res.json({ success: true, data: { duplicates } });
});

export const createPartner = asyncHandler(async (req, res) => {
  const body = blanksToNull(validateBody(partnerBodySchema, req.body));
  const { partner, warnings } = await partnerService.createPartner(body, req.user, req.id);
  res.status(201).json({ success: true, data: { partner, warnings } });
});

export const getPartner = asyncHandler(async (req, res) => {
  const partner = await partnerService.getPartner(req.params.id);
  res.json({ success: true, data: { partner } });
});

export const updatePartner = asyncHandler(async (req, res) => {
  const body = blanksToNull(validateBody(partnerBodySchema, req.body));
  const partner = await partnerService.updatePartner(req.params.id, body, req.user, req.id);
  res.json({ success: true, data: { partner } });
});

export const claimPartner = asyncHandler(async (req, res) => {
  const result = await claimService.claimPartner(req.params.id, req.user, req.id);
  res.json({ success: true, message: 'Business claimed', data: result });
});

/**
 * Multi-select claim. Answers 200 with a per-row breakdown rather than a 409:
 * losing a race on 3 of 10 is a normal outcome the console reports, not a
 * failed request that should discard the 7 that worked.
 */
export const claimPartnersBulk = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    partnerIds: Joi.array().items(Joi.string().uuid()).min(1).max(100).required(),
  });
  const body = validateBody(schema, req.body);
  const result = await claimService.claimPartnersBulk(body.partnerIds, req.user, req.id);
  const n = result.claimed.length;
  res.json({
    success: true,
    message: n === body.partnerIds.length
      ? `${n} business${n === 1 ? '' : 'es'} claimed`
      : `${n} of ${body.partnerIds.length} claimed`,
    data: result,
  });
});

export const releasePartner = asyncHandler(async (req, res) => {
  await claimService.releasePartner(req.params.id, req.user, req.body?.reason || null, req.id);
  res.json({ success: true, message: 'Business released' });
});

export const assignPartner = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    toUserId: Joi.string().uuid().required(),
    reason: Joi.string().max(255).allow('', null),
  });
  const body = validateBody(schema, req.body);
  const partner = await claimService.assignPartner(req.params.id, body.toUserId, req.user, body.reason || null, req.id);
  res.json({ success: true, data: { partner } });
});

/**
 * The rest of the multi-select family. Each mirrors its single-row sibling's
 * capability at the route and answers 200 with a per-row breakdown: a batch
 * where some rows moved on since the page loaded is a normal outcome to report,
 * not a failed request that should discard the rows that did work.
 */
const bulkIdsSchema = Joi.array().items(Joi.string().uuid()).min(1).max(BULK_MAX).required();

/** "7 businesses released" / "7 of 10 released" — one phrasing for all of them. */
function bulkMessage(done, requested, verb) {
  return done === requested
    ? `${done} business${done === 1 ? '' : 'es'} ${verb}`
    : `${done} of ${requested} ${verb}`;
}

export const releasePartnersBulk = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    partnerIds: bulkIdsSchema,
    reason: Joi.string().max(255).allow('', null),
  });
  const body = validateBody(schema, req.body);
  const result = await claimService.releasePartnersBulk(
    body.partnerIds, req.user, body.reason || null, req.id
  );
  res.json({
    success: true,
    message: bulkMessage(result.released.length, body.partnerIds.length, 'released'),
    data: result,
  });
});

export const assignPartnersBulk = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    partnerIds: bulkIdsSchema,
    toUserId: Joi.string().uuid().required(),
    reason: Joi.string().max(255).allow('', null),
  });
  const body = validateBody(schema, req.body);
  const result = await claimService.assignPartnersBulk(
    body.partnerIds, body.toUserId, req.user, body.reason || null, req.id
  );
  res.json({
    success: true,
    message: bulkMessage(result.assigned.length, body.partnerIds.length, 'assigned'),
    data: result,
  });
});

export const changeStageBulk = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    partnerIds: bulkIdsSchema,
    toStage: Joi.string().valid(...PIPELINE_STAGES).required(),
    reason: Joi.string().max(255).allow('', null),
    // Same rule as the single-row move, enforced BEFORE the loop so a LOST
    // batch can't half-apply and then trip on a missing reason.
    lostReason: Joi.string().valid(...LOST_REASONS).allow(null)
      .when('toStage', { is: 'LOST', then: Joi.required() }),
  });
  const body = validateBody(schema, req.body);
  const result = await partnerService.changeStageBulk(body.partnerIds, body.toStage, req.user, {
    reason: body.reason || null,
    lostReason: body.lostReason || null,
    requestId: req.id,
  });
  res.json({
    success: true,
    message: bulkMessage(result.moved.length, body.partnerIds.length, 'moved'),
    data: result,
  });
});

export const changeStage = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    toStage: Joi.string().max(32).required(),
    reason: Joi.string().max(255).allow('', null),
    lostReason: Joi.string().valid(...LOST_REASONS).allow(null),
  });
  const body = validateBody(schema, req.body);
  const partner = await partnerService.changeStage(
    req.params.id, body.toStage, req.user, body.reason || null, req.id, body.lostReason || null
  );
  res.json({ success: true, data: { partner } });
});

export const snoozePartner = asyncHandler(async (req, res) => {
  const schema = Joi.object({ until: Joi.date().iso().required() });
  const body = validateBody(schema, req.body);
  const partner = await partnerService.snoozePartner(req.params.id, req.user, body.until, req.id);
  res.json({ success: true, data: { partner } });
});

export const unsnoozePartner = asyncHandler(async (req, res) => {
  const partner = await partnerService.unsnoozePartner(req.params.id, req.user, req.id);
  res.json({ success: true, data: { partner } });
});

export const mergePartners = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    duplicateId: Joi.string().uuid().required(),
    reason: Joi.string().max(255).allow('', null),
  });
  const body = validateBody(schema, req.body);
  const survivor = await partnerService.mergePartners(req.params.id, body.duplicateId, req.user, body.reason || null, req.id);
  res.json({ success: true, message: 'Merged', data: { partner: survivor } });
});

export const undoStage = asyncHandler(async (req, res) => {
  const partner = await partnerService.undoStageChange(req.params.id, req.user, req.id);
  res.json({ success: true, data: { partner } });
});

const importSchema = Joi.object({
  rows: Joi.array().items(Joi.object({
    tradingName: Joi.string().max(160).required(),
    category: Joi.string().max(64).allow('', null),
    primaryPhone: Joi.string().max(20).allow('', null),
    instagramHandle: Joi.string().max(120).allow('', null),
    website: Joi.string().max(255).allow('', null),
    uen: Joi.string().max(16).allow('', null),
    primaryEmail: Joi.string().max(160).allow('', null),
  })).min(1).max(100).required(),
});

export const importPartners = asyncHandler(async (req, res) => {
  const { rows } = validateBody(importSchema, req.body);
  const results = await partnerService.importPartners(rows.map(blanksToNull), req.user, req.id);
  res.json({ success: true, data: results });
});

export const deletePartner = asyncHandler(async (req, res) => {
  // force=true cascades the fulfilment chain (admin cleanup) — same
  // partners.delete capability; the service enforces the draw hard-stop.
  await partnerService.deletePartner(req.params.id, req.user, req.id, {
    force: req.query.force === 'true',
  });
  res.json({ success: true, message: 'Business deleted' });
});

export const getTimeline = asyncHandler(async (req, res) => {
  const data = await partnerService.getTimeline(req.params.id, req.query);
  res.json({ success: true, data });
});

export const logActivity = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    type: Joi.string().max(32).required(),
    direction: Joi.string().valid('outbound', 'inbound', 'internal'),
    summary: Joi.string().max(255).required(),
    details: Joi.string().max(10000).allow('', null),
    outcome: Joi.string().max(64).allow('', null),
    occurredAt: Joi.date().iso(),
    contactId: Joi.string().uuid().allow(null),
  });
  const body = validateBody(schema, req.body);
  const activity = await partnerService.logActivity(req.params.id, body, req.user, req.id);
  res.status(201).json({ success: true, data: { activity } });
});

export const editActivity = asyncHandler(async (req, res) => {
  const activity = await partnerService.editActivity(req.params.activityId, req.body || {}, req.user, req.id);
  res.json({ success: true, data: { activity } });
});

export const voidActivity = asyncHandler(async (req, res) => {
  await partnerService.voidActivity(req.params.activityId, req.user, req.body?.reason, req.id);
  res.json({ success: true, message: 'Activity voided' });
});

const contactSchema = Joi.object({
  name: Joi.string().max(120).required(),
  roleTitle: Joi.string().max(80).allow('', null),
  mobile: Joi.string().max(20).allow('', null),
  whatsapp: Joi.string().max(20).allow('', null),
  email: Joi.string().email().max(160).allow('', null),
  preferredChannel: Joi.string().valid('call', 'whatsapp', 'email', 'instagram', 'other').allow('', null),
  isPrimary: Joi.boolean(),
  notes: Joi.string().max(2000).allow('', null),
});

export const addContact = asyncHandler(async (req, res) => {
  const body = blanksToNull(validateBody(contactSchema, req.body));
  const contact = await partnerService.addContact(req.params.id, body, req.user);
  res.status(201).json({ success: true, data: { contact } });
});

export const updateContact = asyncHandler(async (req, res) => {
  const body = blanksToNull(validateBody(contactSchema.fork(['name'], (s) => s.optional()), req.body));
  const contact = await partnerService.updateContact(req.params.contactId, body, req.user);
  res.json({ success: true, data: { contact } });
});

export const archiveContact = asyncHandler(async (req, res) => {
  await partnerService.archiveContact(req.params.contactId, req.user);
  res.json({ success: true, message: 'Contact archived' });
});

const locationSchema = Joi.object({
  name: Joi.string().max(120).allow('', null),
  addressLine: Joi.string().max(255).allow('', null),
  postalCode: Joi.string().pattern(/^\d{6}$/).allow('', null)
    .messages({ 'string.pattern.base': 'postalCode must be 6 digits' }),
  area: Joi.string().max(64).allow('', null),
  phone: Joi.string().max(20).allow('', null),
  isActive: Joi.boolean(),
  notes: Joi.string().max(2000).allow('', null),
});

export const addLocation = asyncHandler(async (req, res) => {
  const body = blanksToNull(validateBody(locationSchema, req.body));
  const location = await partnerService.addLocation(req.params.id, body, req.user);
  res.status(201).json({ success: true, data: { location } });
});

export const updateLocation = asyncHandler(async (req, res) => {
  const body = blanksToNull(validateBody(locationSchema, req.body));
  const location = await partnerService.updateLocation(req.params.locationId, body, req.user);
  res.json({ success: true, data: { location } });
});
