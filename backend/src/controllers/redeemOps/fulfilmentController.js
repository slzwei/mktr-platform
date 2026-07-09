import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import entitlementService from '../../services/redeemOps/entitlementService.js';
import redemptionService from '../../services/redeemOps/redemptionService.js';

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

export const listEntitlements = asyncHandler(async (req, res) => {
  const data = await entitlementService.listEntitlements(req.query);
  res.json({ success: true, data });
});

export const unlockEntitlement = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({
      prospectId: Joi.string().uuid(),
      presentationToken: Joi.string().max(256),
    }).or('prospectId', 'presentationToken'),
    req.body
  );
  // Service enforces the consultant binding: non-admin callers must be the
  // lead's assigned consultant; role=admin overrides (audited as via=manual).
  const result = await entitlementService.unlockEntitlement(body, req.user, 'manual');
  const e = result.entitlement;
  res.json({
    success: true,
    data: {
      already: result.already,
      // The raw voucher token is NOT returned here — it travels to the
      // consumer via the unlock email; staff see only the hint.
      entitlement: {
        id: e.id,
        status: e.status,
        tokenHint: e.tokenHint,
        expiresAt: e.expiresAt,
        unlockedVia: e.unlockedVia,
      },
    },
  });
});

export const issueManual = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({
      activationId: Joi.string().uuid().required(),
      prospectId: Joi.string().uuid().required(),
    }),
    req.body
  );
  const result = await entitlementService.issueManual(body, req.user, req.id);
  res.status(201).json({
    success: true,
    data: {
      entitlement: result.entitlement,
      // Raw tokens are returned ONCE at manual issue for staff hand-delivery
      presentationToken: result.presentationToken || null,
      voucherToken: result.voucherToken || null,
    },
  });
});

export const cancelEntitlement = asyncHandler(async (req, res) => {
  const body = validateBody(Joi.object({ reason: Joi.string().max(255).required() }), req.body);
  const entitlement = await entitlementService.cancelEntitlement(req.params.id, req.user, body.reason, req.id);
  res.json({ success: true, data: { entitlement } });
});

export const verifyVoucher = asyncHandler(async (req, res) => {
  const body = validateBody(Joi.object({ token: Joi.string().min(6).max(128).required() }), req.body);
  const result = await redemptionService.verify(body.token, req.user, { actorType: 'staff' });
  res.json({
    success: true,
    data: {
      valid: result.valid,
      state: result.state,
      reward: result.reward,
      holder: result.holder, // unmasked under redemptions.verify (fulfilment identity check)
      entitlementId: result.entitlement.id,
    },
  });
});

export const completeRedemption = asyncHandler(async (req, res) => {
  const body = validateBody(
    Joi.object({
      token: Joi.string().min(6).max(128).required(),
      locationId: Joi.string().uuid().allow(null),
      method: Joi.string().valid('code', 'qr', 'partner_verification', 'manual_override'),
      notes: Joi.string().max(1000).allow('', null),
    }),
    req.body
  );
  const result = await redemptionService.complete(
    body.token,
    { locationId: body.locationId || null, method: body.method || 'code', notes: body.notes || null },
    req.user,
    { actorType: 'staff' }
  );
  res.json({
    success: true,
    message: result.already ? 'Already redeemed' : 'Redeemed',
    data: { redemption: result.redemption, already: result.already },
  });
});

export const reverseRedemption = asyncHandler(async (req, res) => {
  const body = validateBody(Joi.object({ reason: Joi.string().max(255).required() }), req.body);
  const redemption = await redemptionService.reverse(req.params.id, req.user, body.reason, req.id);
  res.json({ success: true, data: { redemption } });
});

export const listRedemptions = asyncHandler(async (req, res) => {
  const data = await redemptionService.listRedemptions(req.query);
  res.json({ success: true, data });
});
