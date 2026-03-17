import { sequelize } from '../database/connection.js';
import { DataTypes } from 'sequelize';

const VehicleCampaignAssignment = sequelize.define('VehicleCampaignAssignment', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  vehicleId: { type: DataTypes.UUID, allowNull: false },
  campaignId: { type: DataTypes.UUID, allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
  tableName: 'vehicle_campaign_assignments',
  timestamps: false,
  indexes: [
    { fields: ['vehicleId'] },
    { fields: ['campaignId'] },
    { unique: true, fields: ['vehicleId', 'campaignId'] }
  ]
});

export default VehicleCampaignAssignment;
