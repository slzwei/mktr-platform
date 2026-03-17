import { asyncHandler } from '../middleware/errorHandler.js';
import * as agentGroupService from '../services/agentGroupService.js';

export const listAgentGroups = asyncHandler(async (req, res) => {
  const groups = await agentGroupService.listAgentGroups();
  res.json({ success: true, data: groups });
});

export const createAgentGroup = asyncHandler(async (req, res) => {
  const group = await agentGroupService.createAgentGroup(req.body, req.user.id);
  res.status(201).json({ success: true, data: group });
});

export const updateAgentGroup = asyncHandler(async (req, res) => {
  const group = await agentGroupService.updateAgentGroup(req.params.id, req.body);
  res.json({ success: true, data: group });
});

export const deleteAgentGroup = asyncHandler(async (req, res) => {
  await agentGroupService.deleteAgentGroup(req.params.id);
  res.json({ success: true, message: 'Agent group deleted' });
});
