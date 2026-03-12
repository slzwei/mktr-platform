import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const WebhookDelivery = sequelize.define('WebhookDelivery', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  subscriberId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'webhook_subscribers',
      key: 'id'
    }
  },
  deliveryId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    unique: true
  },
  eventType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending',
    validate: {
      isIn: [['pending', 'success', 'failed']]
    }
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  maxAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3
  },
  lastAttemptAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  nextRetryAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  responseCode: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  responseBody: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'webhook_deliveries',
  indexes: [
    { fields: ['status', 'nextRetryAt'] },
    { fields: ['subscriberId'] }
  ]
});

export default WebhookDelivery;
