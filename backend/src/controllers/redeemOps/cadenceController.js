import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import cadenceService from '../../services/redeemOps/cadenceService.js';
import { LOST_REASONS } from '../../services/redeemOps/constants.js';

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

export const listCadences = asyncHandler(async (req, res) => {
  const cadences = await cadenceService.listCadences();
  res.json({ success: true, data: { cadences } });
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
