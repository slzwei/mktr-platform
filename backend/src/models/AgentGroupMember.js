import { DataTypes } from 'sequelize';
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
  }
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
