import { sequelize } from '../database/connection.js';
import { DataTypes } from 'sequelize';

const DeviceCampaignAssignment = sequelize.define('DeviceCampaignAssignment', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  deviceId: { type: DataTypes.UUID, allowNull: false },
  campaignId: { type: DataTypes.UUID, allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
  tableName: 'device_campaign_assignments',
  timestamps: false,
  indexes: [
    { fields: ['deviceId'] },
    { fields: ['campaignId'] },
    { unique: true, fields: ['deviceId', 'campaignId'] }
  ]
});

export default DeviceCampaignAssignment;
