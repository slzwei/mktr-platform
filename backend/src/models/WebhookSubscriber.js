import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const WebhookSubscriber = sequelize.define('WebhookSubscriber', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { len: [1, 100] }
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isUrl: true }
  },
  secret: {
    type: DataTypes.STRING,
    allowNull: false
  },
  events: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'webhook_subscribers'
});

export default WebhookSubscriber;
