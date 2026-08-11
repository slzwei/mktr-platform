import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import outreachPersonaService from '../../services/redeemOps/outreachPersonaService.js';
import outreachSenderService from '../../services/redeemOps/outreachSenderService.js';

/**
 * Outreach sending identities — Phase A (plan §7). Everything here is
 * `settings.manage` (route-level): connecting a Workspace account and mapping
 * personas is admin work, same tier as categories.
 */

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

const setupSchema = Joi.object({
  accountEmail: Joi.string().email().required(),
  // The pasted service-account key file. Validated + encrypted server-side;
  // never returned by any endpoint.
  serviceAccountJson: Joi.string().min(100).max(20000).required(),
});

export const getAccount = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await outreachPersonaService.getAccountStatus() });
});

export const setupAccount = asyncHandler(async (req, res) => {
  const body = validateBody(setupSchema, req.body || {});
  const result = await outreachPersonaService.setupAccount(body, req.user, req.id);
  res.json({ success: true, data: result });
});

export const refreshHealth = asyncHandler(async (req, res) => {
  const health = await outreachPersonaService.refreshHealth(req.user, req.id);
  res.json({ success: true, data: { health } });
});

export const workspaceAddresses = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await outreachPersonaService.listWorkspaceAddresses() });
});

export const listPersonas = asyncHandler(async (req, res) => {
  const personas = await outreachPersonaService.listPersonas();
  res.json({ success: true, data: { personas } });
});

const importSchema = Joi.object({
  addresses: Joi.array().items(Joi.string().email()).min(1).max(30).required(),
});

export const importPersonas = asyncHandler(async (req, res) => {
  const body = validateBody(importSchema, req.body || {});
  const result = await outreachPersonaService.importPersonas(body, req.user, req.id);
  res.status(201).json({ success: true, data: result });
});

const updateSchema = Joi.object({
  assignedUserId: Joi.string().uuid().allow(null),
  displayName: Joi.string().max(120),
  dailySendCap: Joi.number().integer().min(1).max(200),
  isActive: Joi.boolean(),
}).min(1);

export const updatePersona = asyncHandler(async (req, res) => {
  const body = validateBody(updateSchema, req.body || {});
  const persona = await outreachPersonaService.updatePersona(req.params.personaId, body, req.user, req.id);
  res.json({ success: true, data: { persona } });
});

export const testSend = asyncHandler(async (req, res) => {
  const result = await outreachPersonaService.testSend(req.params.personaId, req.user, req.id);
  res.json({ success: true, data: result });
});

// ── Scheduled-email operations (Phase B; owner-or-admin row rules in the service) ──

export const approveEmail = asyncHandler(async (req, res) => {
  const email = await outreachSenderService.approve(req.params.emailId, req.user, req.id);
  res.json({ success: true, data: { email } });
});

export const sendNowEmail = asyncHandler(async (req, res) => {
  const email = await outreachSenderService.sendNow(req.params.emailId, req.user, req.id);
  res.json({ success: true, data: { email } });
});

export const convertEmailToManual = asyncHandler(async (req, res) => {
  const email = await outreachSenderService.convertToManual(req.params.emailId, req.user, req.id);
  res.json({ success: true, data: { email } });
});
