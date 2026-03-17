import { sequelize } from '../database/connection.js';
import { DataTypes } from 'sequelize';

const CampaignAgentAssignment = sequelize.define('CampaignAgentAssignment', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  campaignId: { type: DataTypes.UUID, allowNull: false },
  agentId: { type: DataTypes.UUID, allowNull: false },
  assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
  tableName: 'campaign_agent_assignments',
  timestamps: false,
  indexes: [
    { fields: ['campaignId'] },
    { fields: ['agentId'] },
    { unique: true, fields: ['campaignId', 'agentId'] }
  ]
});

export default CampaignAgentAssignment;
