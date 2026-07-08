import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import rewardService from '../../services/redeemOps/rewardService.js';
import onboardingService from '../../services/redeemOps/onboardingService.js';

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

const offerSchema = Joi.object({
  partnerOrganisationId: Joi.string().uuid(),
  title: Joi.string().max(160),
  publicTitle: Joi.string().max(160).allow('', null),
  internalRef: Joi.string().max(64).allow('', null),
  description: Joi.string().max(5000).allow('', null),
  category: Joi.string().max(64).allow('', null),
  rewardType: Joi.string().max(24),
  retailValue: Joi.number().min(0).allow(null),
  fulfilmentCost: Joi.number().min(0).allow(null),
  fundingSource: Joi.string().valid('partner', 'mktr', 'shared'),
  committedQuantity: Joi.number().integer().min(0),
  validityStart: Joi.date().iso().allow(null),
  validityEnd: Joi.date().iso().allow(null),
  claimExpiryDays: Joi.number().integer().min(1).allow(null),
  redemptionExpiryDays: Joi.number().integer().min(1).allow(null),
  fulfilmentMethod: Joi.string().max(24),
  externalBookingUrl: Joi.string().max(255).allow('', null),
  terms: Joi.object({ structured: Joi.object(), freeText: Joi.string().max(10000).allow('', null) }),
});

export const listOffers = asyncHandler(async (req, res) => {
  const offers = await rewardService.listOffers(req.query);
  res.json({ success: true, data: { offers } });
});

export const getOffer = asyncHandler(async (req, res) => {
  const data = await rewardService.getOffer(req.params.id);
  res.json({ success: true, data });
});

export const createOffer = asyncHandler(async (req, res) => {
  const body = validateBody(
    offerSchema.fork(['partnerOrganisationId', 'title'], (s) => s.required()),
    req.body
  );
  const offer = await rewardService.createOffer(body, req.user, req.id);
  res.status(201).json({ success: true, data: { offer } });
});

export const updateOffer = asyncHandler(async (req, res) => {
  const body = validateBody(offerSchema, req.body);
  const offer = await rewardService.updateOffer(req.params.id, body, req.user, req.id);
  res.json({ success: true, data: { offer } });
});

export const setOfferStatus = asyncHandler(async (req, res) => {
  const body = validateBody(Joi.object({ status: Joi.string().required() }), req.body);
  const offer = await rewardService.setOfferStatus(req.params.id, body.status, req.user, req.id);
  res.json({ success: true, data: { offer } });
});

export const addTermsVersion = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({ structured: Joi.object(), freeText: Joi.string().max(10000).allow('', null) }),
    req.body
  );
  const terms = await rewardService.addTermsVersion(req.params.id, body, req.user, req.id);
  res.status(201).json({ success: true, data: { terms } });
});

export const setLocations = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({ partnerLocationIds: Joi.array().items(Joi.string().uuid()).max(100).required() }),
    req.body
  );
  const locations = await rewardService.setLocations(req.params.id, body.partnerLocationIds, req.user);
  res.json({ success: true, data: { locations } });
});

export const adjustInventory = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({
      type: Joi.string().valid('committed_increase', 'committed_decrease').required(),
      quantity: Joi.number().integer().min(1).required(),
      reason: Joi.string().max(255).required(),
    }),
    req.body
  );
  const result = await rewardService.adjustInventory(req.params.id, body, req.user, req.id);
  res.json({ success: true, data: result });
});

export const getLedger = asyncHandler(async (req, res) => {
  const events = await rewardService.getLedger(req.params.id, req.query);
  res.json({ success: true, data: { events } });
});

// ── Onboarding checklist (brief §22) ───────────────────────────────────────

export const getOnboarding = asyncHandler(async (req, res) => {
  let items = await onboardingService.getChecklist(req.params.id);
  if (items.length === 0) {
    // Lazily seed for partners that hit PARTNERED before Phase 4 shipped
    await onboardingService.seedChecklist(req.params.id);
    items = await onboardingService.getChecklist(req.params.id);
  }
  res.json({ success: true, data: { items } });
});

export const updateOnboardingItem = asyncHandler(async (req, res) => {
  const item = await onboardingService.updateItem(req.params.itemId, req.body || {}, req.user);
  res.json({ success: true, data: { item } });
});
