import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import activationService from '../../services/redeemOps/activationService.js';
import campaignProjection from '../../services/redeemOps/campaignProjection.js';

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

export const searchCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await campaignProjection.searchCampaigns(req.query);
  res.json({ success: true, data: { campaigns } });
});

export const listActivations = asyncHandler(async (req, res) => {
  const activations = await activationService.listActivations(req.query);
  res.json({ success: true, data: { activations } });
});

export const getActivation = asyncHandler(async (req, res) => {
  const activation = await activationService.getActivation(req.params.id);
  let campaignRef = null;
  if (activation.campaignId) {
    campaignRef = await campaignProjection.getCampaignReference(activation.campaignId).catch(() => null);
  }
  res.json({ success: true, data: { activation, campaign: campaignRef } });
});

export const createActivation = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({
      rewardOfferId: Joi.string().uuid().required(),
      allocatedQuantity: Joi.number().integer().min(0),
      unlockPolicy: Joi.string().valid('on_capture', 'agent_unlock'),
      startDate: Joi.date().iso().allow(null),
      endDate: Joi.date().iso().allow(null),
      internalNotes: Joi.string().max(5000).allow('', null),
    }),
    req.body
  );
  const activation = await activationService.createActivation(body, req.user, req.id);
  res.status(201).json({ success: true, data: { activation } });
});

export const linkCampaign = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({ campaignId: Joi.string().uuid().allow(null).required() }),
    req.body
  );
  const activation = await activationService.linkCampaign(req.params.id, body.campaignId, req.user, req.id);
  res.json({ success: true, data: { activation } });
});

export const changeAllocation = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({
      delta: Joi.number().integer().invalid(0).required(),
      reason: Joi.string().max(255).allow('', null),
    }),
    req.body
  );
  const activation = await activationService.changeAllocation(req.params.id, body.delta, req.user, body.reason || null, req.id);
  res.json({ success: true, data: { activation } });
});

export const setStatus = asyncHandler(async (req, res) => {
  const body = validateBody(Joi.object({ status: Joi.string().required() }), req.body);
  const activation = await activationService.setStatus(req.params.id, body.status, req.user, req.id);
  res.json({ success: true, data: { activation } });
});

export const getCampaignMetrics = asyncHandler(async (req, res) => {
  const activation = await activationService.getActivation(req.params.id);
  if (!activation.campaignId) throw new AppError('No campaign linked to this activation', 400);
  const metrics = await campaignProjection.getCampaignMetrics(activation.campaignId);
  res.json({
    success: true,
    data: {
      acquisition: metrics, // MKTR's own numbers — never re-counted (MKTR_INTEGRATION.md §1)
      reward: {
        allocatedQuantity: activation.allocatedQuantity,
        issuedCount: activation.issuedCount,
        redeemedCount: activation.redeemedCount,
      },
    },
  });
});
