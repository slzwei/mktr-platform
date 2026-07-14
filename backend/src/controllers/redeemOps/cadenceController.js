import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import cadenceService from '../../services/redeemOps/cadenceService.js';
import cadenceAiService, { cadenceAiEnabled } from '../../services/redeemOps/cadenceAiService.js';
import { LOST_REASONS } from '../../services/redeemOps/constants.js';

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

export const listCadences = asyncHandler(async (req, res) => {
  const cadences = await cadenceService.listCadences({ includeRetired: req.query.all === 'true' });
  // aiEnabled drives the editor's "Draft with AI" card — same helper the
  // suggest endpoint gates on, so the UI can never disagree with the API.
  res.json({ success: true, data: { cadences, aiEnabled: cadenceAiEnabled() } });
});

const suggestSchema = Joi.object({
  prompt: Joi.string().trim().min(3).max(1000).required(),
  // Matches the editor's Steps select (2-12). Omitted = model picks 4-7.
  stepCount: Joi.number().integer().min(2).max(12),
});

/** POST /cadences/suggest — free-text brief → builder-dialect draft. Populates
 *  the editor only; creating the cadence stays on the human-reviewed path. */
export const suggestCadence = asyncHandler(async (req, res) => {
  const body = validateBody(suggestSchema, req.body || {});
  const draft = await cadenceAiService.suggestCadence(body, req.user, req.id);
  res.json({ success: true, data: { draft } });
});

const stepSchema = Joi.object({
  channel: Joi.string().valid('call', 'whatsapp', 'email', 'instagram_dm', 'visit', 'custom').required(),
  title: Joi.string().max(160).required(),
  script: Joi.string().max(5000).allow('', null),
  priority: Joi.string().valid('low', 'medium', 'high'),
  delayDays: Joi.number().integer().min(0).max(60).required(),
  timeWindow: Joi.string().valid('any', 'morning', 'afternoon', 'off_peak'),
  continueOn: Joi.string().max(24).allow(null),
});
const cadenceDefSchema = Joi.object({
  name: Joi.string().max(120).required(),
  description: Joi.string().max(2000).allow('', null),
  steps: Joi.array().items(stepSchema).min(1).max(20).required(),
});

export const createCadence = asyncHandler(async (req, res) => {
  const body = validateBody(cadenceDefSchema, req.body || {});
  const cadence = await cadenceService.createCadence(body, req.user, req.id);
  res.status(201).json({ success: true, data: { cadence } });
});

export const createCadenceVersion = asyncHandler(async (req, res) => {
  const body = validateBody(cadenceDefSchema, req.body || {});
  const cadence = await cadenceService.createCadenceVersion(req.params.cadenceId, body, req.user, req.id);
  res.status(201).json({ success: true, data: { cadence } });
});

export const retireCadence = asyncHandler(async (req, res) => {
  const cadence = await cadenceService.retireCadence(req.params.cadenceId, req.user, req.id);
  res.json({ success: true, data: { cadence } });
});

export const getPartnerCadence = asyncHandler(async (req, res) => {
  const data = await cadenceService.getPartnerCadence(req.params.partnerId);
  res.json({ success: true, data });
});

const enrollSchema = Joi.object({
  cadenceId: Joi.string().uuid(),
  cadenceKey: Joi.string().max(64),
  overrideCapacity: Joi.boolean(),
}).or('cadenceId', 'cadenceKey');

export const enroll = asyncHandler(async (req, res) => {
  const body = validateBody(enrollSchema, req.body || {});
  const result = await cadenceService.enrollPartner(req.params.partnerId, body, req.user, req.id);
  res.status(201).json({ success: true, data: result });
});

const completeSchema = Joi.object({
  disposition: Joi.string().max(24).required(),
  alsoMarkLost: Joi.boolean(),
  lostReason: Joi.string().valid(...LOST_REASONS),
});

export const completeCadenceTask = asyncHandler(async (req, res) => {
  const body = validateBody(completeSchema, req.body || {});
  const result = await cadenceService.completeCadenceTask(req.params.taskId, body, req.user, req.id);
  res.json({ success: true, data: result });
});

export const pause = asyncHandler(async (req, res) => {
  const enrollment = await cadenceService.pauseEnrollment(req.params.partnerId, req.user, req.id);
  res.json({ success: true, data: { enrollment } });
});

export const resume = asyncHandler(async (req, res) => {
  const enrollment = await cadenceService.resumeEnrollment(req.params.partnerId, req.user, req.id);
  res.json({ success: true, data: { enrollment } });
});

export const stop = asyncHandler(async (req, res) => {
  const enrollment = await cadenceService.stopEnrollment(req.params.partnerId, req.user, req.id);
  res.json({ success: true, data: { enrollment } });
});
