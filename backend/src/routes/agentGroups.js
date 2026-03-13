import express from 'express';
import { AgentGroup, Campaign, QrTag } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// List all agent groups
router.get('/', asyncHandler(async (req, res) => {
  const groups = await AgentGroup.findAll({
    order: [['createdAt', 'DESC']],
    include: [{ association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] }]
  });
  res.json({ success: true, data: groups });
}));

// Create agent group
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, agents } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, message: 'name is required' });
  }

  const agentList = agents || [];
  const group = await AgentGroup.create({
    name,
    description: description || null,
    agents: agentList,
    agentCount: agentList.length,
    createdBy: req.user.id
  });

  res.status(201).json({ success: true, data: group });
}));

// Update agent group
router.put('/:id', asyncHandler(async (req, res) => {
  const group = await AgentGroup.findByPk(req.params.id);
  if (!group) {
    return res.status(404).json({ success: false, message: 'Agent group not found' });
  }

  const { name, description, agents } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (agents !== undefined) {
    updateData.agents = agents;
    updateData.agentCount = agents.length;
  }

  await group.update(updateData);
  res.json({ success: true, data: group });
}));

// Delete agent group
router.delete('/:id', asyncHandler(async (req, res) => {
  const group = await AgentGroup.findByPk(req.params.id);
  if (!group) {
    return res.status(404).json({ success: false, message: 'Agent group not found' });
  }

  // Check if any active campaigns reference this group
  const campaignCount = await Campaign.count({
    where: {
      agentGroupId: group.id,
      status: ['active', 'draft']
    }
  });

  // Check if any QR tags reference this group
  const qrTagCount = await QrTag.count({ where: { agentGroupId: group.id } });

  const inUseCount = campaignCount + qrTagCount;
  if (inUseCount > 0) {
    const parts = [];
    if (campaignCount > 0) parts.push(`${campaignCount} active campaign(s)`);
    if (qrTagCount > 0) parts.push(`${qrTagCount} QR code(s)`);
    return res.status(409).json({
      success: false,
      message: `Cannot delete: ${parts.join(' and ')} reference this group`
    });
  }

  await group.destroy();
  res.json({ success: true, message: 'Agent group deleted' });
}));

export default router;
