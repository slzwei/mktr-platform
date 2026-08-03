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
    // M5: nullable — the FK is ON DELETE SET NULL (migrations 014 + 108), so
    // delivery history SURVIVES subscriber deletion as an audit record.
    // Pre-fix this said allowNull:false while the FK said SET NULL: deleting
    // any subscriber with history made Postgres null a NOT NULL column and
    // reject the delete (admin 500). Consumers tolerate the null: listings
    // LEFT JOIN the subscriber, and retryDelivery rejects cleanly when the
    // subscriber is gone.
    allowNull: true,
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
      // 'sending' = claimed by a worker and in flight (P2-2). Plain STRING
      // column, no DB-level enum, so no migration is needed to widen it.
      isIn: [['pending', 'sending', 'success', 'failed']]
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
