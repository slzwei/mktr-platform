import { Op } from 'sequelize';
import { AgentGroup, AgentGroupMember, QrTag, User, sequelize } from '../models/index.js';

export async function listAgentGroups() {
  return AgentGroup.findAll({
    order: [['createdAt', 'DESC']],
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'members', order: [['sortOrder', 'ASC']] }
    ]
  });
}

export async function createAgentGroup({ name, description, agents }, userId) {
  if (!name) {
    const err = new Error('name is required');
    err.statusCode = 400;
    throw err;
  }

  const agentList = agents || [];

  // Pre-fetch users by phone in bulk to avoid per-agent findOne queries
  const phones = agentList.map(a => a.phone).filter(Boolean);
  const phoneToUser = new Map();
  if (phones.length > 0) {
    const users = await User.findAll({
      where: { phone: { [Op.in]: phones }, role: 'agent', isActive: true },
      attributes: ['id', 'phone']
    });
    for (const u of users) phoneToUser.set(u.phone, u);
  }

  const group = await sequelize.transaction(async (t) => {
    const newGroup = await AgentGroup.create({
      name,
      description: description || null,
      createdBy: userId
    }, { transaction: t });

    // Build member rows and bulk-create
    const memberRows = [];
    for (let i = 0; i < agentList.length; i++) {
      const a = agentList[i];
      if (!a.phone) continue;

      const user = phoneToUser.get(a.phone);
      memberRows.push({
        agentGroupId: newGroup.id,
        userId: user ? user.id : null,
        phone: a.phone,
        email: a.email || null,
        name: a.name || null,
        lyfeId: a.lyfeId || null,
        sortOrder: i
      });
    }

    if (memberRows.length > 0) {
      await AgentGroupMember.bulkCreate(memberRows, { transaction: t });
    }

    return newGroup;
  });

  // Reload with members included
  return AgentGroup.findByPk(group.id, {
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'members', order: [['sortOrder', 'ASC']] }
    ]
  });
}

export async function updateAgentGroup(id, fields) {
  const group = await AgentGroup.findByPk(id);
  if (!group) {
    const err = new Error('Agent group not found');
    err.statusCode = 404;
    throw err;
  }

  const { name, description, agents } = fields;

  // Pre-fetch users by phone in bulk if members are being updated
  const phoneToUser = new Map();
  if (agents !== undefined) {
    const phones = agents.map(a => a.phone).filter(Boolean);
    if (phones.length > 0) {
      const users = await User.findAll({
        where: { phone: { [Op.in]: phones }, role: 'agent', isActive: true },
        attributes: ['id', 'phone']
      });
      for (const u of users) phoneToUser.set(u.phone, u);
    }
  }

  await sequelize.transaction(async (t) => {
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    if (Object.keys(updateData).length > 0) {
      await group.update(updateData, { transaction: t });
    }

    // Sync members: delete all existing + bulk recreate
    if (agents !== undefined) {
      await AgentGroupMember.destroy({
        where: { agentGroupId: group.id },
        transaction: t
      });

      const memberRows = [];
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.phone) continue;

        const user = phoneToUser.get(a.phone);
        memberRows.push({
          agentGroupId: group.id,
          userId: user ? user.id : null,
          phone: a.phone,
          email: a.email || null,
          name: a.name || null,
          lyfeId: a.lyfeId || null,
          sortOrder: i
        });
      }

      if (memberRows.length > 0) {
        await AgentGroupMember.bulkCreate(memberRows, { transaction: t });
      }
    }
  });

  // Reload with members included
  return AgentGroup.findByPk(group.id, {
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'members', order: [['sortOrder', 'ASC']] }
    ]
  });
}

export async function deleteAgentGroup(id) {
  const group = await AgentGroup.findByPk(id);
  if (!group) {
    const err = new Error('Agent group not found');
    err.statusCode = 404;
    throw err;
  }

  // Check if any QR tags reference this group (active routing path)
  const qrTagCount = await QrTag.count({ where: { agentGroupId: group.id } });

  if (qrTagCount > 0) {
    const err = new Error(`Cannot delete: ${qrTagCount} QR code(s) reference this group`);
    err.statusCode = 409;
    throw err;
  }

  // Members cascade-delete automatically via FK ON DELETE CASCADE
  await group.destroy();
}
