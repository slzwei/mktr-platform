import express from 'express';
import { User, Prospect } from '../models/index.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sendLeadAssignmentEmail } from '../services/mailer.js';
import * as prospectService from '../services/prospectService.js';

const router = express.Router();

// Get all prospects
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const result = await prospectService.listProspects(req.user, req.query);

  res.json({
    success: true,
    data: result
  });
}));

// Create new prospect (lead capture)
router.post('/', validate(schemas.prospectCreate), asyncHandler(async (req, res) => {
  const { prospect, assignedAgentId } = await prospectService.createProspect(
    req.body,
    req.user,
    { cookies: req.cookies, headers: req.headers }
  );

  // Email sending OUTSIDE transaction (fire-and-forget, don't block response)
  if (assignedAgentId) {
    const agent = await User.findByPk(assignedAgentId);
    if (agent) {
      const prospectWithCampaign = await Prospect.findByPk(prospect.id, {
        include: [{ association: 'campaign', attributes: ['id', 'name'] }]
      });
      sendLeadAssignmentEmail(agent, prospectWithCampaign).catch(err =>
        console.error(`❌ Failed to send assignment email to agent ${assignedAgentId} for prospect ${prospect.id}:`, err.message || err)
      );
    }
  }

  res.status(201).json({
    success: true,
    message: 'Prospect created successfully',
    data: { prospect }
  });
}));

// Get prospect by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const prospect = await prospectService.getProspect(req.params.id, req.user);

  res.json({
    success: true,
    data: { prospect }
  });
}));

// Update prospect
router.put('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const prospect = await prospectService.updateProspect(req.params.id, req.body, req.user);

  res.json({
    success: true,
    message: 'Prospect updated successfully',
    data: { prospect }
  });
}));

// Delete prospect
router.delete('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  await prospectService.deleteProspect(req.params.id, req.user);

  res.json({
    success: true,
    message: 'Prospect deleted successfully'
  });
}));

// Bulk assign prospects (must be registered before /:id/assign to avoid param capture)
router.patch('/bulk/assign', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { prospectIds, agentId } = req.body;
  const { affectedCount, agent } = await prospectService.bulkAssignProspects(prospectIds, agentId, req.user);

  // Notify agent about bulk assignment
  if (affectedCount > 0) {
    sendLeadAssignmentEmail(agent, null, true, affectedCount).catch(err =>
      console.error(`❌ Failed to send bulk assignment email to agent ${agentId} for ${affectedCount} prospects:`, err.message || err)
    );
  }

  res.json({
    success: true,
    message: `${affectedCount} prospects assigned successfully`,
    data: { affectedCount }
  });
}));

// Assign prospect to agent
router.patch('/:id/assign', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { prospect, agent, prospectWithCampaign } = await prospectService.assignProspect(
    req.params.id,
    req.body.agentId,
    req.user
  );

  // Notify agent (fire-and-forget)
  sendLeadAssignmentEmail(agent, prospectWithCampaign).catch(err =>
    console.error(`❌ Failed to send assignment email to agent ${req.body.agentId} for prospect ${prospect.id}:`, err.message || err)
  );

  res.json({
    success: true,
    message: 'Prospect assigned successfully',
    data: { prospect }
  });
}));

// Get prospect statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const stats = await prospectService.getProspectStats(req.user);

  res.json({
    success: true,
    data: stats
  });
}));

// Update prospect follow-up date
router.patch('/:id/follow-up', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const prospect = await prospectService.scheduleFollowUp(req.params.id, req.body, req.user);

  res.json({
    success: true,
    message: 'Follow-up scheduled successfully',
    data: { prospect }
  });
}));

// Track prospect view
router.post('/:id/track-view', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  await prospectService.trackProspectView(req.params.id, req.user, {
    source: req.body.source,
    userAgent: req.headers['user-agent']
  });

  res.json({
    success: true,
    message: 'View tracked successfully'
  });
}));

export default router;
