import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import taskService from '../../services/redeemOps/taskService.js';
import poolService from '../../services/redeemOps/poolService.js';
import queueService from '../../services/redeemOps/queueService.js';

function validateBody(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  return value;
}

export const getMyQueue = asyncHandler(async (req, res) => {
  const data = await queueService.getMyQueue(req.user);
  res.json({ success: true, data });
});

export const getTeamPipeline = asyncHandler(async (req, res) => {
  const data = await queueService.getTeamPipeline();
  res.json({ success: true, data });
});

// ── Tasks ──────────────────────────────────────────────────────────────────

const taskSchema = Joi.object({
  title: Joi.string().max(160).required(),
  partnerOrganisationId: Joi.string().uuid().required(),
  contactId: Joi.string().uuid().allow(null),
  assigneeUserId: Joi.string().uuid(),
  dueAt: Joi.date().iso().required(),
  hasTime: Joi.boolean(),
  priority: Joi.string().valid('low', 'medium', 'high'),
  type: Joi.string().valid('follow_up', 'call', 'meeting', 'proposal', 'admin', 'other'),
  description: Joi.string().max(5000).allow('', null),
});

export const listTasks = asyncHandler(async (req, res) => {
  const data = await taskService.listTasks(req.query, req.user);
  res.json({ success: true, data });
});

export const createTask = asyncHandler(async (req, res) => {
  const body = validateBody(taskSchema, req.body);
  const task = await taskService.createTask(body, req.user);
  res.status(201).json({ success: true, data: { task } });
});

export const updateTask = asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(req.params.taskId, req.body || {}, req.user);
  res.json({ success: true, data: { task } });
});

// ── Pools ──────────────────────────────────────────────────────────────────

export const listPools = asyncHandler(async (req, res) => {
  const pools = await poolService.listPools();
  res.json({ success: true, data: { pools } });
});

export const createPool = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().max(120).required(),
    description: Joi.string().max(2000).allow('', null),
    category: Joi.string().max(64).allow('', null),
    area: Joi.string().max(64).allow('', null),
  });
  const body = validateBody(schema, req.body);
  const pool = await poolService.createPool(body, req.user);
  res.status(201).json({ success: true, data: { pool } });
});

export const updatePool = asyncHandler(async (req, res) => {
  const pool = await poolService.updatePool(req.params.poolId, req.body || {}, req.user);
  res.json({ success: true, data: { pool } });
});

export const addPoolMembers = asyncHandler(async (req, res) => {
  const schema = Joi.object({ partnerIds: Joi.array().items(Joi.string().uuid()).min(1).max(500).required() });
  const body = validateBody(schema, req.body);
  const result = await poolService.addMembers(req.params.poolId, body.partnerIds, req.user);
  res.json({ success: true, data: result });
});

export const claimNext = asyncHandler(async (req, res) => {
  const partnerId = await poolService.claimNext(req.params.poolId, req.user);
  if (!partnerId) {
    return res.status(200).json({ success: true, message: 'Pool exhausted — no eligible prospects left', data: { partnerId: null } });
  }
  res.json({ success: true, message: 'Prospect claimed', data: { partnerId } });
});
