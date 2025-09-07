import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../database/connection.js';

class IdempotencyKey extends Model {}

IdempotencyKey.init({
  key: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  scope: {
    // e.g., 'beacon:heartbeat' or 'beacon:impression' or 'manifest'
    type: DataTypes.STRING,
    allowNull: false
  },
  deviceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  responseBody: {
    type: DataTypes.JSON,
    allowNull: true
  },
  responseCode: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'IdempotencyKey',
  tableName: 'idempotency_keys',
  indexes: [
    { fields: ['scope'] },
    { fields: ['deviceId'] },
    { fields: ['expiresAt'] }
  ]
});

export default IdempotencyKey;


