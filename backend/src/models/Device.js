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
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
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


