import express from 'express';
import { Op } from 'sequelize';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { fetchAgents, fetchAgentGroups, fetchAgentById, invalidateCache } from '../services/agentSyncService.js';
import User from '../models/User.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Fetch agents from Lyfe
router.get('/agents', asyncHandler(async (req, res) => {
  const agents = await fetchAgents(req.query);
  res.json({ success: true, data: agents });
}));

// Fetch agent groups from Lyfe
router.get('/agent-groups', asyncHandler(async (req, res) => {
  const groups = await fetchAgentGroups();
  res.json({ success: true, data: groups });
}));

// Fetch a single agent by ID from Lyfe
router.get('/agents/:id', asyncHandler(async (req, res) => {
  const agent = await fetchAgentById(req.params.id);
  res.json({ success: true, data: agent });
}));

// Sync agents from Lyfe into local User table
router.post('/agents/sync', asyncHandler(async (req, res) => {
  invalidateCache();
  const lyfeAgents = await fetchAgents();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const agent of lyfeAgents) {
    if (!agent.phone && !agent.email) {
      skipped++;
      continue;
    }

    // Try to find existing user by lyfeId, then by phone, then by email
    let existing = null;
    if (agent.id) {
      existing = await User.findOne({ where: { lyfeId: String(agent.id) } });
    }
    if (!existing && agent.phone) {
      const normalizedPhone = String(agent.phone).replace(/\D/g, '');
      existing = await User.findOne({ where: { phone: normalizedPhone, role: 'agent' } });
    }
    if (!existing && agent.email) {
      existing = await User.findOne({ where: { email: agent.email } });
    }

    if (existing) {
      // Update with Lyfe data if not already linked
      const updateData = {};
      if (agent.id && !existing.lyfeId) updateData.lyfeId = String(agent.id);
      if (agent.name && !existing.fullName) updateData.fullName = agent.name;
      if (agent.phone && !existing.phone) {
        updateData.phone = String(agent.phone).replace(/\D/g, '');
      }

      if (Object.keys(updateData).length > 0) {
        await existing.update(updateData);
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Create new agent user
      const nameParts = (agent.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || null;
      const lastName = nameParts.slice(1).join(' ') || null;
      const normalizedPhone = agent.phone ? String(agent.phone).replace(/\D/g, '') : null;

      await User.create({
        lyfeId: agent.id ? String(agent.id) : null,
        email: agent.email || `lyfe_${agent.id || normalizedPhone}@placeholder.local`,
        firstName,
        lastName,
        fullName: agent.name || null,
        phone: normalizedPhone,
        role: 'agent',
        isActive: true,
        emailVerified: false,
        approvalStatus: 'approved'
      });
      created++;
    }
  }

  // Deactivate local agents that are no longer in Lyfe
  let deactivated = 0;
  const lyfeIds = lyfeAgents.map(a => String(a.id)).filter(Boolean);

  if (lyfeIds.length > 0) {
    const staleAgents = await User.findAll({
      where: {
        lyfeId: { [Op.ne]: null, [Op.notIn]: lyfeIds },
        role: 'agent',
        isActive: true
      }
    });

    for (const agent of staleAgents) {
      await agent.update({ isActive: false });
      deactivated++;
    }
  }

  res.json({
    success: true,
    message: `Sync complete: ${created} created, ${updated} updated, ${deactivated} deactivated, ${skipped} unchanged`,
    data: { created, updated, deactivated, skipped, total: lyfeAgents.length }
  });
}));

// Invalidate the Lyfe agent cache
router.post('/cache/invalidate', asyncHandler(async (req, res) => {
  invalidateCache();
  res.json({ success: true, message: 'Cache invalidated' });
}));

export default router;
