import { DataTypes, Model, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

class Device extends Model { }

Device.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  campaignIds: {
    type: DataTypes.JSON, // Array of UUIDs
    allowNull: false,
    defaultValue: []
  },
  // Deprecated: Kept for backward compatibility until migration is verified
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  externalId: {
    // OEM-provided identifier, optional
    type: DataTypes.STRING,
    allowNull: true
  },
  secretHash: {
    // sha256 hash of device key (base64url or hex)
    type: DataTypes.STRING,
    allowNull: false
  },
  model: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'active'
  },
  lastSeenAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // GPS Location Tracking
  latitude: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  longitude: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  locationUpdatedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Vehicle Pairing
  vehicleId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'vehicles', key: 'id' }
  },
  role: {
    type: DataTypes.ENUM('master', 'slave'),
    allowNull: true,
    defaultValue: null
  }
}, {
  sequelize,
  modelName: 'Device',
  tableName: 'devices',
  indexes: [
    { fields: ['tenantId'] },
    { unique: true, fields: ['externalId'], where: { externalId: { [Op.ne]: null } } }
  ]
});

export default Device;


