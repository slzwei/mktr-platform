import { DataTypes, Sequelize } from 'sequelize';
import { sequelize } from '../database/connection.js';

const AgentGroupMember = sequelize.define('AgentGroupMember', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  agentGroupId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'agent_groups',
      key: 'id'
    }
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  lyfeId: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  // Explicit timestamp defaults so the MODEL-built schema (test boot's
  // sync({force:true})) matches what migration 023 created in prod. Without a DB
  // default here Sequelize emits these NOT NULL with NO default: a raw INSERT
  // that omits them succeeds in prod and dies in every test (CLAUDE.md's
  // "test schema != prod schema"). The ORM still fills them on create/update —
  // this only makes the database agree.
  //
  // fn('NOW'), NOT DataTypes.NOW: the latter is an ORM-side default only and
  // emits no DEFAULT clause at all (verified against this Sequelize version),
  // so it would have looked like a fix and changed nothing. This is the same
  // expression the migration uses.
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
}, {
  tableName: 'agent_group_members',
  indexes: [
    { fields: ['agentGroupId'], name: 'idx_agm_group' },
    { fields: ['userId'], name: 'idx_agm_user' },
    { fields: ['phone'], name: 'idx_agm_phone' },
    { unique: true, fields: ['agentGroupId', 'phone'], name: 'idx_agm_unique' }
  ]
});

export default AgentGroupMember;
