import { asyncHandler } from '../middleware/errorHandler.js';
import * as agentService from '../services/agentService.js';

export const listAgents = asyncHandler(async (req, res) => {
  const result = await agentService.listAgents(req.query);

  res.json({
    success: true,
    data: result
  });
});

export const getAgent = asyncHandler(async (req, res) => {
  const agent = await agentService.getAgentDetail(req.params.id, req.user);

  res.json({
    success: true,
    data: { agent }
  });
});

export const updateAgent = asyncHandler(async (req, res) => {
  const agent = await agentService.updateAgent(req.params.id, req.body, req.user);

  res.json({
    success: true,
    message: 'Agent profile updated successfully',
    data: { agent }
  });
});

export const getAgentProspects = asyncHandler(async (req, res) => {
  const result = await agentService.getAgentProspects(req.params.id, req.query, req.user);

  res.json({
    success: true,
    data: result
  });
});

export const getAgentCommissions = asyncHandler(async (req, res) => {
  const result = await agentService.getAgentCommissions(req.params.id, req.query, req.user);

  res.json({
    success: true,
    data: result
  });
});

export const getAgentCampaigns = asyncHandler(async (req, res) => {
  const result = await agentService.getAgentCampaigns(req.params.id, req.query, req.user);

  res.json({
    success: true,
    data: result
  });
});

export const getLeaderboard = asyncHandler(async (req, res) => {
  const result = await agentService.getLeaderboard(req.query);

  res.json({
    success: true,
    data: result
  });
});

export const getAgentStats = asyncHandler(async (req, res) => {
  const agent = await agentService.getAgentDetail(req.params.id, req.user);

  res.json({
    success: true,
    data: { agent }
  });
});

export const getAgentMonthlyPerformance = asyncHandler(async (req, res) => {
  const performance = await agentService.getAgentMonthlyPerformance(req.params.id);

  res.json({
    success: true,
    data: { monthlyPerformance: performance }
  });
});

export const inviteAgent = asyncHandler(async (req, res) => {
  const { email, full_name, owed_leads_count = 0 } = req.body;

  const { user, inviteLink } = await agentService.inviteAgent(
    email,
    full_name,
    owed_leads_count,
    req.user
  );

  res.status(201).json({
    success: true,
    message: 'Agent invited',
    data: { user: user.toJSON(), inviteLink }
  });
});
